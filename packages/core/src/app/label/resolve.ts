import type { AdbClient } from '../../adb/client.js'
import { pickLocalizedValue, resolveResourceStrings } from './arsc.js'
import type { CachedLabel, LabelCache } from './cache.js'

export interface ResolveActivityInfo {
  launcherActivity: string | null
  labelRes: number | null
  nonLocalizedLabel: string | null
}

/**
 * resolve-activity 출력에서 런처 액티비티와 라벨 리소스 ID 를 뽑는다.
 * labelRes 가 여기 있으므로 AndroidManifest.xml 을 따로 파싱할 필요가 없다.
 * ActivityInfo 와 ApplicationInfo 양쪽에 labelRes 가 나오는데, 앱 라벨은 ApplicationInfo 쪽이다.
 */
export function parseResolveActivity(text: string): ResolveActivityInfo {
  const activity = /^\s*name=([\w.$]+)\s*$/m.exec(text)?.[1] ?? null

  const appInfoIndex = text.indexOf('ApplicationInfo:')
  const scope = appInfoIndex >= 0 ? text.slice(appInfoIndex) : text

  const labelResMatch = /labelRes=0x([0-9a-fA-F]+)/.exec(scope)
  const labelRes = labelResMatch ? Number.parseInt(labelResMatch[1]!, 16) : null

  const nonLocalized = /nonLocalizedLabel=(.*?)\s+(?:icon|banner)=/.exec(scope)?.[1]?.trim()

  return {
    launcherActivity: activity,
    labelRes: labelRes === 0 ? null : labelRes,
    nonLocalizedLabel: nonLocalized && nonLocalized !== 'null' ? nonLocalized : null,
  }
}

export function parsePmPath(text: string): string | null {
  const paths = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.slice('package:'.length))
  return paths.find((p) => p.endsWith('/base.apk')) ?? paths[0] ?? null
}

/**
 * APK 전체를 받지 않고 resources.arsc 한 항목만 기기의 unzip 으로 스트리밍한다.
 * 기기에 아무것도 설치하거나 실행하지 않는다.
 */
async function fetchArsc(adb: AdbClient, pkg: string): Promise<Buffer | null> {
  const pathOutput = await adb.raw(['shell', `pm path ${pkg}`])
  if (pathOutput.code !== 0) return null

  const apk = parsePmPath(pathOutput.stdout)
  if (!apk) return null

  const r = await adb.rawBinary(['exec-out', `unzip -p '${apk}' resources.arsc`])
  if (r.code !== 0 || r.stdout.length === 0) return null
  return r.stdout
}

export async function resolveAppLabel(
  adb: AdbClient,
  pkg: string,
  opts: { preferredLanguage?: string; cache?: LabelCache; versionCode?: number | null } = {},
): Promise<CachedLabel & { launcherActivity: string | null }> {
  const preferredLanguage = opts.preferredLanguage ?? hostLanguage()

  const info = parseResolveActivity(
    (await adb.raw(['shell', `cmd package resolve-activity -c android.intent.category.LAUNCHER ${pkg}`])).stdout,
  )

  const cached = opts.cache?.get(pkg, opts.versionCode ?? null)
  if (cached) return { ...cached, launcherActivity: info.launcherActivity }

  const resolved = await resolveLabelValue(adb, pkg, info, preferredLanguage)
  opts.cache?.set(pkg, opts.versionCode ?? null, resolved)

  return { ...resolved, launcherActivity: info.launcherActivity }
}

async function resolveLabelValue(
  adb: AdbClient,
  pkg: string,
  info: ResolveActivityInfo,
  preferredLanguage: string,
): Promise<CachedLabel> {
  // 리소스가 아니라 문자열이 그대로 박힌 앱은 APK 를 건드릴 필요가 없다.
  if (info.nonLocalizedLabel) {
    return { label: info.nonLocalizedLabel, source: 'apk_resources' }
  }

  if (info.labelRes !== null) {
    const arsc = await fetchArsc(adb, pkg)
    if (arsc) {
      try {
        const value = pickLocalizedValue(resolveResourceStrings(arsc, info.labelRes), preferredLanguage)
        if (value) return { label: value, source: 'apk_resources' }
      } catch {
        // 파싱 실패는 폴백으로 내려간다 — 라벨을 못 읽는다고 측정을 막을 이유가 없다.
      }
    }
  }

  return { label: pkg, source: 'package_name' }
}

function hostLanguage(): string {
  const locale = new Intl.DateTimeFormat().resolvedOptions().locale
  return locale.split('-')[0] ?? 'en'
}
