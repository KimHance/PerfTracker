import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeasurementWindowViolationError, SessionStateError } from '../../src/errors.js'
import type { CaptureManifest } from '../../src/session/manifest.js'
import {
  AM_START_PIDOF_MARKER,
  buildWarnings,
  parseAmStart,
  parsePidof,
  splitAmStartPidof,
  startSession,
} from '../../src/session/start.js'
import { readActiveSession, writeActiveSession } from '../../src/session/state.js'
import {
  clientFor,
  SERIAL,
  startableDevice,
  targetApp,
  tempDirs,
} from '../support/fakeDevice.js'

const state = {
  captured_at: '2026-07-25T14:32:10.000Z',
  battery_level: 68,
  battery_temp_c: 34.8,
  charging: true,
  connection: 'usb' as const,
  screen_brightness: 131,
  power_save_mode: false,
  network: 'wifi',
  mem_available_kb: 3511516,
  animator_duration_scale: 1,
  thermal_zones: [],
}

describe('parseAmStart', () => {
  it('TotalTime 과 LaunchState 를 읽는다', () => {
    const text = [
      'Starting: Intent { act=android.intent.action.MAIN }',
      'Status: ok',
      'LaunchState: COLD',
      'Activity: com.foo/.Main',
      'TotalTime: 1842',
      'WaitTime: 1850',
    ].join('\n')

    expect(parseAmStart(text)).toEqual({
      totalTimeMs: 1842,
      launchState: 'COLD',
      status: 'ok',
      waitTimeMs: 1850,
    })
  })

  /**
   * 실측(에뮬레이터, API 35): 앱의 콜드 스타트가 12~15초 걸리는 환경에서 `am start -W` 가
   * 이 모양으로 답하는 경우가 흔하다. TotalTime 이 없는 이유를 기기가 이미 말하고 있으므로,
   * 그것을 버리고 "알 수 없음" 으로 뭉치지 않는다.
   */
  it('Status: timeout 을 버리지 않는다 — TotalTime 이 없는 이유가 거기 있다', () => {
    const text = [
      'Starting: Intent { cmp=com.foo/.Main }',
      'Status: timeout',
      'LaunchState: UNKNOWN (-1)',
      'Activity: com.foo/.Main',
      'WaitTime: 11062',
      'Complete',
    ].join('\n')

    expect(parseAmStart(text)).toEqual({
      totalTimeMs: null,
      launchState: 'UNKNOWN',
      status: 'timeout',
      waitTimeMs: 11062,
    })
  })

  it('없으면 null', () => {
    expect(parseAmStart('Error: Activity not started')).toEqual({
      totalTimeMs: null,
      launchState: null,
      status: null,
      waitTimeMs: null,
    })
  })
})

describe('parsePidof', () => {
  it('pid 하나를 읽는다', () => {
    expect(parsePidof('6037\n')).toBe(6037)
  })

  it('여러 개가 오면 첫 번째를 쓴다', () => {
    expect(parsePidof('6037 6099\n')).toBe(6037)
  })

  it('빈 답이면 null 이다 — pidof 는 못 찾으면 아무것도 안 찍고 exit 1 이다', () => {
    expect(parsePidof('')).toBeNull()
    expect(parsePidof('\n')).toBeNull()
  })

  it('숫자가 아니면 null 이다', () => {
    expect(parsePidof('/system/bin/sh: pidof: not found\n')).toBeNull()
  })
})

describe('buildWarnings', () => {
  it('충전 중이면 사실을 기록한다', () => {
    const warnings = buildWarnings(state, { video: false })
    expect(warnings.map((w) => w.code)).toContain('charging_during_session')
  })

  it('비디오 캡처를 켜면 오염 사실을 기록한다', () => {
    expect(buildWarnings({ ...state, charging: false }, { video: true }).map((w) => w.code)).toEqual([
      'video_capture_enabled',
    ])
  })

  it('저전력 모드를 기록한다', () => {
    const warnings = buildWarnings({ ...state, charging: false, power_save_mode: true }, { video: false })
    expect(warnings.map((w) => w.code)).toContain('power_save_mode_on')
  })

  it('평가가 아니라 관측만 담는다', () => {
    for (const w of buildWarnings(state, { video: true })) {
      expect(w.message).not.toMatch(/느림|나쁨|권장|개선/)
    }
  })

  it('아무 조건도 없으면 빈 배열', () => {
    expect(buildWarnings({ ...state, charging: false }, { video: false })).toEqual([])
  })

  it('시작 시간을 못 잰 --launch 는 사실로 기록한다', () => {
    const warnings = buildWarnings(
      { ...state, charging: false },
      { video: false, launchTimeUnmeasured: true },
    )
    expect(warnings.map((w) => w.code)).toEqual(['app_launch_time_unmeasured'])
  })

  /**
   * 옛 문구는 "force-stop 된 앱이 다시 실행되지 않았을 수 있음" 이었다. 실측한 실패 사례에서
   * 앱은 실제로 실행됐고(pid 확보, 프레임 수집됨) `am start -W` 만 `Status: timeout` 을 냈다 —
   * 경고가 관측하지도 않은 것을 추측으로 말하고 있었다.
   */
  it('경고는 관측한 것만 말한다 — 실행 실패를 추측하지 않는다', () => {
    const [warning] = buildWarnings(
      { ...state, charging: false },
      { video: false, launchTimeUnmeasured: true, amStartStatus: 'timeout' },
    )
    expect(warning!.message).toContain('timeout')
    expect(warning!.message).not.toMatch(/실행되지 않았|않았을 수 있음/)
  })
})

const NOW = new Date('2026-07-25T14:32:10.000Z')

function start(
  opts: {
    launch?: boolean
    force?: boolean
    app?: Parameters<typeof targetApp>[0]
    runner?: ReturnType<typeof startableDevice>
    home?: string
    out?: string
  } = {},
) {
  const dirs = tempDirs()
  const home = opts.home ?? dirs.home
  const out = opts.out ?? dirs.out
  const runner = opts.runner ?? startableDevice()
  const adb = clientFor(runner)

  return {
    adb,
    runner,
    home,
    out,
    result: startSession({ adb, serial: SERIAL }, targetApp(opts.app ?? {}), {
      launch: opts.launch ?? false,
      video: false,
      outDir: out,
      force: opts.force ?? false,
      now: NOW,
      home,
    }),
  }
}

describe('startSession — 오케스트레이션 불변식', () => {
  it('창을 여는 것이 마지막 동작이다 — 반환 후 어떤 adb 호출도 막힌다', async () => {
    const h = start()
    await h.result

    expect(h.adb.window.isOpen).toBe(true)
    await expect(h.adb.shell('dumpsys gfxinfo')).rejects.toBeInstanceOf(MeasurementWindowViolationError)
  })

  it('창이 열리기 전에 매니페스트와 session.json 이 이미 디스크에 있다', async () => {
    const h = start()
    const session = await h.result

    // 창이 열린 뒤에는 기기에 접촉할 수 없으므로, 이 파일들이 그보다 먼저 쓰였다는 뜻이다.
    expect(existsSync(join(session.runDir, 'capture.json'))).toBe(true)
    expect(existsSync(join(session.runDir, 'session.json'))).toBe(true)
    expect(h.adb.window.isOpen).toBe(true)
  })

  it('session.json 은 아직 running 이고 매니페스트에 트레이스가 없다', async () => {
    const h = start()
    const session = await h.result

    const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as {
      state: string
    }
    expect(stored.state).toBe('running')

    const manifest = JSON.parse(
      readFileSync(join(session.runDir, 'capture.json'), 'utf8'),
    ) as CaptureManifest
    expect(manifest.artifacts.trace).toBeNull()
    // 위반 횟수는 `stop` 이 포인터에서 거둬 오는 값이다. start 는 세어 본 적이 없으므로
    // 0 을 쓰면 안 된다 — 이 필드에서 0 은 "세어 봤더니 없었다" 라는 강한 주장이다.
    // 트레이스가 아직 null 인 것과 같은 이유로 여기도 null 이다.
    expect(manifest.adb_commands_during_session).toBeNull()
  })

  it('run 디렉토리를 절대 경로로 저장한다 — start 와 stop 사이의 cd 를 견딘다', async () => {
    const h = start()
    const session = await h.result

    expect(isAbsolute(session.runDir)).toBe(true)
    expect(isAbsolute((await readActiveSession(SERIAL, h.home))!.runDir)).toBe(true)
  })

  it('run 디렉토리 이름에 세션 id 가 들어간다 — 같은 초의 두 세션이 겹치지 않는다', async () => {
    const dirs = tempDirs()
    const first = await start({ home: dirs.home, out: dirs.out }).result
    const second = await start({ home: dirs.home, out: dirs.out, force: true }).result

    expect(first.runDir).toContain(first.id)
    expect(first.runDir).not.toBe(second.runDir)
  })

  /**
   * 원칙 1 의 트립와이어. **`dumpsys` 로 거르지 않고 목록 전체를 고정한다.**
   *
   * 옛 단언은 `commands.filter((c) => c.includes('dumpsys'))` 였는데, M3 가 추가하기로 한
   * 두 명령 중 하나가 **`pm list packages -U`** 라서 그 필터에 애초에 걸리지 않았다 —
   * "기기로 나가는 명령이 M2 와 한 개도 다르지 않다" 를 지킨다고 주장하면서 그중 하나를
   * 보지 못하는 트립와이어였다. 개수만 세는 것도 같은 이유로 안 된다: 하나가 늘고 하나가
   * 사라진 경우를 못 잡는다.
   *
   * 이 목록이 늘어난다는 것은 곧 "세션 하나가 기기에 더 많은 일을 시킨다" 는 뜻이고,
   * 그때는 **그 명령을 읽는 collector 가 어디 있는지** 가 반드시 따라와야 한다 (G4).
   */
  it('기기로 나가는 명령 전체가 이 목록과 정확히 같다', async () => {
    const h = start({ launch: true })
    const session = await h.result

    expect(h.runner.commands.map((c) => c.replaceAll(session.id, '<id>'))).toEqual([
      // probeDevice
      `-s ${SERIAL} shell which perfetto`,
      `-s ${SERIAL} shell perfetto --query`,
      `-s ${SERIAL} shell getprop ro.build.version.sdk`,
      // collectDeviceStatic
      `-s ${SERIAL} shell for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.product.cpu.abilist ro.soc.model ro.soc.manufacturer ro.build.fingerprint; do echo "$p=$(getprop $p)"; done`,
      `-s ${SERIAL} shell for c in /sys/devices/system/cpu/cpu[0-9]*; do [ -d "$c" ] && echo "$(basename $c) $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done`,
      `-s ${SERIAL} shell grep MemTotal /proc/meminfo`,
      `-s ${SERIAL} shell wm size`,
      `-s ${SERIAL} shell wm density`,
      `-s ${SERIAL} shell dumpsys display`,
      // collectDeviceState
      `-s ${SERIAL} shell dumpsys battery`,
      `-s ${SERIAL} shell dumpsys thermalservice`,
      `-s ${SERIAL} shell echo "brightness=$(settings get system screen_brightness) low_power=$(settings get global low_power) anim=$(settings get global animator_duration_scale)"`,
      `-s ${SERIAL} shell grep MemAvailable /proc/meminfo`,
      `-s ${SERIAL} shell ip route get 8.8.8.8`,
      // collectSnapshotSpecs — M3 이 늘린 둘. network collector 가 읽는다.
      `-s ${SERIAL} shell dumpsys netstats`,
      `-s ${SERIAL} shell pm list packages -U`,
      // 콜드 상태 보장 → 트레이스 → 앱 실행
      `-s ${SERIAL} shell am force-stop 'com.nhn.android.webtoon'`,
      `-s ${SERIAL} shell rm -f /data/misc/perfetto-traces/perftracker_<id>.pftrace; ` +
        `perfetto -c - --txt -o /data/misc/perfetto-traces/perftracker_<id>.pftrace --detach=perftracker_<id>`,
      `-s ${SERIAL} shell am start -W -n 'com.nhn.android.webtoon/com.naver.webtoon.splash.SplashActivity'; ` +
        `echo __perftracker_pidof__; pidof 'com.nhn.android.webtoon'`,
    ])
  })

  /**
   * M3 이 기기로 보내는 명령이 둘 늘었다. 늘어난 명령이 **트레이스를 켜기 전에** 나가는지가
   * 계약이다 — 창 밖이라는 것만으로는 부족하다. `--detach` 뒤에 dumpsys 를 부르면
   * 그 작업이 트레이스에 기록되어 CPU / Log / measurement_overhead 숫자에 섞인다.
   */
  it('스냅샷 명령은 트레이스를 켜기 전에 나간다', async () => {
    const h = start({ launch: true })
    await h.result

    const detach = h.runner.commands.findIndex((c) => c.includes('--detach=perftracker_'))
    const netstats = h.runner.commands.findIndex((c) => c.endsWith('shell dumpsys netstats'))
    const packages = h.runner.commands.findIndex((c) => c.endsWith('shell pm list packages -U'))

    expect(netstats).toBeGreaterThanOrEqual(0)
    expect(packages).toBeGreaterThanOrEqual(0)
    expect(netstats).toBeLessThan(detach)
    expect(packages).toBeLessThan(detach)
  })

  it('시작 스냅샷 원본이 raw/ 에 저장되고 artifacts.raw 에 등재된다', async () => {
    const h = start({ launch: true })
    const session = await h.result
    const manifest = JSON.parse(
      readFileSync(join(session.runDir, 'capture.json'), 'utf8'),
    ) as CaptureManifest

    expect(manifest.artifacts.raw).toContain(join('raw', 'netstats_before.txt'))
    expect(manifest.artifacts.raw).toContain(join('raw', 'packages_before.txt'))
    expect(existsSync(join(session.runDir, 'raw', 'netstats_before.txt'))).toBe(true)
  })

  /**
   * G4 를 start 경로에서 고정한다. sdk 33 기기에서는 network 가 미지원이므로
   * **그 두 명령이 기기로 나가면 안 된다** — 읽지 않을 데이터를 위해 기기를 건드리는 것이다.
   */
  it('network 가 미지원인 기기에는 그 두 명령이 나가지 않는다', async () => {
    const runner = startableDevice((r) => {
      r.on(`-s ${SERIAL} shell getprop ro.build.version.sdk`, { stdout: '33\n' })
    })
    const h = start({ launch: true, runner })
    await h.result

    expect(h.runner.commands.some((c) => c.includes('dumpsys netstats'))).toBe(false)
    expect(h.runner.commands.some((c) => c.includes('pm list packages -U'))).toBe(false)
  })

  it('트레이스를 먼저 켜고 나서 앱을 실행한다 — 콜드 스타트가 트레이스 안에 들어가야 한다', async () => {
    const h = start({ launch: true })
    await h.result

    const detach = h.runner.commands.findIndex((c) => c.includes('--detach=perftracker_'))
    const amStart = h.runner.commands.findIndex((c) => c.includes('am start -W -n'))
    const forceStop = h.runner.commands.findIndex((c) => c.includes('am force-stop'))

    expect(forceStop).toBeGreaterThanOrEqual(0)
    expect(detach).toBeGreaterThan(forceStop)
    expect(amStart).toBeGreaterThan(detach)
  })
})

/**
 * `linux.process_stats` 는 갓 fork 된 앱 프로세스를 `zygote64` 라는 이름으로 굳혀 버릴 수 있고
 * (`collectors/appProcess.ts`), 그러면 트레이스 안에서 앱을 이름으로 찾을 방법이 사라진다.
 * pid 를 알아 두는 것이 그 상황의 유일한 탈출구다.
 */
describe('startSession — 앱 pid 확보 (Defect 0)', () => {
  it('--launch 로 띄운 앱의 pid 를 세션에 남긴다', async () => {
    const h = start({ launch: true })
    const session = await h.result

    expect(session.appPid).toBe(24193)
    const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as {
      appPid: number | null
    }
    expect(stored.appPid).toBe(24193)
  })

  /**
   * 트레이스는 `--detach` 시점에 이미 기록을 시작했고 래치는 `window.open()` 에서야 무장한다.
   * 그 사이에 나가는 adb 왕복은 트레이스 안에서 일어나는 일이므로 **개수 자체가 계약**이다.
   * `am start -W` 와 `pidof` 를 한 셸 호출로 합쳐 2회를 1회로 줄였다 — 기기 쪽 작업량은
   * 동일하고 왕복만 사라진다.
   */
  it('트레이스 시작과 래치 무장 사이에 adb 호출이 정확히 하나다', async () => {
    const h = start({ launch: true })
    await h.result

    const detach = h.runner.commands.findIndex((c) => c.includes('--detach=perftracker_'))
    const inWindow = h.runner.commands.slice(detach + 1)

    expect(inWindow).toHaveLength(1)
    expect(inWindow[0]).toContain('am start -W -n')
    expect(inWindow[0]).toContain('pidof')
    // 창이 열린 뒤였다면 이 호출 자체가 MeasurementWindowViolationError 로 죽었을 것이다.
    expect(h.adb.window.isOpen).toBe(true)
  })

  it('한 호출의 출력에서 am start 와 pidof 를 구분자로 정확히 가른다', () => {
    const text =
      'Starting: Intent { cmp=com.foo/.Main }\nStatus: ok\nTotalTime: 1842\nComplete\n' +
      `${AM_START_PIDOF_MARKER}\n6037\n`
    const parts = splitAmStartPidof(text)

    expect(parseAmStart(parts.amStart).totalTimeMs).toBe(1842)
    expect(parsePidof(parts.pidof)).toBe(6037)
  })

  it('구분자가 없으면 전부 am start 출력으로 본다 — pid 를 지어내지 않는다', () => {
    const parts = splitAmStartPidof('Status: ok\nTotalTime: 1842\n')

    expect(parseAmStart(parts.amStart).totalTimeMs).toBe(1842)
    expect(parsePidof(parts.pidof)).toBeNull()
  })

  it('--launch 가 아니면 기기에 pid 를 묻지 않는다 — 그 앱은 이미 이름이 확정돼 있다', async () => {
    const h = start({ launch: false })
    const session = await h.result

    expect(session.appPid).toBeNull()
    expect(h.runner.commands.some((c) => c.includes('pidof'))).toBe(false)
  })

  it('pidof 가 실패해도 세션은 시작된다 — pid 는 있으면 좋은 것이지 전제가 아니다', async () => {
    // pidof 가 없거나(옛 toybox) 못 찾은 기기. 합친 호출은 pidof 의 종료 코드를 그대로 낸다.
    const runner = startableDevice((r) => {
      r.onMatch(/shell am start -W -n /, {
        code: 1,
        stdout: `Status: ok\nLaunchState: COLD\nTotalTime: 1842\n${AM_START_PIDOF_MARKER}\n`,
      })
    })
    const session = await start({ launch: true, runner }).result

    expect(session.appPid).toBeNull()
    expect(session.startup?.totalTimeMs).toBe(1842)
  })
})

describe('startSession — --launch 안전장치 (I2)', () => {
  it('런처 액티비티가 없으면 앱을 죽이기 전에 거부한다', async () => {
    const h = start({ launch: true, app: { launcher_activity: null } })

    await expect(h.result).rejects.toBeInstanceOf(SessionStateError)
    expect(h.runner.commands.some((c) => c.includes('am force-stop'))).toBe(false)
  })

  it('am start 가 TotalTime 을 안 내면 경고로 남긴다', async () => {
    const runner = startableDevice((r) => {
      r.onMatch(/shell am start -W -n /, { stdout: 'Error: Activity not started\n' })
    })
    const h = start({ launch: true, runner })
    const session = await h.result

    const manifest = JSON.parse(
      readFileSync(join(session.runDir, 'capture.json'), 'utf8'),
    ) as CaptureManifest
    expect(manifest.warnings.map((w) => w.code)).toContain('app_launch_time_unmeasured')
  })

  it('am start 가 낸 Status 를 세션에 그대로 남긴다 — startup 이 이걸로 사유를 가른다', async () => {
    const runner = startableDevice((r) => {
      r.onMatch(/shell am start -W -n /, {
        stdout: 'Status: timeout\nLaunchState: UNKNOWN (-1)\nWaitTime: 11062\nComplete\n',
      })
    })
    const session = await start({ launch: true, runner }).result

    expect(session.startup).toEqual({
      totalTimeMs: null,
      launchState: 'UNKNOWN',
      status: 'timeout',
      waitTimeMs: 11062,
    })
  })
})

/**
 * M3. 트레이스를 하나도 못 켜는 기기에서 세션을 거부하는 것은 맞다 — start 는 트레이스
 * 세션을 여는 명령이다. 하지만 "수집 가능한 항목이 없습니다" 는 사실이 아니었다:
 * startup 은 트레이스 없이도 수집된다. M2 가 트레이스 없는 collector 를 들이면서 생긴 불일치다.
 */
describe('startSession — 트레이스를 못 켜는 기기의 거부 문구', () => {
  /** sdk 30(frame 미달) + 데이터소스 하나도 미등록 → 트레이스 블록이 0개. */
  function traceLessDevice(): ReturnType<typeof startableDevice> {
    return startableDevice((r) => {
      r.on(`-s ${SERIAL} shell getprop ro.build.version.sdk`, { stdout: '30\n' }).on(
        `-s ${SERIAL} shell perfetto --query`,
        { stdout: 'NAME                                     PRODUCER\n' },
      )
    })
  }

  it('트레이스로 못 낸다고 말하지, 아무것도 못 낸다고 말하지 않는다', async () => {
    const h = start({ runner: traceLessDevice() })

    await expect(h.result).rejects.toBeInstanceOf(SessionStateError)
    await h.result.catch((e: Error) => {
      expect(e.message).toContain('트레이스')
      // startup 은 이 기기에서도 수집된다 — 그 사실을 지우지 않는다.
      expect(e.message).toContain('startup')
    })
  })
})

describe('startSession — --force 는 기기 쪽 세션도 정리한다 (I3)', () => {
  it('옛 perfetto 세션을 멈추고 남은 트레이스를 지운다', async () => {
    const dirs = tempDirs()
    const previous = await start({ home: dirs.home, out: dirs.out }).result

    const runner = startableDevice((r) => {
      r.on(`-s ${SERIAL} shell perfetto --is_detached=${previous.perfettoKey}`, { code: 0 })
        .on(`-s ${SERIAL} shell perfetto --attach=${previous.perfettoKey} --stop`, {})
        .on(`-s ${SERIAL} shell rm -f ${previous.remoteTracePath}`, {})
    })
    const h = start({ home: dirs.home, out: dirs.out, force: true, runner })
    await h.result

    expect(runner.commands).toContain(`-s ${SERIAL} shell perfetto --attach=${previous.perfettoKey} --stop`)
    expect(runner.commands).toContain(`-s ${SERIAL} shell rm -f ${previous.remoteTracePath}`)
  })

  it('옛 세션 정리에 실패해도 새 세션은 시작된다', async () => {
    const dirs = tempDirs()
    const previous = await start({ home: dirs.home, out: dirs.out }).result

    // is_detached 는 살아 있다고 하는데 attach 는 실패하는 상태.
    const runner = startableDevice((r) => {
      r.on(`-s ${SERIAL} shell perfetto --is_detached=${previous.perfettoKey}`, { code: 0 })
        .on(`-s ${SERIAL} shell perfetto --attach=${previous.perfettoKey} --stop`, {
          code: 1,
          stderr: 'Session not found',
        })
    })
    const h = start({ home: dirs.home, out: dirs.out, force: true, runner })

    await expect(h.result).resolves.toMatchObject({ serial: SERIAL })
  })

  it('--force 없이 기존 세션이 있으면 기기를 건드리지 않고 거부한다', async () => {
    const dirs = tempDirs()
    const previous = await start({ home: dirs.home, out: dirs.out }).result
    await writeActiveSession(previous, dirs.home)

    const runner = startableDevice()
    const h = start({ home: dirs.home, out: dirs.out, runner })

    await expect(h.result).rejects.toBeInstanceOf(SessionStateError)
    expect(runner.commands).toEqual([])
  })
})
