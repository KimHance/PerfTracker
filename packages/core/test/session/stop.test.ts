import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

  /**
   * 이 단언이 지키는 배선: `stopSession` 이 `runSnapshots(ctx.adb, snapshotSpecs)` 를 실제로
   * 부른다는 것. 그 한 줄을 지우면 `raw/netstats_after.txt` / `raw/packages_after.txt` 가
   * 사라지고 (thermalservice 는 `collectDeviceState` 가 따로 찍으므로 살아남는다)
   * extract 의 network collector 는 영원히 `snapshot_unavailable` 만 낸다.
   * TypeScript 는 이 배선을 지키지 못한다 — 지우는 것도 `{}` 로 무력화하는 것도 타입이 맞는다.
   *
   * `stoppableDevice` 는 두 명령에 응답을 등록하지 않으므로 `FakeProcessRunner` 가 exit 127 을
   * 내고 `tryShell` 이 그것을 빈 문자열로 흡수한다 → **빈 파일이 쓰이고 등재된다.**
   * 그것이 정상 동작이다: 명령 하나가 세션을 죽이지 않고, `snapshotText` 가 빈 원문을 null 로
   * 접어 collector 가 `snapshot_unavailable` 로 정직하게 말한다.
   */
  it('종료 스냅샷도 raw/ 에 저장되고 등재된다 — before/after 가 짝을 이룬다', async () => {
    const { session, home } = await startedSession()

    await stopSession({ adb: clientFor(stoppableDevice(session)), serial: SERIAL }, session, LATER, home)

    const manifest = manifestOf(session.runDir)
    for (const key of ['netstats', 'packages', 'thermalservice']) {
      for (const phase of ['before', 'after']) {
        const rel = join('raw', `${key}_${phase}.txt`)
        expect(manifest.artifacts.raw, rel).toContain(rel)
        expect(existsSync(join(session.runDir, rel)), rel).toBe(true)
      }
    }
  })

  /**
   * 원칙 1 의 트립와이어, **stop 쪽.** start 는 이것을 두 겹으로 갖고 있었는데
   * (`start.test.ts` 의 "명령 전체 목록" + "스냅샷은 트레이스를 켜기 전에") stop 은 둘 다
   * 없었다. 리뷰어가 변이로 확증했다: `collectDeviceState` + `runSnapshots` 두 줄을
   * `isSessionDetached` / `stopDetachedSession` **앞**으로 옮겨도 651개가 전부 통과했다.
   *
   * 그 배치에서 무엇이 깨지는가: `dumpsys netstats` / `pm list packages -U` /
   * `dumpsys thermalservice` / `dumpsys battery` 가 **아직 도는 트레이서 안에서** 실행되고,
   * 그 비용이 `metrics.cpu` · `metrics.log` · `measurement_overhead` 에 그대로 섞인다.
   * **온-디바이스 테스트도 이것을 못 잡는다** — 측정 창은 이미 닫혀 있으므로
   * `adb_commands_during_session` 은 여전히 0 이다.
   *
   * `dumpsys` 로 거르지 않고 **목록 전체**를 고정하는 이유는 start 쪽과 같다:
   * M3 이 늘린 명령 중 하나가 `pm list packages -U` 라 그 필터에 애초에 걸리지 않았다.
   * 개수만 세는 것도 안 된다 — 하나가 늘고 하나가 사라진 경우를 못 잡는다.
   *
   * M4 가 Power 로 `dumpsys batterystats` 를 더하면 이 목록이 먼저 깨진다. 그때
   * **어디에 넣었는지**(트레이서 정지 뒤인지)가 다음 두 테스트의 질문이다.
   */
  it('기기로 나가는 명령 전체가 이 목록과 정확히 같다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session)

    await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(runner.commands).toEqual([
      // 1) 트레이서를 먼저 멈춘다.
      `-s ${SERIAL} shell perfetto --is_detached=${session.perfettoKey}`,
      `-s ${SERIAL} shell perfetto --attach=${session.perfettoKey} --stop`,
      // 2) 원본을 회수하고 기기 쪽을 지운다.
      `-s ${SERIAL} pull ${session.remoteTracePath} ${join(session.runDir, 'trace.perfetto-trace')}`,
      `-s ${SERIAL} shell rm -f ${session.remoteTracePath}`,
      // 3) collectDeviceState — 여기부터가 종료 스냅샷이다.
      `-s ${SERIAL} shell dumpsys battery`,
      `-s ${SERIAL} shell dumpsys thermalservice`,
      `-s ${SERIAL} shell echo "brightness=$(settings get system screen_brightness) low_power=$(settings get global low_power) anim=$(settings get global animator_duration_scale)"`,
      `-s ${SERIAL} shell grep MemAvailable /proc/meminfo`,
      `-s ${SERIAL} shell ip route get 8.8.8.8`,
      // 4) collectSnapshotSpecs — frame(gfxinfo) · network(netstats · packages).
      //    gfxinfo 는 누적값이라 전/후 차이가 이 세션의 값이 된다.
      `-s ${SERIAL} shell dumpsys gfxinfo ${session.packageName}`,
      `-s ${SERIAL} shell dumpsys netstats`,
      `-s ${SERIAL} shell pm list packages -U`,
      // 5) 기기 시계. 마킹을 시계열과 같은 축에 놓는 데 쓴다 (`device/clock.ts`).
      //    트레이서가 멈춘 뒤라 이 명령도 트레이스에 남지 않는다.
      `-s ${SERIAL} shell date +%s%N`,
    ])
  })

  /**
   * `stop.ts` 의 주석이 단언하는 바로 그것: "트레이서가 이미 멈춘 뒤이므로 이 명령들도
   * 트레이스에 남지 않는다." 그 문장을 지키는 장치가 이 테스트다.
   *
   * 창 밖이라는 것만으로는 부족하다 — 창은 `stopSession` 첫 줄에서 이미 닫혔고,
   * 트레이서는 그것과 무관하게 `--attach --stop` 까지 돈다. 두 사건은 다른 사건이다.
   */
  it('종료 스냅샷 명령은 트레이서를 멈춘 뒤에 나간다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session)

    await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    const stopped = runner.commands.indexOf(
      `-s ${SERIAL} shell perfetto --attach=${session.perfettoKey} --stop`,
    )
    expect(stopped, '트레이서를 멈추는 명령이 아예 없다').toBeGreaterThanOrEqual(0)

    for (const snapshot of [
      'shell dumpsys battery',
      'shell dumpsys thermalservice',
      'shell dumpsys netstats',
      'shell pm list packages -U',
    ]) {
      const at = runner.commands.findIndex((c) => c.endsWith(snapshot))
      expect(at, `${snapshot} 가 나가지 않았다`).toBeGreaterThanOrEqual(0)
      expect(at, `${snapshot} 가 트레이서가 도는 동안 나갔다`).toBeGreaterThan(stopped)
    }
  })

  /**
   * 같은 계열의 **두 번째** 자기 주장. `NetworkDataSchema.rx_bytes` 의 `.describe()` 가
   * 소비자에게 이렇게 공시한다: "종료 스냅샷은 트레이스를 회수한 **뒤**에 찍히므로 회수에
   * 걸린 시간이 포함된다(트레이스가 클수록 길어진다)." 그 문장을 근거로 스키마는
   * `state_after.captured_at` 으로 처리량을 계산하지 말라고까지 말한다.
   *
   * 스냅샷을 회수 **앞**으로 옮기면 그 공시가 통째로 거짓이 되는데, 그 배치를 지키는 것은
   * 지금까지 아무것도 없었다. 값이 아니라 **순서**가 계약인 자리다.
   */
  it('종료 스냅샷은 트레이스를 회수한 뒤에 찍힌다 — 스키마가 그렇게 공시한다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session)

    await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    const pull = runner.commands.findIndex((c) => c.startsWith(`-s ${SERIAL} pull `))
    const netstats = runner.commands.findIndex((c) => c.endsWith('shell dumpsys netstats'))

    expect(pull).toBeGreaterThanOrEqual(0)
    expect(netstats).toBeGreaterThan(pull)
  })

  it('세션이 사라지고 기기에도 트레이스가 없으면 aborted 로 남긴다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { detached: false, probe: 'absent' })

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
    const retry = stoppableDevice(session, { detached: false, probe: 'present' })
    const r = await stopSession({ adb: clientFor(retry), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('completed')
    expect(manifestOf(session.runDir).artifacts.trace).toBe('trace.perfetto-trace')
    expect(manifestOf(session.runDir).warnings.map((w) => w.code)).not.toContain('trace_session_lost')
    expect(retry.commands).toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
    expect(await readActiveSession(SERIAL, home)).toBeNull()
  })
})

describe('stopSession — "모른다" 를 "없다" 로 읽지 않는다 (C1 후속)', () => {
  it('원격 확인이 실패하면 aborted 로 단정하지 않고 포인터를 남긴다', async () => {
    const { session, home } = await startedSession()
    // 흔들리는 기기: is_detached 도 실패하고 원격 확인도 아무 마커를 못 받는다.
    const runner = stoppableDevice(session, { detached: false, probe: 'unknown' })

    await expect(
      stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home),
    ).rejects.toBeInstanceOf(SessionStateError)

    // 여기서 aborted 를 썼다면 기기에 멀쩡히 있는 트레이스의 참조를 도구가 버린 것이다.
    expect(await readActiveSession(SERIAL, home)).not.toBeNull()
    const manifest = manifestOf(session.runDir)
    expect(manifest.artifacts.trace).toBeNull()
    expect(manifest.warnings.map((w) => w.code)).not.toContain('trace_session_lost')
    expect(runner.commands).not.toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
  })

  it('확인 실패 메시지가 재시도 가능함을 알린다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { detached: false, probe: 'unknown' })

    await expect(
      stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home),
    ).rejects.toThrow(/perftracker stop 을 다시 실행/)
  })

  it('확실히 없다고 답할 때만 aborted 다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { detached: false, probe: 'absent' })

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('aborted')
  })
})

describe('stopSession — 이미 회수된 트레이스를 aborted 로 덮지 않는다 (C1 후속)', () => {
  it('기기에는 없지만 run 디렉토리에 있으면 completed 다', async () => {
    const { session, home } = await startedSession()
    // 앞선 시도가 pull + rm 까지 끝내고 매니페스트를 쓰기 전에 죽은 상태를 만든다.
    writeFileSync(join(session.runDir, 'trace.perfetto-trace'), 'pulled bytes', 'utf8')
    const runner = stoppableDevice(session, { detached: false, probe: 'absent' })

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('completed')
    const manifest = manifestOf(session.runDir)
    expect(manifest.artifacts.trace).toBe('trace.perfetto-trace')
    expect(manifest.warnings.map((w) => w.code)).not.toContain('trace_session_lost')
    // 이미 회수했으므로 다시 받지 않는다.
    expect(runner.commands.some((c) => c.startsWith(`-s ${SERIAL} pull `))).toBe(false)
    expect(readFileSync(join(session.runDir, 'trace.perfetto-trace'), 'utf8')).toBe('pulled bytes')
  })

  it('로컬 파일이 있어도 기기에 남아 있으면 기기 쪽을 다시 받는다 — 잘린 파일을 붙잡지 않는다', async () => {
    const { session, home } = await startedSession()
    // 앞선 pull 이 중간에 끊겨 잘린 파일이 남았고, 원격 파일은 아직 그대로인 상태.
    writeFileSync(join(session.runDir, 'trace.perfetto-trace'), 'truncated', 'utf8')
    const runner = stoppableDevice(session, { detached: false, probe: 'present' })

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('completed')
    expect(runner.commands.some((c) => c.startsWith(`-s ${SERIAL} pull `))).toBe(true)
    expect(runner.commands).toContain(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`)
  })

  it('기기에도 없고 로컬에도 없을 때만 aborted 다', async () => {
    const { session, home } = await startedSession()
    const runner = stoppableDevice(session, { detached: false, probe: 'absent' })

    const r = await stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home)

    expect(r.state).toBe('aborted')
    expect(manifestOf(session.runDir).warnings.map((w) => w.code)).toContain('trace_session_lost')
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

  /**
   * I-1 과 **같은 계열**을 하나 더 발견해서 함께 막는다.
   *
   * `stop.ts` 는 매니페스트 읽기와 스냅샷 명세 확정(`collectSnapshotSpecs`)을 기기에 손대기
   * **전에** 한다고 주석으로 단언한다: "그 평가가 트레이스 회수·삭제 뒤에 있으면 기기의
   * 트레이스를 이미 지운 상태에서 던지게 된다 — 정본이 사라진 뒤의 실패다."
   * 두 줄 다 던질 수 있다 (`parseVersionedJson`, `mergeSnapshotSpecs` 의 key 충돌 —
   * M4 가 Power 로 `dumpsys battery` 를 선언하면 바로 그 길이다).
   *
   * 그런데 옛 단언은 "SessionStateError 가 난다" 뿐이었다. 두 줄을 회수 뒤로 옮겨도
   * 그 단언은 **그대로 통과한다** — 예외 타입은 같고, 그때는 이미 `pull` 과 `rm -f` 가
   * 끝난 뒤라 기기의 정본이 사라진 상태다. C1 이 Critical 이었던 바로 그 손실이다.
   *
   * 그래서 예외 타입이 아니라 **그 시점에 기기로 나간 명령이 하나도 없다는 것**을 단언한다.
   */
  it('매니페스트를 읽지 못하면 기기를 건드리기 전에 던진다 — 정본이 사라진 뒤에 실패하지 않는다', async () => {
    const { session, home } = await startedSession()
    writeFileSync(join(session.runDir, 'capture.json'), '{not json', 'utf8')
    const runner = stoppableDevice(session)

    await expect(
      stopSession({ adb: clientFor(runner), serial: SERIAL }, session, LATER, home),
    ).rejects.toBeInstanceOf(SessionStateError)

    // 한 줄이 전부다: 기기에 아무것도 보내지 않았으면 트레이스도 세션도 그대로다.
    expect(runner.commands).toEqual([])
    // 포인터도 살아 있어야 다음 stop 이 같은 세션을 다시 집는다.
    expect(await readActiveSession(SERIAL, home)).not.toBeNull()
  })
})
