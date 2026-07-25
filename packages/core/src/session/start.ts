import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { frameCollector } from '../collectors/frame.js'
import { probeDevice } from '../device/probe.js'
import { collectDeviceStatic } from '../device/spec.js'
import { collectDeviceState } from '../device/state.js'
import { SessionStateError } from '../errors.js'
import { buildTraceConfig, DEFAULT_MAX_DURATION_MS } from '../perfetto/config.js'
import { remoteTracePath, startDetachedSession } from '../perfetto/session.js'
import type { DeviceState, TargetApp, Warning } from '../schema/result.js'
import { writeCaptureManifest } from './manifest.js'
import { runDirName } from './paths.js'
import {
  type ActiveSession,
  newSessionId,
  readActiveSession,
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
export function buildWarnings(stateBefore: DeviceState, options: { video: boolean }): Warning[] {
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
  return warnings
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
  const existing = await readActiveSession(ctx.serial, opts.home)
  if (existing && !opts.force) {
    throw new SessionStateError(
      `이 기기에 이미 실행 중인 세션이 있습니다: ${existing.name} (${existing.id})\n` +
        `perftracker stop 으로 끝내거나, --force 로 이전 세션을 버리고 시작하세요.`,
    )
  }

  const probe = await probeDevice(ctx.adb)
  const env = { sdkInt: probe.sdkInt, dataSources: probe.dataSources }

  const name = opts.name ?? app.label
  const id = newSessionId()
  const runDir = join(opts.outDir, runDirName(opts.now, name))
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
  const blocks = frameCollector.supports(env).supported ? frameCollector.traceConfigBlocks() : []
  if (blocks.length === 0) {
    throw new SessionStateError(
      `이 기기에서 수집 가능한 항목이 없습니다: ${frameCollector.supports(env).reason ?? '알 수 없음'}`,
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
    version: 1,
    device: {
      serial: ctx.serial,
      static: deviceStatic,
      state_before: before.state,
      state_after: null,
    },
    target_app: app,
    env,
    warnings: buildWarnings(before.state, { video: opts.video }),
    adb_commands_during_session: 0,
    artifacts: { trace: null, video: null, raw: rawFiles },
  })
  await writeRunSession(runDir, session, { state: 'running' })
  await writeActiveSession(session, opts.home)

  // 5) 여기서부터 stop 까지 기기에 어떤 명령도 보내지 않는다.
  ctx.adb.window.open()

  return session
}
