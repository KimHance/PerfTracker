import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { shellQuote } from '../adb/shell.js'
import {
  collectSnapshotSpecs,
  collectTraceConfigBlocks,
  supportedCollectors,
  COLLECTORS,
  unsupportedReasons,
} from '../collectors/registry.js'
import type { AmStartResult } from '../collectors/types.js'
import { probeDevice } from '../device/probe.js'
import { collectDeviceStatic } from '../device/spec.js'
import { collectDeviceState, runSnapshots } from '../device/state.js'
import { SessionStateError } from '../errors.js'
import { buildTraceConfig, DEFAULT_MAX_DURATION_MS } from '../perfetto/config.js'
import {
  isSessionDetached,
  remoteTracePath,
  removeRemoteTrace,
  startDetachedSession,
  stopDetachedSession,
} from '../perfetto/session.js'
import { renderReason } from '../schema/reasons.js'
import type { DeviceState, TargetApp, Warning } from '../schema/result.js'
import { CAPTURE_MANIFEST_VERSION, writeCaptureManifest } from './manifest.js'
import { runDirName } from './paths.js'
import {
  type ActiveSession,
  clearActiveSession,
  newSessionId,
  readActiveSession,
  recordAdbViolation,
  writeActiveSession,
  writeRunSession,
} from './state.js'

/**
 * `am start -W` 의 출력.
 *
 * `Status:` 를 함께 읽는 이유: 이 명령은 TotalTime 을 **못 내는 경우가 정상 흐름에 있다.**
 * 실측(에뮬레이터 API 35, 콜드 스타트 12~15초짜리 앱)에서 자주 나온 답이 이것이다:
 *
 *     Status: timeout
 *     LaunchState: UNKNOWN (-1)
 *     Activity: ...
 *     WaitTime: 11062
 *
 * ActivityManager 가 실행 완료 보고를 기다리다 포기한 것이고, 그때 TotalTime 은 아예 찍히지
 * 않는다. `Status` 를 버리면 남는 것은 "TotalTime 이 없다" 뿐이라, 도구는 그 이유를 추측할 수
 * 밖에 없다 — 이 프로젝트에서 추측은 사실 자리에 오면 안 된다.
 */
export function parseAmStart(text: string): AmStartResult {
  const total = /^TotalTime:\s*(\d+)/m.exec(text)?.[1]
  const wait = /^WaitTime:\s*(\d+)/m.exec(text)?.[1]
  const launchState = /^LaunchState:\s*(\w+)/m.exec(text)?.[1]
  const status = /^Status:\s*(\w+)/m.exec(text)?.[1]
  return {
    totalTimeMs: total !== undefined ? Number(total) : null,
    launchState: launchState ?? null,
    status: status ?? null,
    waitTimeMs: wait !== undefined ? Number(wait) : null,
  }
}

/**
 * `am start -W` 와 `pidof` 를 한 셸 호출로 합칠 때 두 출력을 가르는 표시.
 *
 * 왜 합치는가: 트레이스는 `--detach` 시점에 이미 기록을 시작하고 측정 창 래치는 그보다 뒤에
 * 무장한다. 그 사이의 adb 왕복은 트레이스 안에서 일어나는 일이므로 개수 자체가 비용이다.
 * 기기 쪽 작업량은 똑같으니 왕복만 2회 → 1회로 줄인 것은 순수 이득이다.
 *
 * 왜 표시를 넣는가: 두 출력을 이어 붙이면 `pidof` 의 숫자 한 줄이 `am start` 출력의 일부처럼
 * 보일 수 있고, 반대로 `am start` 가 낸 줄을 pid 로 읽을 수도 있다. 경계를 추측하지 않는다.
 * 이 문자열은 `am start` 도 `pidof` 도 절대 찍지 않는다.
 */
export const AM_START_PIDOF_MARKER = '__perftracker_pidof__'

/** 합친 호출의 출력을 두 조각으로 가른다. 표시가 없으면 pid 쪽은 비어 있다 — 지어내지 않는다. */
export function splitAmStartPidof(text: string): { amStart: string; pidof: string } {
  const at = text.indexOf(AM_START_PIDOF_MARKER)
  if (at < 0) return { amStart: text, pidof: '' }
  return { amStart: text.slice(0, at), pidof: text.slice(at + AM_START_PIDOF_MARKER.length) }
}

/**
 * `pidof <package>` 의 출력. 못 찾으면 아무것도 안 찍고 exit 1 이므로 빈 문자열이 온다.
 * 같은 이름의 프로세스가 여럿이면 공백으로 이어 찍는데, 그중 어느 것이든 그 앱의 프로세스다.
 */
export function parsePidof(text: string): number | null {
  const first = text.trim().split(/\s+/)[0]
  if (first === undefined || !/^\d+$/.test(first)) return null
  return Number(first)
}

/** 관측된 사실만 담는다. "느립니다" 같은 평가는 들어가지 않는다. */
export function buildWarnings(
  stateBefore: DeviceState,
  options: {
    video: boolean
    launchTimeUnmeasured?: boolean
    /** `am start -W` 의 `Status:` 원문. 있으면 경고가 추측 대신 그것을 인용한다. */
    amStartStatus?: string | null
    /** 진입점이 여럿이라 골라야 했을 때의 후보 전체. 고르지 않았으면 null/undefined. */
    launcherCandidates?: string[] | null
    /** 그중 실제로 띄운 것. */
    launcherActivity?: string | null
  },
): Warning[] {
  const warnings: Warning[] = []

  if (stateBefore.charging === true) {
    warnings.push({
      code: 'charging_during_session',
      message: 'USB 충전 중이었음 — thermal/power 지표에 영향 가능',
    })
  }
  if (stateBefore.power_save_mode === true) {
    warnings.push({ code: 'power_save_mode_on', message: '저전력 모드가 켜져 있었음' })
  }
  if (options.video) {
    warnings.push({
      code: 'video_capture_enabled',
      message: 'screenrecord 오버헤드가 섞인 세션임',
    })
  }
  // 앱에 런처 진입점이 여러 개라 이 도구가 하나를 골랐다. 고른 사실을 숨기지 않는다 —
  // 다른 진입점을 띄웠다면 그 세션은 다른 화면을 잰 것이고, 그건 숫자만 보고는 알 수 없다.
  // (디버그 빌드에서 흔하다: LeakCanary 가 자기 런처 아이콘을 추가한다.)
  if (options.launcherCandidates != null && options.launcherCandidates.length > 1) {
    const others = options.launcherCandidates.filter((a) => a !== options.launcherActivity)
    warnings.push({
      code: 'launcher_activity_ambiguous',
      message:
        `이 앱은 런처 진입점이 ${options.launcherCandidates.length}개라 ` +
        `${options.launcherActivity} 로 실행했음 — 나머지: ${others.join(', ')}`,
    })
  }
  // 옛 코드는 `app_launch_unverified` 와 "force-stop 된 앱이 다시 실행되지 않았을 수 있음" 이었다.
  // 실측한 실패 사례에서 앱은 실제로 실행됐고(pid 확보, 프레임 수집됨) `am start -W` 만
  // `Status: timeout` 을 냈다 — 경고가 관측하지 않은 원인을 지어내고 있었다.
  // 이 경고가 아는 것은 하나다: **이 세션에서 시작 시간을 못 쟀다.**
  if (options.launchTimeUnmeasured === true) {
    const status =
      options.amStartStatus != null && options.amStartStatus.length > 0
        ? ` (Status: ${options.amStartStatus})`
        : ''
    warnings.push({
      code: 'app_launch_time_unmeasured',
      message:
        `am start -W 가 TotalTime 을 보고하지 않아 앱 시작 시간을 재지 못했음${status} — ` +
        `앱 실행 여부는 이 경고가 말하지 않음 (target_app.pid 와 metrics 참고)`,
    })
  }
  return warnings
}

/**
 * `--force` 는 로컬 포인터만 버려서는 안 된다. 옛 perfettoKey 가 유실되면 그 tracer 를 멈출
 * 방법이 영원히 사라져, 남은 duration_ms(최대 30분) 동안 새 측정과 **동시에** 돈다 —
 * 옛 tracer 가 새 측정이 재는 대상의 일부가 된다. 트레이스 파일도 기기에 영구히 남는다.
 * 이전 세션 정리 실패가 새 측정을 막을 이유는 없으므로 최선 노력으로 처리한다.
 */
async function discardExistingSession(adb: AdbClient, existing: ActiveSession): Promise<void> {
  try {
    if (await isSessionDetached(adb, existing.perfettoKey)) {
      await stopDetachedSession(adb, existing.perfettoKey)
    }
    await removeRemoteTrace(adb, existing.remoteTracePath)
  } catch {
    // 기기 쪽 정리는 최선 노력이다.
  }
}

/**
 * `start` 의 첫 관문. **앱 해석(=기기 접촉)보다 먼저** 불러야 한다.
 * 활성 세션이 있으면 측정 창이 열려 있으므로, 이 검사를 건너뛴 호출자는
 * "이미 세션이 있습니다" 대신 `MeasurementWindowViolationError` 를 보게 된다.
 *
 * 포인터를 지우고 끝나므로 두 번 불러도 안전하다 — `startSession` 이 자기 앞에서 다시 부른다.
 */
export async function beginStart(
  ctx: { adb: AdbClient; serial: string },
  opts: { force: boolean; home?: string },
): Promise<void> {
  const existing = await readActiveSession(ctx.serial, opts.home)
  if (existing === null) return

  if (!opts.force) {
    throw new SessionStateError(
      `이 기기에 이미 실행 중인 세션이 있습니다: ${existing.name} (${existing.id})\n` +
        `perftracker stop 으로 끝내거나, --force 로 이전 세션을 버리고 시작하세요.`,
    )
  }

  // --force 는 "이전 세션은 여기서 끝난다" 는 선언이다. 그 순간 측정 창도 닫힌다.
  ctx.adb.window.close()
  await discardExistingSession(ctx.adb, existing)
  await clearActiveSession(ctx.serial, opts.home)
}

export interface StartOptions {
  name?: string
  launch: boolean
  video: boolean
  outDir: string
  force: boolean
  now: Date
  home?: string
}

export async function startSession(
  ctx: { adb: AdbClient; serial: string },
  app: TargetApp,
  opts: StartOptions,
): Promise<ActiveSession> {
  await beginStart(ctx, { force: opts.force, ...(opts.home !== undefined ? { home: opts.home } : {}) })

  const probe = await probeDevice(ctx.adb)
  const env = { sdkInt: probe.sdkInt, dataSources: probe.dataSources }

  // --launch 는 반드시 force-stop 전에 검증한다. 켤 수 없는 것이 확실한데 먼저 죽여 버리면
  // 앱이 죽은 채로 남고, 그 상태가 측정 대상이 된다.
  if (opts.launch && app.launcher_activity === null) {
    throw new SessionStateError(
      `${app.package} 의 런처 액티비티를 찾지 못해 --launch 를 쓸 수 없습니다.\n` +
        `--launch 없이 실행한 뒤 앱을 직접 띄우세요.`,
    )
  }

  const name = opts.name ?? app.label
  const id = newSessionId()
  // 상대 경로로 저장하면 start 와 stop 사이에 cd 한 사용자가 세션을 통째로 잃는다.
  const runDir = resolve(opts.outDir, runDirName(opts.now, name, id))
  await mkdir(join(runDir, 'raw'), { recursive: true })

  // 1) 기기 스펙과 시작 스냅샷 — 측정 창을 열기 전에, 그리고 **트레이스를 켜기 전에** 끝낸다.
  //    트레이스를 켠 뒤에 dumpsys 를 부르면 그 작업이 트레이스 안에 기록되어
  //    CPU/Log/overhead 숫자에 섞인다. 창 밖이라는 것만으로는 부족하다.
  const deviceStatic = await collectDeviceStatic(ctx.adb)
  const before = await collectDeviceState(ctx.adb, opts.now)
  const beforeSnapshots = await runSnapshots(ctx.adb, collectSnapshotSpecs(env))
  const rawFiles: string[] = []
  for (const [key, text] of Object.entries({ ...before.raw, ...beforeSnapshots })) {
    const rel = join('raw', `${key}_before.txt`)
    await writeFile(join(runDir, rel), text, 'utf8')
    rawFiles.push(rel)
  }

  // 2) 콜드 상태 보장
  if (opts.launch) {
    await ctx.adb.raw(['shell', `am force-stop ${shellQuote(app.package)}`])
  }

  // 3) 측정을 먼저 켠다 — 그래야 콜드 스타트 구간이 프레임 트레이스에 포함된다.
  const perfettoKey = `perftracker_${id}`
  const remotePath = remoteTracePath(perfettoKey)
  const blocks = collectTraceConfigBlocks(env)
  if (blocks.length === 0) {
    // "수집 가능한 항목이 없습니다" 는 사실이 아니다 — startup 은 트레이스 없이도 수집된다.
    // 거부 자체는 맞다(start 는 트레이스 세션을 여는 명령이다). 이유를 정확히 말한다.
    const traceFree = supportedCollectors(env)
      .filter((c) => !c.needsTrace)
      .map((c) => c.id)
    throw new SessionStateError(
      `이 기기에서는 트레이스로 수집 가능한 항목이 없어 세션을 시작할 수 없습니다.\n  ` +
        unsupportedReasons(env).join('\n  ') +
        (traceFree.length > 0
          ? `\n트레이스 없이도 수집되는 항목(${traceFree.join(', ')})은 있지만, ` +
            `start 는 트레이스 세션을 여는 명령이라 그것만으로는 시작하지 않습니다.`
          : ''),
    )
  }
  await startDetachedSession(ctx.adb, {
    key: perfettoKey,
    remotePath,
    configText: buildTraceConfig({ dataSourceBlocks: blocks, durationMs: DEFAULT_MAX_DURATION_MS }),
  })

  // 4) 런처 액티비티를 콜드 실행하고, 같은 호출에서 그 프로세스의 pid 까지 받아 온다.
  //
  // pid 가 왜 필요한가: `linux.process_stats` 는 프로세스 이름을 최초 관측 시 한 번만 확정하고,
  // zygote 가 fork 한 앱은 `Process.setArgV0()` 전에 잠깐 `zygote64` 라는 이름을 갖는다.
  // 그 창에 폴링이 걸리면 트레이스는 앱을 영원히 `zygote64` 로 알고, 이름으로는 다시 찾을
  // 방법이 없다 (`collectors/appProcess.ts`). `--launch` 는 force-stop 후 재실행이라
  // 앱 프로세스가 **항상** 갓 fork 된 상태이므로 이 경합은 예외가 아니다.
  //
  // 왜 한 호출인가: 트레이스는 3) 의 `--detach` 에서 이미 기록을 시작했고 측정 창 래치는
  // 5) 에서야 무장한다. 그 사이의 adb 왕복은 트레이스 안에서 일어나는 일이라 개수가 곧 비용이다.
  // 기기 쪽 작업량은 그대로이므로 왕복만 2회 → 1회로 줄였다.
  // `pidof` 실패는 삼킨다 — pid 는 있으면 좋은 것이지 세션의 전제가 아니다.
  // (합친 호출의 종료 코드는 `pidof` 의 것이고, `raw` 는 종료 코드로 던지지 않는다.)
  let startup: ActiveSession['startup'] = null
  let appPid: number | null = null
  if (opts.launch && app.launcher_activity !== null) {
    const component = shellQuote(`${app.package}/${app.launcher_activity}`)
    const r = await ctx.adb.raw([
      'shell',
      `am start -W -n ${component}; echo ${AM_START_PIDOF_MARKER}; pidof ${shellQuote(app.package)}`,
    ])
    const parts = splitAmStartPidof(r.stdout)
    startup = parseAmStart(parts.amStart)
    appPid = parsePidof(parts.pidof)
  }

  const session: ActiveSession = {
    version: 1,
    id,
    name,
    serial: ctx.serial,
    packageName: app.package,
    runDir,
    perfettoKey,
    remoteTracePath: remotePath,
    startedAt: opts.now.toISOString(),
    configuredDurationMs: DEFAULT_MAX_DURATION_MS,
    options: { launch: opts.launch, video: opts.video },
    startup,
    appPid,
  }

  await writeCaptureManifest(runDir, {
    version: CAPTURE_MANIFEST_VERSION,
    device: {
      serial: ctx.serial,
      static: deviceStatic,
      state_before: before.state,
      state_after: null,
    },
    target_app: app,
    env,
    warnings: buildWarnings(before.state, {
      video: opts.video,
      launchTimeUnmeasured: opts.launch && startup?.totalTimeMs == null,
      amStartStatus: startup?.status ?? null,
      // `--launch` 로 실제로 띄운 세션에서만 의미가 있다. 안 띄웠으면 무엇을 골랐든
      // 이 세션에서 일어난 일이 아니다.
      ...(opts.launch
        ? {
            launcherCandidates: app.launcher_activity_candidates ?? null,
            launcherActivity: app.launcher_activity,
          }
        : {}),
    }),
    // 아직 세어 본 적이 없다. 0 은 "세어 봤더니 없었다" 는 뜻이라 여기 오면 거짓이다 —
    // 실제 누적은 측정 창이 열린 뒤 활성 세션 포인터에 쌓이고 stop 이 이 자리로 옮긴다.
    adb_commands_during_session: null,
    artifacts: { trace: null, video: null, raw: rawFiles },
  })
  // **이 기기에서 못 재는 지표를 세션에 남긴다.** stop 뒤 result.json 을 열어야 알 수 있던
  // 사실을 시작 시점으로 끌어올린다 — 30초를 조작하고 나서야 "프레임이 없다" 를 아는 것은
  // 측정을 한 번 더 하게 만드는 정보이고, 그것은 시작 전에 이미 알 수 있었다.
  session.unsupported = COLLECTORS.flatMap((c) => {
    const support = c.supports(env)
    return support.supported
      ? []
      : [{ id: c.id, reason: renderReason(support.reason) ?? support.reason.code }]
  })

  await writeRunSession(runDir, session, { state: 'running' })
  await writeActiveSession(session, opts.home)

  // 5) 여기서부터 stop 까지 기기에 어떤 명령도 보내지 않는다.
  //    위반은 포인터에 누적한다 — 다음 프로세스(=stop)가 그 값을 result.json 으로 옮긴다.
  ctx.adb.window.open(() => recordAdbViolation(ctx.serial, opts.home))

  return session
}
