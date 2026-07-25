import type { LabeledApp } from '@perftracker/core'

/** 목록 수집은 core 의 loadLabeledApps 가 한다. 여기 남은 것은 정렬된 목록을 그리는 일뿐이다. */
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
