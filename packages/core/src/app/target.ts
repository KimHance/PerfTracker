import type { AdbContext } from '../adb/context.js'
import { AppNotFoundError } from '../errors.js'
import type { TargetApp } from '../schema/result.js'
import { getAppDetail } from './detail.js'
import { loadLabelCache } from './label/cache.js'
import { resolveAppLabel } from './label/resolve.js'
import { loadLabeledApps } from './labeled.js'
import { listAllPackages } from './list.js'
import { detectForegroundPackage, matchApp } from './select.js'

/**
 * "무엇을 측정할지"를 정한다: 포그라운드 감지 → 패키지/라벨 매칭 → 라벨 해석 →
 * TargetApp 조립. 이건 포맷팅이 아니라 도메인 로직이고, CLI 도 GUI 도 똑같이 필요하다.
 *
 * `query` 를 생략하면 지금 포그라운드에 있는 앱을 고른다.
 * 라벨 전체 해석은 라벨로 찾아야 할 때만 한다 (패키지명이 정확히 오면 건너뛴다).
 *
 * **목록은 `listAllPackages`(시스템 앱 포함) 에서 온다.** 여기가 `uid` 와 `version_code` 의
 * 출처이기 때문이다. 서드파티 목록(`-3`)으로 uid 를 해석하면 시스템 앱을 대상으로 삼은
 * 세션에서 도구가 "이 앱의 uid 를 모른다" 고 말하게 되는데, 그것은 거짓이다 — 기기는
 * 그 답을 주고 있고 이 도구는 매 세션 그 목록을 통째로 저장까지 한다.
 * 라벨 검색(`matchApp`)만 **열 수 있는 앱** 목록을 쓴다 (`listLaunchableApps`): 562개
 * 패키지의 라벨을 해석할 수는 없고, 사람이 이름으로 부르는 앱은 런처에 뜨는 것들이다.
 */
export async function resolveTargetApp(ctx: AdbContext, query?: string): Promise<TargetApp> {
  const installed = await listAllPackages(ctx.adb)

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
    launcher_activity_candidates: label.launcherCandidates,
    // 렌더 프로세스와 pid 는 트레이스를 파싱해야 알 수 있다 — extract 가 채운다.
    pid: null,
    // 아래 다섯도 위 둘과 같은 `dumpsys package` 출력에서 온다 (adb 왕복이 늘지 않는다).
    debuggable: detail.debuggable,
    large_heap: detail.largeHeap,
    min_sdk: detail.minSdk,
    target_sdk: detail.targetSdk,
    primary_cpu_abi: detail.primaryCpuAbi,
  }
}
