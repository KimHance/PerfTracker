import type { AdbContext } from '../adb/context.js'
import { loadLabelCache } from './label/cache.js'
import { resolveAppLabel } from './label/resolve.js'
import { type LabeledApp, listInstalledApps } from './list.js'

/**
 * 설치된 서드파티 앱 전체에 라벨을 붙인다.
 *
 * 포맷팅이 아니라 도메인 로직이라 core 에 있다 — CLI 뿐 아니라 계획된 GUI 도 같은 목록을 쓴다.
 * 런처 액티비티는 요청하지 않는다: 목록에 필요 없고, 요청하면 캐시가 100% 적중해도
 * 설치된 앱 수만큼 adb 왕복이 생긴다.
 */
export async function loadLabeledApps(ctx: AdbContext): Promise<LabeledApp[]> {
  const installed = await listInstalledApps(ctx.adb)
  const cache = await loadLabelCache(ctx.serial)

  const labeled: LabeledApp[] = []
  for (const app of installed) {
    const resolved = await resolveAppLabel(ctx.adb, app.packageName, {
      cache,
      versionCode: app.versionCode,
    })
    labeled.push({ ...app, label: resolved.label, labelSource: resolved.source })
  }

  await cache.save()
  return labeled.sort((a, b) => a.label.localeCompare(b.label))
}
