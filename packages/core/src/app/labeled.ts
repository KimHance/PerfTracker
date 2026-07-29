import type { AdbContext } from '../adb/context.js'
import { loadLabelCache } from './label/cache.js'
import { resolveAppLabel } from './label/resolve.js'
import { type LabeledApp, listLaunchableApps } from './list.js'

/**
 * **사람이 눌러서 열 수 있는 앱** 전체에 라벨을 붙인다.
 *
 * 포맷팅이 아니라 도메인 로직이라 core 에 있다 — CLI 의 `apps`, GUI 의 앱 선택, `--app` 의
 * 라벨 검색이 전부 이 목록 하나를 본다. 그래서 여기가 틀리면 세 곳이 같이 틀린다
 * (실제로 그랬다 — `listLaunchableApps` 주석 참고).
 *
 * 런처 액티비티는 요청하지 않는다: 목록에 필요 없고, 요청하면 캐시가 100% 적중해도
 * 설치된 앱 수만큼 adb 왕복이 생긴다.
 */
export async function loadLabeledApps(ctx: AdbContext): Promise<LabeledApp[]> {
  const installed = await listLaunchableApps(ctx.adb)
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
