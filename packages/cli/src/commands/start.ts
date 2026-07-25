import {
  detectForegroundPackage,
  getAppDetail,
  listInstalledApps,
  loadLabelCache,
  matchApp,
  resolveAppLabel,
  startSession,
  type TargetApp,
} from '@perftracker/core'
import { AppNotFoundError } from '@perftracker/core'
import type { CliContext } from '../context.js'
import { loadLabeledApps } from './apps.js'

async function resolveTargetApp(ctx: CliContext, query: string | undefined): Promise<TargetApp> {
  const installed = await listInstalledApps(ctx.adb)

  let packageName: string
  if (query === undefined) {
    const foreground = await detectForegroundPackage(ctx.adb)
    if (foreground === null) {
      throw new AppNotFoundError('(포그라운드 앱 없음) --app 으로 대상을 지정하세요')
    }
    packageName = foreground
  } else if (installed.some((a) => a.packageName === query)) {
    packageName = query
  } else {
    // 라벨로 찾아야 할 때만 전체 라벨을 해석한다 (첫 회 이후는 캐시된다).
    packageName = matchApp(await loadLabeledApps(ctx), query).packageName
  }

  const entry = installed.find((a) => a.packageName === packageName)
  const cache = await loadLabelCache(ctx.serial)
  const label = await resolveAppLabel(ctx.adb, packageName, {
    cache,
    versionCode: entry?.versionCode ?? null,
    // 여기서만 런처 액티비티가 필요하다 (--launch). 목록 경로는 켜지 않는다.
    withLauncherActivity: true,
  })
  await cache.save()

  const detail = await getAppDetail(ctx.adb, packageName)

  return {
    package: packageName,
    label: label.label,
    label_source: label.source,
    version_name: detail.versionName,
    version_code: entry?.versionCode ?? null,
    uid: entry?.uid ?? null,
    install_source: detail.installSource,
    launcher_activity: label.launcherActivity,
    render_process: null,
    pid: null,
  }
}

export async function runStart(
  ctx: CliContext,
  opts: { app?: string; name?: string; launch: boolean; video: boolean; out: string; force: boolean },
): Promise<string> {
  const app = await resolveTargetApp(ctx, opts.app)
  const now = new Date()

  const session = await startSession(ctx, app, {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    launch: opts.launch,
    video: opts.video,
    outDir: opts.out,
    force: opts.force,
    now,
  })

  const startup =
    session.startup !== null && session.startup.totalTimeMs !== null
      ? `\nStartup   TotalTime ${session.startup.totalTimeMs}ms · ${session.startup.launchState ?? '-'}`
      : ''

  return (
    `측정을 시작했습니다.\n` +
    `Session   ${session.name}  (${session.id})\n` +
    `App       ${app.label}  ${app.package}\n` +
    `Run dir   ${session.runDir}${startup}\n\n` +
    `기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.\n` +
    `측정 중에는 기기에 어떤 명령도 보내지 않습니다.`
  )
}
