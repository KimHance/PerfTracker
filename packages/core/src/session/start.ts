import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { frameCollector } from '../collectors/frame.js'
import { probeDevice } from '../device/probe.js'
import { collectDeviceStatic } from '../device/spec.js'
import { collectDeviceState } from '../device/state.js'
import { SessionStateError } from '../errors.js'
import { buildTraceConfig, DEFAULT_MAX_DURATION_MS } from '../perfetto/config.js'
import {
  isSessionDetached,
  remoteTracePath,
  removeRemoteTrace,
  startDetachedSession,
  stopDetachedSession,
} from '../perfetto/session.js'
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

export function parseAmStart(text: string): { totalTimeMs: number | null; launchState: string | null } {
  const total = /^TotalTime:\s*(\d+)/m.exec(text)?.[1]
  const launchState = /^LaunchState:\s*(\w+)/m.exec(text)?.[1]
  return {
    totalTimeMs: total !== undefined ? Number(total) : null,
    launchState: launchState ?? null,
  }
}

/** 관측된 사실만 담는다. "느립니다" 같은 평가는 들어가지 않는다. */
export function buildWarnings(
  stateBefore: DeviceState,
  options: { video: boolean; launchUnverified?: boolean },
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
  if (options.launchUnverified === true) {
    warnings.push({
      code: 'app_launch_unverified',
      message:
        'am start 가 TotalTime 을 보고하지 않았음 — force-stop 된 앱이 다시 실행되지 않았을 수 있음',
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

  // 1) 기기 스펙과 시작 스냅샷 — 측정 창을 열기 전에 끝낸다.
  const deviceStatic = await collectDeviceStatic(ctx.adb)
  const before = await collectDeviceState(ctx.adb, opts.now)
  const rawFiles: string[] = []
  for (const [key, text] of Object.entries(before.raw)) {
    const rel = join('raw', `${key}_before.txt`)
    await writeFile(join(runDir, rel), text, 'utf8')
    rawFiles.push(rel)
  }

  // 2) 콜드 상태 보장
  if (opts.launch) {
    await ctx.adb.raw(['shell', `am force-stop ${app.package}`])
  }

  // 3) 측정을 먼저 켠다 — 그래야 콜드 스타트 구간이 프레임 트레이스에 포함된다.
  const perfettoKey = `perftracker_${id}`
  const remotePath = remoteTracePath(perfettoKey)
  const support = frameCollector.supports(env)
  const blocks = support.supported ? frameCollector.traceConfigBlocks() : []
  if (blocks.length === 0) {
    throw new SessionStateError(
      `이 기기에서 수집 가능한 항목이 없습니다: ${support.reason ?? '알 수 없음'}`,
    )
  }
  await startDetachedSession(ctx.adb, {
    key: perfettoKey,
    remotePath,
    configText: buildTraceConfig({ dataSourceBlocks: blocks, durationMs: DEFAULT_MAX_DURATION_MS }),
  })

  // 4) 런처 액티비티를 콜드 실행하고 시작 시간을 잰다.
  let startup: ActiveSession['startup'] = null
  if (opts.launch && app.launcher_activity !== null) {
    const r = await ctx.adb.raw(['shell', `am start -W -n ${app.package}/${app.launcher_activity}`])
    startup = parseAmStart(r.stdout)
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
      launchUnverified: opts.launch && startup?.totalTimeMs == null,
    }),
    adb_commands_during_session: 0,
    artifacts: { trace: null, video: null, raw: rawFiles },
  })
  await writeRunSession(runDir, session, { state: 'running' })
  await writeActiveSession(session, opts.home)

  // 5) 여기서부터 stop 까지 기기에 어떤 명령도 보내지 않는다.
  //    위반은 포인터에 누적한다 — 다음 프로세스(=stop)가 그 값을 result.json 으로 옮긴다.
  ctx.adb.window.open(() => recordAdbViolation(ctx.serial, opts.home))

  return session
}
