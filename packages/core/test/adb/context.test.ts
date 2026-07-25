import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdbContext } from '../../src/adb/context.js'
import { MeasurementWindowViolationError } from '../../src/errors.js'
import { extractRun } from '../../src/extract/run.js'
import type { CaptureManifest } from '../../src/session/manifest.js'
import { startSession } from '../../src/session/start.js'
import { activePointerPath, type ActiveSession, readActiveSession } from '../../src/session/state.js'
import { stopSession } from '../../src/session/stop.js'
import {
  clientFor,
  SERIAL,
  startableDevice,
  stoppableDevice,
  targetApp,
  tempDirs,
} from '../support/fakeDevice.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const NOW = new Date('2026-07-25T14:32:10.000Z')
const LATER = new Date('2026-07-25T14:33:00.000Z')

/**
 * 진짜 `createAdbContext` 를 돌린다. `locateAdb` 가 실행 가능한 파일을 요구하므로
 * node 실행 파일을 adb 경로로 주고, 실제 프로세스 실행은 FakeProcessRunner 가 가로챈다.
 */
function contextLike(runner: FakeProcessRunner, home: string) {
  runner.on('devices -l', {
    stdout: `List of devices attached\n${SERIAL}\tdevice usb:0-1 model:SM_S901N\n`,
  })
  return createAdbContext({ adb: process.execPath, runner, home })
}

async function startedSession(): Promise<{ session: ActiveSession; home: string }> {
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

describe('측정 창은 프로세스를 넘어 살아 있다 (I4)', () => {
  it('기기 목록 조회는 창 밖이다 — 어느 세션이 활성인지는 그 뒤에야 안다', async () => {
    const { home } = await startedSession()
    const runner = new FakeProcessRunner()

    const ctx = await contextLike(runner, home)

    expect(runner.commands).toEqual(['devices -l'])
    expect(ctx.serial).toBe(SERIAL)
    expect(ctx.adb.window.isOpen).toBe(true)
  })

  it('활성 세션이 있는 새 프로세스는 창이 열린 채로 시작한다', async () => {
    const { home } = await startedSession()

    // `perftracker apps` 가 새로 뜬 상황.
    const ctx = await contextLike(new FakeProcessRunner(), home)

    expect(ctx.adb.window.isOpen).toBe(true)
    await expect(ctx.adb.shell('pm list packages -3')).rejects.toBeInstanceOf(
      MeasurementWindowViolationError,
    )
  })

  it('활성 세션이 없으면 창은 닫힌 채다', async () => {
    const { home } = tempDirs()
    const ctx = await contextLike(new FakeProcessRunner().on(`-s ${SERIAL} shell echo hi`, { stdout: 'hi' }), home)

    expect(ctx.adb.window.isOpen).toBe(false)
    await expect(ctx.adb.shell('echo hi')).resolves.toContain('hi')
  })

  it('막힌 호출이 포인터에 누적된다 — 프로세스가 죽어도 남는다', async () => {
    const { home } = await startedSession()

    const first = await contextLike(new FakeProcessRunner(), home)
    await expect(first.adb.shell('dumpsys gfxinfo')).rejects.toThrow(MeasurementWindowViolationError)
    // 프로세스가 여기서 죽었다고 치고, 완전히 새 컨텍스트를 만든다.
    const second = await contextLike(new FakeProcessRunner(), home)
    await expect(second.adb.shell('dumpsys meminfo')).rejects.toThrow(MeasurementWindowViolationError)

    const pointer = JSON.parse(readFileSync(activePointerPath(SERIAL, home), 'utf8')) as ActiveSession
    expect(pointer.adbCommandsDuringSession).toBe(2)
  })

  it('stop 은 창이 열린 컨텍스트에서도 정상 동작한다', async () => {
    const { session, home } = await startedSession()
    const ctx = await contextLike(stoppableDevice(session), home)
    expect(ctx.adb.window.isOpen).toBe(true)

    const r = await stopSession(ctx, (await readActiveSession(SERIAL, home))!, LATER, home)

    expect(r.state).toBe('completed')
    expect(await readActiveSession(SERIAL, home)).toBeNull()
  })

  it('adb_commands_during_session 이 0 이 아닌 값으로 result.json 까지 간다', async () => {
    const { session, home } = await startedSession()

    // 세션 도중 다른 프로세스 두 개가 기기를 건드리려다 막힌다.
    for (const cmd of ['pm list packages -3', 'dumpsys gfxinfo']) {
      const violating = await contextLike(new FakeProcessRunner(), home)
      await expect(violating.adb.shell(cmd)).rejects.toThrow(MeasurementWindowViolationError)
    }

    const stopCtx = await contextLike(stoppableDevice(session), home)
    await stopSession(stopCtx, (await readActiveSession(SERIAL, home))!, LATER, home)

    const manifest = JSON.parse(
      readFileSync(join(session.runDir, 'capture.json'), 'utf8'),
    ) as CaptureManifest
    expect(manifest.adb_commands_during_session).toBe(2)

    // 트레이스가 없으니 frame 은 failed 지만, 오버헤드 블록은 그대로 실려 나간다.
    const result = await extractRun(session.runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })
    expect(result.measurement_overhead.adb_commands_during_session).toBe(2)
  })
})

describe('--force 는 창을 닫고 새 세션을 연다', () => {
  it('창이 열린 컨텍스트에서도 --force start 가 통과한다', async () => {
    const { home, out } = tempDirs()
    const first = clientFor(startableDevice())
    const previous = await startSession({ adb: first, serial: SERIAL }, targetApp(), {
      launch: false,
      video: false,
      outDir: out,
      force: false,
      now: NOW,
      home,
    })

    const runner = startableDevice((r) => {
      r.on(`-s ${SERIAL} shell perfetto --is_detached=${previous.perfettoKey}`, { code: 0 })
        .on(`-s ${SERIAL} shell perfetto --attach=${previous.perfettoKey} --stop`, {})
        .on(`-s ${SERIAL} shell rm -f ${previous.remoteTracePath}`, {})
    })
    const ctx = await contextLike(runner, home)
    expect(ctx.adb.window.isOpen).toBe(true)

    const next = await startSession(ctx, targetApp(), {
      launch: false,
      video: false,
      outDir: out,
      force: true,
      now: NOW,
      home,
    })

    expect(next.id).not.toBe(previous.id)
    expect(runner.commands).toContain(`-s ${SERIAL} shell perfetto --attach=${previous.perfettoKey} --stop`)
  })
})
