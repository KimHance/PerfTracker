import { type LabeledApp, listInstalledApps, loadLabelCache, resolveAppLabel } from '@perftracker/core'
import type { CliContext } from '../context.js'

export async function loadLabeledApps(ctx: CliContext): Promise<LabeledApp[]> {
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

export function formatApps(apps: LabeledApp[]): string {
  if (apps.length === 0) return '설치된 서드파티 앱이 없습니다.'

  const width = Math.max(...apps.map((a) => [...a.label].length))
  return apps
    .map((a) => {
      const pad = ' '.repeat(Math.max(0, width - [...a.label].length))
      const fallback = a.labelSource === 'package_name' ? ' (패키지명)' : ''
      const version = a.versionCode !== null ? `  ${a.versionCode}` : ''
      return `  ${a.label}${pad}  ${a.packageName}${version}${fallback}`
    })
    .join('\n')
}
