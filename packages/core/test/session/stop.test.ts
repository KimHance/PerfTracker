import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeasurementWindowViolationError, SessionStateError } from '../../src/errors.js'
import type { CaptureManifest } from '../../src/session/manifest.js'
import { startSession } from '../../src/session/start.js'
import { readActiveSession, recordAdbViolation } from '../../src/session/state.js'
import { stopSession } from '../../src/session/stop.js'
import {
  clientFor,
  SERIAL,
  startableDevice,
  stoppableDevice,
  targetApp,
  tempDirs,
} from '../support/fakeDevice.js'

const NOW = new Date('2026-07-25T14:32:10.000Z')
const LATER = new Date('2026-07-25T14:33:00.000Z')

async function startedSession(): Promise<{ session: Awaited<ReturnType<typeof startSession>>; home: string }> {
  const { home, out } = tempDirs()
  const adb = clientFor(startableDevice())
  const session = await startSession({ adb, serial: SERIAL }, targetApp(), {
    launch: false,
    video: false,
    outDir: out,
    force: false,
    now: NOW,
    home,
  })
  return { session, home }
}

function manifestOf(runDir: string): CaptureManifest {
  return JSON.parse(readFileSync(join(runDir, 'capture.json'), 'utf8')) as CaptureManifest
}

describe('stopSession — 정상 경로', () => {
  it('세션을 멈추고 트레이스를 회수한 뒤 포인터를 지운다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session)

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('completed')
    expect(manifestOf(session.runDir).artifacts.trace).toBe('trace.perfetto-trace')
    expect(await readActiveSession(SERIAL, home)).toBeNull()
    expect(runner.commands).toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
  })

  it('창을 닫기 전에 카운터를 읽는다 — 닫은 뒤의 adb 호출은 세션 중 호출이 아니다', async () => {
    const { session, home } = await startedSession()
    const adb = clientFor(stoppableDevice(session))

    // start 직후처럼 창이 열린 상태에서 위반이 한 번 있었던 상황을 만든다.
    adb.window.open()
    expect(() => adb.window.assertClosed('adb shell dumpsys gfxinfo')).toThrow(
      MeasurementWindowViolationError,
    )

    await stopSession({ adb, serial: SERIAL }, session, LATER, home)

    // stop 자신이 창을 닫은 뒤 보낸 명령들은 카운터에 잡히지 않는다.
    expect(manifestOf(session.runDir).adb_commands_during_session).toBe(1)
    expect(adb.window.isOpen).toBe(false)
  })

  it('세션이 사라지고 기기에도 트레이스가 없으면 aborted 로 남긴다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { detached: false, traceOnDevice: false })

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('aborted')
    const manifest = manifestOf(session.runDir)
    expect(manifest.artifacts.trace).toBeNull()
    expect(manifest.warnings.map((w) => w.code)).toContain('trace_session_lost')
  })
})

describe('stopSession — pull 실패는 세션을 파괴하지 않는다 (C1)', () => {
  it('회수에 실패하면 포인터와 기기 트레이스를 남기고 재시도를 안내한다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { pullFails: true })

    await expect(
      stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home),
    ).rejects.toBeInstanceOf(SessionStateError)

    // 포인터가 살아 있어야 다음 stop 이 같은 세션을 다시 집는다.
    expect(await readActiveSession(SERIAL, home)).not.toBeNull()
    // 기기의 트레이스를 지우지 않았다 — 이 시점에 그 파일이 유일한 정본이다.
    expect(runner.commands).not.toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
    // 매니페스트를 "트레이스 없음"으로 덮어쓰지도 않았다.
    expect(manifestOf(session.runDir).artifacts.trace).toBeNull()
    expect(manifestOf(session.runDir).device.state_after).toBeNull()
  })

  it('실패 메시지가 재시도 방법과 두 경로를 알려준다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { pullFails: true })

    await expect(
      stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home),
    ).rejects.toThrow(/perftracker stop 을 다시 실행/)
  })

  it('두 번째 stop 이 트레이스를 회수한다 — detached 세션이 없어도 aborted 로 단정하지 않는다', async () => {
    const { session, home } = await startedSession()

    await expect(
      stopSession({ adb: clientFor(stoppableDevice(session, { pullFails: true })), serial: SERIAL }, session, LATER, home),
    ).rejects.toBeInstanceOf(SessionStateError)

    // 재시도: 앞선 시도가 이미 멈췄으므로 is_detached 는 false 다. 그래도 기기에 파일이 있다.
    const retry = stoppableDevice(session, { detached: false, traceOnDevice: true })
    const r = await stopSession({ adb: clientFor(retry), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('completed')
    expect(manifestOf(session.runDir).artifacts.trace).toBe('trace.perfetto-trace')
    expect(manifestOf(session.runDir).warnings.map((w) => w.code)).not.toContain('trace_session_lost')
    expect(retry.commands).toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
    expect(await readActiveSession(SERIAL, home)).toBeNull()
  })
})

describe('stopSession — 프로세스를 넘어온 위반 카운트 (I4)', () => {
  it('다른 프로세스가 기록한 위반을 result 계보로 옮긴다', async () => {
    const { session, home } = await startedSession()

    // `perftracker apps` 같은 다른 프로세스에서 일어난 위반.
    recordAdbViolation(SERIAL, home)
    recordAdbViolation(SERIAL, home)
    const reloaded = await readActiveSession(SERIAL, home)
    expect(reloaded?.adbCommandsDuringSession).toBe(2)

    await stopSession({ adb: clientFor(stoppableDevice(session)), serial: SERIAL }, reloaded!, LATER, home)

    expect(manifestOf(session.runDir).adb_commands_during_session).toBe(2)
  })

  it('진행 중인 run 디렉토리를 옮겨도 stop 이 사람이 읽을 수 있는 오류를 낸다', async () => {
    const { session, home } = await startedSession()
    writeFileSync(join(session.runDir, 'capture.json'), '{not json', 'utf8')

    await expect(
      stopSession({ adb: clientFor(stoppableDevice(session)), serial: SERIAL }, session, LATER, home),
    ).rejects.toBeInstanceOf(SessionStateError)
  })
})
