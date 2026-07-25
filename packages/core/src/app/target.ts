import type { AdbContext } from '../adb/context.js'
import { AppNotFoundError } from '../errors.js'
import type { TargetApp } from '../schema/result.js'
import { getAppDetail } from './detail.js'
import { loadLabelCache } from './label/cache.js'
import { resolveAppLabel } from './label/resolve.js'
import { loadLabeledApps } from './labeled.js'
import { listInstalledApps } from './list.js'
import { detectForegroundPackage, matchApp } from './select.js'

/**
 * "무엇을 측정할지"를 정한다: 포그라운드 감지 → 패키지/라벨 매칭 → 라벨 해석 →
 * TargetApp 조립. 이건 포맷팅이 아니라 도메인 로직이고, CLI 도 GUI 도 똑같이 필요하다.
 *
 * `query` 를 생략하면 지금 포그라운드에 있는 앱을 고른다.
 * 라벨 전체 해석은 라벨로 찾아야 할 때만 한다 (패키지명이 정확히 오면 건너뛴다).
 */
export async function resolveTargetApp(ctx: AdbContext, query?: string): Promise<TargetApp> {
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
    packageName = matchApp(await loadLabeledApps(ctx), query).packageName
  }

  const entry = installed.find((a) => a.packageName === packageName)
  const cache = await loadLabelCache(ctx.serial)
  const label = await resolveAppLabel(ctx.adb, packageName, {
    cache,
    versionCode: entry?.versionCode ?? null,
    // --launch 가 쓸 런처 액티비티가 필요한 유일한 지점이다.
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
    // 렌더 프로세스와 pid 는 트레이스를 파싱해야 알 수 있다 — extract 가 채운다.
    render_process: null,
    pid: null,
  }
}
