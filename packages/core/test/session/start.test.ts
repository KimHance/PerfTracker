import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileStateFields, parseDexoptState } from '../../src/app/dexopt.js'
import {
  CompileFailedError,
  MeasurementWindowViolationError,
  PerfettoSessionError,
  SessionStateError,
} from '../../src/errors.js'
import type { CaptureManifest } from '../../src/session/manifest.js'
import {
  AM_START_PIDOF_MARKER,
  buildWarnings,
  checkCompileOption,
  COMPILE_TIMEOUT_MS,
  compileCommand,
  parseAmStart,
  parsePidof,
  splitAmStartPidof,
  startSession,
} from '../../src/session/start.js'
import { ATRACE_READY_WAIT } from '../../src/session/diagnose.js'
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
    const warnings = buildWarnings(state, {})
    expect(warnings.map((w) => w.code)).toContain('charging_during_session')
  })

  it('저전력 모드를 기록한다', () => {
    const warnings = buildWarnings({ ...state, charging: false, power_save_mode: true }, {})
    expect(warnings.map((w) => w.code)).toContain('power_save_mode_on')
  })

  it('평가가 아니라 관측만 담는다', () => {
    for (const w of buildWarnings(state, {})) {
      expect(w.message).not.toMatch(/느림|나쁨|권장|개선/)
    }
  })

  it('아무 조건도 없으면 빈 배열', () => {
    expect(buildWarnings({ ...state, charging: false }, {})).toEqual([])
  })

  it('시작 시간을 못 잰 --launch 는 사실로 기록한다', () => {
    const warnings = buildWarnings(
      { ...state, charging: false },
      { launchTimeUnmeasured: true },
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
      { launchTimeUnmeasured: true, amStartStatus: 'timeout' },
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
      `-s ${SERIAL} shell for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.product.cpu.abilist ro.soc.model ro.soc.manufacturer ro.build.fingerprint ro.opengles.version; do echo "$p=$(getprop $p)"; done`,
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
      // collectSnapshotSpecs — frame(gfxinfo) · network(netstats · packages).
      //   gfxinfo 는 누적값이라 전/후 차이가 이 세션의 값이 된다.
      `-s ${SERIAL} shell dumpsys gfxinfo com.nhn.android.webtoon`,
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

/**
 * 진단 세션 (기능 문서 diagnostic-mode). atrace slice 의 비용은 앱 프로세스 자신에게 청구되고
 * `measurement_overhead` 에 잡히지 않으므로, 평소 세션과 **갈라서** 연다. 평소 세션은 이
 * 옵션이 생기기 전과 기기로 나가는 것이 글자 하나 달라지면 안 된다.
 */
describe('startSession — 진단 세션', () => {
  /**
   * 이 옵션이 생기기 **전** 코드(HEAD a61dab8)가 fake 기기(sdk 36)에 보낸 config 원문.
   * 지금 코드에서 다시 만들어 비교하면 같은 코드끼리 비교하는 셈이라 아무것도 지키지 못한다.
   */
  const NORMAL_CONFIG_BEFORE =
    'buffers { size_kb: 65536 fill_policy: RING_BUFFER }\n' +
    'data_sources { config { name: "android.surfaceflinger.frametimeline" } }\n' +
    'data_sources { config { name: "linux.process_stats" process_stats_config { proc_stats_poll_ms: 1000 scan_all_processes_on_start: true record_process_runtime: true } } }\n' +
    'data_sources { config { name: "linux.sys_stats" sys_stats_config { stat_period_ms: 1000 stat_counters: STAT_CPU_TIMES meminfo_period_ms: 1000 meminfo_counters: MEMINFO_MEM_TOTAL meminfo_counters: MEMINFO_MEM_FREE meminfo_counters: MEMINFO_MEM_AVAILABLE meminfo_counters: MEMINFO_BUFFERS meminfo_counters: MEMINFO_CACHED meminfo_counters: MEMINFO_SWAP_CACHED meminfo_counters: MEMINFO_SWAP_TOTAL meminfo_counters: MEMINFO_SWAP_FREE } } }\n' +
    'data_sources { config { name: "linux.ftrace" ftrace_config { ftrace_events: "power/cpu_frequency" } } }\n' +
    'write_into_file: true\nfile_write_period_ms: 30000\nflush_period_ms: 30000\nduration_ms: 1800000\n'

  function diagStart(opts: { diagnose?: boolean; launch?: boolean; runner?: ReturnType<typeof startableDevice>; app?: Parameters<typeof targetApp>[0] } = {}) {
    const dirs = tempDirs()
    const runner = opts.runner ?? startableDevice()
    const adb = clientFor(runner)
    const result = startSession({ adb, serial: SERIAL }, targetApp(opts.app ?? {}), {
      launch: opts.launch ?? true,
      outDir: dirs.out,
      force: false,
      now: NOW,
      home: dirs.home,
      ...(opts.diagnose !== undefined ? { diagnose: opts.diagnose } : {}),
    })
    return { adb, runner, dirs, result }
  }

  const sentConfig = (runner: ReturnType<typeof startableDevice>): string =>
    runner.calls.find((c) => c.args.join(' ').includes('--detach=perftracker_'))?.input ?? ''

  it('DM-1 core — 안 주면 평소 세션이고 기기로 나가는 config 가 지금과 글자 하나 다르지 않다', async () => {
    for (const diagnose of [undefined, false]) {
      const h = diagStart(diagnose === undefined ? {} : { diagnose })
      const session = await h.result

      expect(sentConfig(h.runner)).toBe(NORMAL_CONFIG_BEFORE)
      expect(session.options).toEqual({ launch: true })
      expect(Object.keys(session)).not.toContain('diagnose')
      const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as Record<string, unknown>
      expect(Object.keys(stored)).not.toContain('diagnose')
      expect(stored['options']).toEqual({ launch: true })
    }
  })

  it('DM-1 core — diagnose 를 주면 진단 세션으로 열리고 session.json 에 범위가 남는다', async () => {
    const h = diagStart({ diagnose: true })
    const session = await h.result

    expect(session.options).toEqual({ launch: true, diagnose: true })
    expect(session.diagnose).toEqual({
      atraceCategories: ['am', 'wm', 'view', 'dalvik'],
      atraceApps: ['com.nhn.android.webtoon'],
      notice: null,
    })
    const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as typeof session
    expect(stored.options).toEqual({ launch: true, diagnose: true })
    expect(stored.diagnose).toEqual(session.diagnose)
  })

  it('DM-3 진단 config 범위 — start 가 보낸 config 의 atrace 는 am · wm · view · dalvik + 대상 앱 하나다', async () => {
    const h = diagStart({ diagnose: true })
    await h.result
    const text = sentConfig(h.runner)
    const values = (key: string): string[] =>
      [...text.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, 'g'))].map((m) => m[1]!)

    expect(new Set(values('atrace_categories'))).toEqual(new Set(['am', 'wm', 'view', 'dalvik']))
    expect(values('atrace_categories')).toHaveLength(4)
    expect(values('atrace_apps')).toEqual(['com.nhn.android.webtoon'])
    expect(values('ftrace_events')).toEqual(['power/cpu_frequency'])
    // atrace 를 빼면 평소 config 와 duration 말고는 같다 — 다른 데이터소스는 늘지도 줄지도 않는다.
    expect(text.replace(/atrace_\w+: "[^"]*" /g, '').replace('duration_ms: 600000', 'duration_ms: 1800000')).toBe(
      NORMAL_CONFIG_BEFORE,
    )
  })

  it('DM-17 진단 최대 10분 · 평소 30분 — config 의 duration_ms 와 세션의 상한이 같은 값이다', async () => {
    const diag = diagStart({ diagnose: true })
    const diagSession = await diag.result
    expect(sentConfig(diag.runner)).toContain('duration_ms: 600000\n')
    expect(diagSession.configuredDurationMs).toBe(600_000)

    const normal = diagStart()
    const normalSession = await normal.result
    expect(sentConfig(normal.runner)).toContain('duration_ms: 1800000\n')
    expect(normalSession.configuredDurationMs).toBe(1_800_000)
  })

  /**
   * 안 바뀔 것 「측정 창 안 기기 접촉 0 — 진단 세션도」. 진단 세션은 기기 명령을 하나도 더하지
   * 않는다 — atrace 는 config 안의 키이고, 켜고 끄는 일은 perfetto(traced_probes)가 한다 (plan D15).
   */
  it('DM 진단 세션 창 안 명령 0 — 명령 목록 · 순서가 평소와 같고 창이 열린 뒤엔 하나도 못 나간다', async () => {
    const normal = diagStart()
    const normalSession = await normal.result
    const diag = diagStart({ diagnose: true })
    const diagSession = await diag.result

    // 다른 것은 앱 실행 호출 앞의 atrace 대기 조각 하나뿐이다 (D14) — 호출 수 · 순서는 같다.
    const strip = (cmds: string[], id: string): string[] =>
      cmds.map((c) => c.replaceAll(id, '<id>').replace(ATRACE_READY_WAIT, ''))
    expect(strip(diag.runner.commands, diagSession.id)).toEqual(strip(normal.runner.commands, normalSession.id))

    const detach = diag.runner.commands.findIndex((c) => c.includes('--detach=perftracker_'))
    expect(diag.runner.commands.slice(detach + 1)).toHaveLength(1)
    expect(diag.adb.window.isOpen).toBe(true)
    await expect(diag.adb.shell('getprop debug.atrace.tags.enableflags')).rejects.toBeInstanceOf(
      MeasurementWindowViolationError,
    )
  })

  /**
   * 설정 검증이 거부할 config 라면 **기기에 아무 일도 시키기 전에** 거부한다. 예전에는 config 를
   * force-stop 뒤에 만들어서 거부되면 앱만 죽은 채로 남았다 (실현성 검토 개발 #5).
   * 실제 패키지 이름에는 `*` 가 올 수 없으니, 와일드카드 검사가 start 경로에서 걸리는지로 본다.
   */
  it('DM-4 거부는 perfetto · force-stop · 스냅샷 전 — 그때까지 나간 것은 probe 뿐이다', async () => {
    const h = diagStart({ diagnose: true, app: { package: 'com.nhn.android.*' } })

    await expect(h.result).rejects.toBeInstanceOf(PerfettoSessionError)
    expect(h.runner.commands).toEqual([
      `-s ${SERIAL} shell which perfetto`,
      `-s ${SERIAL} shell perfetto --query`,
      `-s ${SERIAL} shell getprop ro.build.version.sdk`,
    ])
    // run 디렉토리도 만들지 않는다 — 거부된 세션의 빈 폴더가 기록 목록 정리 대상으로 남지 않게.
    expect(readdirSync(h.dirs.out)).toEqual([])
    expect(await readActiveSession(SERIAL, h.dirs.home)).toBeNull()
  })

  /**
   * plan D14 — 실기기(SM-S901N · YouTube)로 정했다. `--detach` 는 세션을 연 즉시 돌아오고 atrace 는
   * 그 뒤에 켜진다. 기다리지 않은 1회는 앱 slice 12,042개 가운데 `bindApplication` 이 0개였고,
   * 기다린 1회는 1개(68.2 ms)였다. 기다림은 앱 실행과 **같은 셸 호출** 안이라 트레이스 시작과
   * 래치 무장 사이의 왕복은 그대로 1회다 (위 「adb 호출이 정확히 하나다」 와 같은 계약).
   */
  it('D14 진단 --launch 는 같은 호출 안에서 atrace 가 켜지길 기다린 뒤 앱을 띄운다', async () => {
    const h = diagStart({ diagnose: true })
    await h.result

    const detach = h.runner.commands.findIndex((c) => c.includes('--detach=perftracker_'))
    const inWindow = h.runner.commands.slice(detach + 1)
    expect(inWindow).toHaveLength(1)
    const call = inWindow[0]!
    expect(call.startsWith(`-s ${SERIAL} shell ${ATRACE_READY_WAIT}am start -W -n `)).toBe(true)
    // 읽기만 한다 — setprop 은 없다 (plan D15). 상한이 있어 기기가 답하지 않아도 세션이 서지 않는다.
    expect(ATRACE_READY_WAIT).toContain('getprop debug.atrace.tags.enableflags')
    expect(ATRACE_READY_WAIT).toContain('getprop debug.atrace.app_number')
    expect(ATRACE_READY_WAIT).toMatch(/while \[ \$i -lt 50 \]/)
    expect(ATRACE_READY_WAIT).not.toMatch(/setprop/)
  })

  it('D14 대기 조각이 붙어도 앱 실행 결과(TotalTime · pid)는 평소처럼 읽힌다', async () => {
    const session = await diagStart({ diagnose: true }).result

    expect(session.startup?.totalTimeMs).toBe(1842)
    expect(session.appPid).toBe(24193)
  })

  it('D14 평소 세션 · --launch 없는 진단 세션은 atrace 속성을 읽지 않는다', async () => {
    const normal = diagStart()
    await normal.result
    const noLaunch = diagStart({ diagnose: true, launch: false })
    await noLaunch.result

    for (const runner of [normal.runner, noLaunch.runner]) {
      expect(runner.commands.some((c) => c.includes('debug.atrace'))).toBe(false)
    }
  })

  describe('DM-10 start 고지 — 조건 표의 "모름" 칸이면 세션은 열고 고지 줄을 싣는다', () => {
    const sdk = (n: number) =>
      startableDevice((r) => {
        r.on(`-s ${SERIAL} shell getprop ro.build.version.sdk`, { stdout: `${n}\n` })
      })

    it('DM-10 start 고지 — sdk ≤30 · debuggable 아님', async () => {
      const session = await diagStart({ diagnose: true, runner: sdk(30), app: { debuggable: false } }).result
      expect(session.diagnose?.notice).toBe('앱 slice 열림 모름 — sdk 30 · debuggable 아님')
    })

    it('DM-10 start 고지 — sdk ≤30 · debuggable 모름 (null · 필드 없음)', async () => {
      for (const app of [{ debuggable: null }, {}]) {
        const session = await diagStart({ diagnose: true, runner: sdk(30), app }).result
        expect(session.diagnose?.notice).toBe('앱 slice 열림 모름 — sdk 30 · debuggable 모름')
      }
    })

    it('DM-10 start 고지 — 열리는 칸이면 고지가 없다 (sdk ≥31 · sdk ≤30 + debuggable)', async () => {
      expect((await diagStart({ diagnose: true, runner: sdk(31), app: { debuggable: false } }).result).diagnose?.notice).toBeNull()
      expect((await diagStart({ diagnose: true, runner: sdk(30), app: { debuggable: true } }).result).diagnose?.notice).toBeNull()
    })

    it('DM-10 start 고지 — 평소 세션엔 고지 자리도 없다', async () => {
      const session = await diagStart({ runner: sdk(30), app: { debuggable: false } }).result
      expect(session.diagnose).toBeUndefined()
    })
  })
})

/**
 * `--compile` (기능 문서 baseline-profile BP-4 core 쪽). 기기 원문은 실측 픽스처 — 바꾸기 전은 YouTube 해석 출력
 * (`speed-profile` / `profile-utilization`), 바꾼 뒤는 `--reset` 직후 출력(`verify` / `vdex-dm`)이다.
 */
describe('startSession — --compile (BP-4)', () => {
  const YT = 'com.google.android.youtube'
  const fixture = (n: string): string =>
    readFileSync(fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), 'utf8')
  const BEFORE = fixture('dumpsys-package-dexopt-youtube.txt')
  const AFTER = fixture('dumpsys-package-dexopt-reset.txt')
  const DUMPSYS = `-s ${SERIAL} shell dumpsys package '${YT}'`
  /** 대상 앱 해석이 낸 것과 같은 `target_app` — 시작 칸이 바꾸기 전 출력에서 온다. */
  const ytApp = {
    package: YT,
    launcher_activity: 'com.google.android.apps.youtube.app.watchwhile.MainActivity',
    ...compileStateFields('start', parseDexoptState(BEFORE, YT)),
  }

  function compileDevice(
    compile: { stdout?: string; stderr?: string; code?: number; timedOut?: true } = { stdout: 'Success\n' },
    dumpsys: { stdout?: string; code?: number } = { stdout: AFTER },
  ) {
    return startableDevice((r) => r.onMatch(/shell cmd package compile /, compile).on(DUMPSYS, dumpsys))
  }

  function compileStart(
    opts: {
      compile?: string
      /** true 면 `compile` 키 자체를 넘기지 않는다 — 평소 세션. */
      noCompile?: true
      launch?: boolean
      diagnose?: boolean
      force?: boolean
      runner?: ReturnType<typeof startableDevice>
      app?: Parameters<typeof targetApp>[0]
      home?: string
    } = {},
  ) {
    const dirs = tempDirs()
    const home = opts.home ?? dirs.home
    const runner = opts.runner ?? compileDevice()
    const adb = clientFor(runner)
    const result = startSession({ adb, serial: SERIAL }, targetApp(opts.app ?? ytApp), {
      launch: opts.launch ?? true,
      outDir: dirs.out,
      force: opts.force ?? false,
      now: NOW,
      home,
      ...(opts.diagnose !== undefined ? { diagnose: opts.diagnose } : {}),
      ...(opts.noCompile === true ? {} : { compile: opts.compile ?? 'speed' }),
    })
    return { adb, runner, dirs, home, result }
  }

  const manifestOf = (runDir: string): CaptureManifest =>
    JSON.parse(readFileSync(join(runDir, 'capture.json'), 'utf8')) as CaptureManifest

  const PROBE = [
    `-s ${SERIAL} shell which perfetto`,
    `-s ${SERIAL} shell perfetto --query`,
    `-s ${SERIAL} shell getprop ro.build.version.sdk`,
  ]

  it('BP-4 명령 꼴 그대로 — reset 은 --reset · 그 밖은 -m <값> -f · 범위 옵션 없음', () => {
    expect(compileCommand('reset', YT)).toBe(`cmd package compile --reset '${YT}'`)
    expect(compileCommand('speed-profile', YT)).toBe(`cmd package compile -m speed-profile -f '${YT}'`)
    expect(compileCommand('speed', YT)).toBe(`cmd package compile -m speed -f '${YT}'`)
    for (const v of ['reset', 'speed-profile', 'speed'] as const) {
      expect(compileCommand(v, YT)).not.toMatch(/--primary-dex|--secondary-dex|--include-dependencies|--split/)
    }
  })

  /**
   * 평소 세션 목록(위 「기기로 나가는 명령 전체가 이 목록과 정확히 같다」)에 **probe 바로 뒤 두 줄**만 끼고
   * 그 밖 줄 · 순서는 같다. compile 은 설정 검증(probe 뒤 config 조립) 뒤, 기기 스펙 · 시작 스냅샷 · force-stop ·
   * perfetto 앞이다.
   */
  it('BP-4 compile 은 DM-4 뒤 · 시작 스냅샷 · perfetto · force-stop 전 — 명령 목록에 probe 뒤 두 줄만 낀다', async () => {
    const normal = start({ launch: true, app: ytApp })
    const normalSession = await normal.result
    const plain = normal.runner.commands.map((c) => c.replaceAll(normalSession.id, '<id>'))

    const h = compileStart({ compile: 'speed' })
    const session = await h.result
    const commands = h.runner.commands.map((c) => c.replaceAll(session.id, '<id>'))

    expect(commands).toEqual([
      ...PROBE,
      `-s ${SERIAL} shell cmd package compile -m speed -f '${YT}'`,
      DUMPSYS,
      ...plain.slice(PROBE.length),
    ])
    expect(plain.slice(0, PROBE.length)).toEqual(PROBE)
    const at = (needle: string) => commands.findIndex((c) => c.includes(needle))
    expect(at('cmd package compile')).toBeLessThan(at('getprop $p'))
    expect(at('cmd package compile')).toBeLessThan(at('dumpsys battery'))
    expect(at('cmd package compile')).toBeLessThan(at('am force-stop'))
    expect(at('cmd package compile')).toBeLessThan(at('--detach=perftracker_'))
  })

  it('BP-4 compile 은 DM-4 뒤 — 설정 검증이 거부하면 compile 도 0 · 나간 것은 probe 뿐', async () => {
    const h = compileStart({ compile: 'speed', diagnose: true, app: { ...ytApp, package: 'com.google.*' } })

    await expect(h.result).rejects.toBeInstanceOf(PerfettoSessionError)
    expect(h.runner.commands).toEqual(PROBE)
    expect(readdirSync(h.dirs.out)).toEqual([])
  })

  it('BP-4 --launch 없으면 거부 — 기기 명령 0 · run 디렉토리 0', async () => {
    const h = compileStart({ compile: 'speed', launch: false })

    await expect(h.result).rejects.toThrow(new SessionStateError('--compile 은 --launch 와만 · 기기 명령 0'))
    expect(h.runner.commands).toEqual([])
    expect(readdirSync(h.dirs.out)).toEqual([])
    expect(await readActiveSession(SERIAL, h.home)).toBeNull()
  })

  it('BP-4 --launch 없으면 거부 — --force 의 옛 세션 정리(기기 명령)보다도 먼저', async () => {
    const dirs = tempDirs()
    const old = await start({ home: dirs.home }).result
    await writeActiveSession(old, dirs.home)

    const h = compileStart({ compile: 'reset', launch: false, force: true, home: dirs.home })

    await expect(h.result).rejects.toBeInstanceOf(SessionStateError)
    expect(h.runner.commands).toEqual([])
    expect((await readActiveSession(SERIAL, dirs.home))?.id).toBe(old.id)
  })

  it('BP-4 허용 밖 값 거부 — 기기 명령 0 · 받는 값 셋을 말한다', async () => {
    for (const value of ['verify', 'SPEED', '', 'speed -f --secondary-dex', 'speed-profile ']) {
      const h = compileStart({ compile: value })

      await expect(h.result).rejects.toThrow(
        new SessionStateError(`--compile ${value} · 받는 값 reset · speed-profile · speed · 기기 명령 0`),
      )
      expect(h.runner.commands).toEqual([])
      expect(readdirSync(h.dirs.out)).toEqual([])
    }
  })

  it('BP-4 허용 밖 값 거부 — 입구 검사는 기기 없이 값 · --launch 를 본다 (cli 가 앱 해석 전에 부른다)', () => {
    expect(checkCompileOption({ launch: true })).toBeNull()
    expect(checkCompileOption({ launch: false })).toBeNull()
    expect(checkCompileOption({ launch: true, compile: 'reset' })).toBe('reset')
    expect(checkCompileOption({ launch: true, compile: 'speed-profile' })).toBe('speed-profile')
    expect(checkCompileOption({ launch: true, compile: 'speed' })).toBe('speed')
    expect(() => checkCompileOption({ launch: true, compile: 'verify' })).toThrow(SessionStateError)
    expect(() => checkCompileOption({ launch: false, compile: 'speed' })).toThrow(SessionStateError)
  })

  it('BP-4 compile 시간 한도 — compile 호출에만 10분을 넘기고 다른 호출은 기본 한도 그대로', async () => {
    const h = compileStart({ compile: 'speed' })
    await h.result

    expect(COMPILE_TIMEOUT_MS).toBe(600_000)
    // 실측 67.5초(speed)보다 길어야 한다 — 기본 60초면 기기는 계속 컴파일하는데 세션만 실패로 끝난다.
    expect(COMPILE_TIMEOUT_MS).toBeGreaterThan(67_500)
    const limited = h.runner.calls.filter((c) => c.timeoutMs !== undefined)
    expect(limited.map((c) => [c.args.join(' '), c.timeoutMs])).toEqual([
      [`-s ${SERIAL} shell cmd package compile -m speed -f '${YT}'`, 600_000],
    ])
  })

  describe('BP-4 실패하면 세션 안 엶 · run 디렉토리 0', () => {
    const cases = [
      { name: '종료 코드 ≠ 0', reply: { code: 255, stderr: 'cmd: Failure calling service package\n' }, exit: 255, timedOut: false },
      { name: '종료 코드 0 · 출력 Failure', reply: { stdout: 'Failure: package com.google.android.youtube could not be compiled\n' }, exit: 0, timedOut: false },
      { name: '한도 넘음', reply: { code: 1, timedOut: true as const }, exit: null, timedOut: true },
    ]
    for (const c of cases) {
      it(`BP-4 실패하면 세션 안 엶 · run 디렉토리 0 — ${c.name}`, async () => {
        const h = compileStart({ compile: 'speed', runner: compileDevice(c.reply) })

        const err = await h.result.then(
          () => null,
          (e: unknown) => e,
        )
        expect(err).toBeInstanceOf(CompileFailedError)
        const f = err as CompileFailedError
        expect(f.value).toBe('speed')
        expect(f.command).toBe(`cmd package compile -m speed -f '${YT}'`)
        expect(f.exitCode).toBe(c.exit)
        expect(f.timedOut).toBe(c.timedOut)
        expect(f.message.split('\n')[0]).toBe(
          c.timedOut ? '컴파일 한도 10분 넘음 · 세션 안 엶' : `컴파일 실패 · 세션 안 엶 · exit ${String(c.exit)}`,
        )
        // probe 와 compile 뿐 — 실패 뒤 상태 읽기(dumpsys) · 스펙 · 스냅샷 · force-stop · perfetto 0.
        expect(h.runner.commands).toEqual([...PROBE, `-s ${SERIAL} shell cmd package compile -m speed -f '${YT}'`])
        expect(readdirSync(h.dirs.out)).toEqual([])
        expect(await readActiveSession(SERIAL, h.home)).toBeNull()
        expect(h.adb.window.isOpen).toBe(false)
      })
    }

    it('BP-4 실패하면 세션 안 엶 — 출력 Success 는 실패가 아니다 (Failure 는 줄 머리에서만)', async () => {
      const h = compileStart({ compile: 'speed', runner: compileDevice({ stdout: 'Success\n' }) })
      await expect(h.result).resolves.toBeDefined()
    })
  })

  it('BP-4 바꾼 뒤 상태는 다시 읽은 dumpsys — compile 바로 다음 줄 · 시작 상태가 그 출력', async () => {
    const h = compileStart({ compile: 'reset' })
    const session = await h.result

    const compileAt = h.runner.commands.indexOf(`-s ${SERIAL} shell cmd package compile --reset '${YT}'`)
    expect(compileAt).toBe(PROBE.length)
    expect(h.runner.commands[compileAt + 1]).toBe(DUMPSYS)
    expect(h.runner.commands.filter((c) => c === DUMPSYS)).toHaveLength(1)

    const app = manifestOf(session.runDir).target_app
    expect(app.compile_state_start).toEqual(parseDexoptState(AFTER, YT).lines)
    expect(app.compile_state_start?.[0]).toMatchObject({ status: 'verify', reason: 'vdex-dm' })
    expect(app.compile_state_start_reason_code).toBeNull()
    expect(app.compile_state_start_reason).toBeNull()
    // 바꾸기 전 값(대상 앱 해석의 출력)이 시작 자리에 남지 않는다.
    expect(app.compile_state_start).not.toEqual(ytApp.compile_state_start)
  })

  it('BP-4 바꾼 뒤 상태는 다시 읽은 dumpsys — 그 줄이 실패하면 시작 상태는 null + 코드 · 세션은 열린다', async () => {
    const h = compileStart({ compile: 'speed', runner: compileDevice({ stdout: 'Success\n' }, { code: 1 }) })
    const session = await h.result

    const app = manifestOf(session.runDir).target_app
    expect(app.compile_state_start).toBeNull()
    expect(app.compile_state_start_reason_code).toBe('dexopt_state_unavailable')
    expect(app.compile_state_start_reason).toBe('세션 시작 dumpsys package 출력을 받지 못함 (종료 코드 1) — 기기 연결이 끊겼을 수 있음')
  })

  it('BP-4 바꾼 기록 — 값 · 보낸 명령 원문 · 바꾸기 전 상태 · 걸린 ms 가 세션 기록에 실린다', async () => {
    const h = compileStart({ compile: 'speed-profile' })
    const session = await h.result

    expect(session.compile).toEqual({
      value: 'speed-profile',
      command: `cmd package compile -m speed-profile -f '${YT}'`,
      elapsed_ms: expect.any(Number) as number,
      compile_state_before: ytApp.compile_state_start,
      compile_state_before_reason_code: null,
      compile_state_before_reason: null,
    })
    expect(Number.isInteger(session.compile?.elapsed_ms)).toBe(true)
    expect(session.compile?.elapsed_ms).toBeGreaterThanOrEqual(0)
    // 바꾸기 전 = 대상 앱 해석의 출력 그대로 (실측 speed-profile / profile-utilization).
    expect(session.compile?.compile_state_before?.[0]).toMatchObject({ status: 'speed-profile', reason: 'profile-utilization' })
    // 보낸 명령 원문은 실제로 기기로 나간 문자열과 같다.
    expect(h.runner.commands).toContain(`-s ${SERIAL} shell ${session.compile?.command ?? ''}`)

    const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as Record<string, unknown>
    expect(stored['compile']).toEqual(session.compile)
    expect((await readActiveSession(SERIAL, h.home))?.compile).toEqual(session.compile)
  })

  it('BP-4 바꾼 기록 — 바꾸기 전 상태를 못 읽었던 앱이면 그 null 과 코드를 그대로 옮긴다', async () => {
    const unread = { ...ytApp, ...compileStateFields('start', parseDexoptState('Packages:\n', YT)) }
    const session = await compileStart({ compile: 'speed', app: unread }).result

    expect(session.compile?.compile_state_before).toBeNull()
    expect(session.compile?.compile_state_before_reason_code).toBe('dexopt_state_section_missing')
    expect(session.compile?.compile_state_before_reason).toBe(unread.compile_state_start_reason)
  })

  it('BP-4 --compile 없으면 기록 키 0 — cmd package compile 0 · target_app 은 해석한 그대로', async () => {
    const h = compileStart({ noCompile: true })
    const session = await h.result

    expect('compile' in session).toBe(false)
    const stored = JSON.parse(readFileSync(join(session.runDir, 'session.json'), 'utf8')) as Record<string, unknown>
    expect('compile' in stored).toBe(false)
    expect(h.runner.commands.some((c) => c.includes('cmd package compile'))).toBe(false)
    expect(h.runner.commands).not.toContain(DUMPSYS)
    expect(manifestOf(session.runDir).target_app).toEqual(targetApp(ytApp))
  })
})
