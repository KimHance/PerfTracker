import type { AdbClient } from '../../adb/client.js'
import { shellQuote } from '../../adb/shell.js'
import { pickLocalizedValue, resolveResourceStrings } from './arsc.js'
import type { CachedLabel, LabelCache } from './cache.js'

export interface ResolveActivityInfo {
  launcherActivity: string | null
  /** 위 액티비티를 **소유한** 패키지. 대상 패키지와 다르면 그 액티비티는 우리 것이 아니다. */
  launcherActivityPackage: string | null
  labelRes: number | null
  nonLocalizedLabel: string | null
}

/**
 * resolve-activity 출력에서 런처 액티비티와 라벨 리소스 ID 를 뽑는다.
 * labelRes 가 여기 있으므로 AndroidManifest.xml 을 따로 파싱할 필요가 없다.
 * ActivityInfo 와 ApplicationInfo 양쪽에 labelRes 가 나오는데, 앱 라벨은 ApplicationInfo 쪽이다.
 *
 * **`packageName` 을 함께 읽는 이유 (실기기에서 맞은 결함):**
 * 한 패키지가 LAUNCHER 액티비티를 **둘 이상** 가지면 `resolve-activity` 는 그 패키지의
 * 액티비티가 아니라 시스템의 선택창을 돌려준다:
 *
 * ```
 *   name=com.android.internal.app.ResolverActivity
 *   packageName=android          ← 대상 앱이 아니다
 * ```
 *
 * 예전에는 `name=` 만 읽어서 이것을 그대로 `am start -n <pkg>/<그 이름>` 에 넘겼고, 앱이
 * 뜨지 않았다. **디버그 빌드에서는 이게 예외가 아니라 기본에 가깝다** — LeakCanary 같은
 * 라이브러리가 자기 런처 아이콘을 추가하기 때문이다 (실측: Stream 디버그 빌드에 진입점 2개,
 * `com.example.streaming.splash.SplashActivity` 와 `leakcanary.internal.activity.LeakLauncherActivity`).
 */
export function parseResolveActivity(text: string): ResolveActivityInfo {
  // ActivityInfo 절의 `name=` 과 그 뒤의 `packageName=` 은 짝이다. 떨어뜨려 읽으면
  // ApplicationInfo 쪽 packageName(항상 대상 패키지다)과 섞여 검사가 무의미해진다.
  const pair = /^\s*name=([\w.$]+)\s*$\s*^\s*packageName=([\w.$]+)\s*$/m.exec(text)
  const activity = pair?.[1] ?? /^\s*name=([\w.$]+)\s*$/m.exec(text)?.[1] ?? null

  const appInfoIndex = text.indexOf('ApplicationInfo:')
  const scope = appInfoIndex >= 0 ? text.slice(appInfoIndex) : text

  const labelResMatch = /labelRes=0x([0-9a-fA-F]+)/.exec(scope)
  const labelRes = labelResMatch ? Number.parseInt(labelResMatch[1]!, 16) : null

  const nonLocalized = /nonLocalizedLabel=(.*?)\s+(?:icon|banner)=/.exec(scope)?.[1]?.trim()

  return {
    launcherActivity: activity,
    launcherActivityPackage: pair?.[2] ?? null,
    labelRes: labelRes === 0 ? null : labelRes,
    nonLocalizedLabel: nonLocalized && nonLocalized !== 'null' ? nonLocalized : null,
  }
}

/**
 * `cmd package query-activities --brief` 출력에서 **대상 패키지의** LAUNCHER 액티비티를 모은다.
 * 출력은 한 줄에 `패키지/액티비티` 하나씩이다:
 *
 * ```
 *     com.example.streaming.debug/com.example.streaming.splash.SplashActivity
 *     com.example.streaming.debug/leakcanary.internal.activity.LeakLauncherActivity
 * ```
 *
 * 액티비티 이름이 `.Settings` 처럼 상대 표기로 나오기도 한다 — `am start -n` 이 그대로
 * 받으므로 정규화하지 않고 원문을 유지한다.
 *
 * 기기가 준 순서를 지킨다. 정렬하지 않는다 — 그 순서는 우선순위(`priority` / `preferredOrder`)
 * 를 반영한 것이고, 여기서 다시 줄 세우면 그 정보가 사라진다.
 */
export function parseLauncherActivities(text: string, pkg: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`${pkg}/`)) continue
    const activity = trimmed.slice(pkg.length + 1)
    if (activity.length > 0 && !out.includes(activity)) out.push(activity)
  }
  return out
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
  const pathOutput = await adb.raw(['shell', `pm path ${shellQuote(pkg)}`])
  if (pathOutput.code !== 0) return null

  const apk = parsePmPath(pathOutput.stdout)
  if (!apk) return null

  const r = await adb.rawBinary(['exec-out', `unzip -p ${shellQuote(apk)} resources.arsc`])
  if (r.code !== 0 || r.stdout.length === 0) return null
  return r.stdout
}

/**
 * `withLauncherActivity` 를 켜지 않으면 캐시 적중 시 기기에 **아무것도 묻지 않는다.**
 * 켜지 않았을 때 `launcherActivity` 가 null 인 것은 "런처가 없다"가 아니라 "묻지 않았다"는 뜻이다.
 * 목록 렌더링(`apps`)은 라벨만 쓰므로 끄고, `start --launch` 만 켠다 —
 * 켠 채로 두면 완전히 캐시된 상태에서도 설치된 앱 수만큼 adb 왕복이 생긴다(테스트 기기 169회).
 */
export interface LauncherResolution {
  /** `am start -n <pkg>/<이것>` 에 넣을 액티비티. 못 찾으면 null. */
  launcherActivity: string | null
  /**
   * 진입점이 **둘 이상**이라 그중 하나를 고른 경우의 전체 목록 (기기가 준 순서 그대로).
   * 고를 필요가 없었으면 null 이다 — `[]` 와 구분된다.
   *
   * 이 값이 null 이 아니면 `launcherActivity` 는 **우리가 고른 것**이지 기기가 지정해 준 것이
   * 아니다. 그 사실은 결과에 경고로 남는다 (`session/start.ts`).
   */
  launcherCandidates: string[] | null
}

/**
 * 대상 패키지의 런처 액티비티를 정한다. **앱이 뜨는 것이 이 함수의 책임이다.**
 *
 * 1. `resolve-activity` 가 **대상 패키지 소유의** 액티비티를 주면 그것을 쓴다.
 * 2. 아니면(= 진입점이 여럿이라 시스템 선택창이 돌아온 경우) `query-activities` 로 그 패키지의
 *    LAUNCHER 액티비티를 전부 모아 **첫 번째**를 쓴다. 기기가 준 순서는 우선순위를 반영한다.
 * 3. 그래도 없으면 null 이고, 호출자가 그것을 사유로 낸다.
 *
 * 2번에서 고르는 것은 추측이지만, **고른 사실과 후보 전체를 결과에 남기므로** 조용한 추측이
 * 아니다. 여기서 실패로 처리하면 GUI 의 "시작" 버튼이 디버그 빌드에서 그냥 안 되는데,
 * 그 앱들이야말로 이 도구의 주 대상이다.
 */
async function resolveLauncher(
  adb: AdbClient,
  pkg: string,
  known?: ResolveActivityInfo,
): Promise<LauncherResolution> {
  // 호출자가 이미 `resolve-activity` 를 받아 뒀으면 그것을 쓴다 — 같은 명령을 두 번 보내지
  // 않는다. 측정 창 밖이라 막히지는 않지만, 왕복을 늘리지 않는 것이 이 저장소의 기본값이다.
  const info =
    known ??
    parseResolveActivity(
      (await adb.raw(['shell', `cmd package resolve-activity -c android.intent.category.LAUNCHER ${shellQuote(pkg)}`])).stdout,
    )

  if (info.launcherActivity !== null && info.launcherActivityPackage === pkg) {
    return { launcherActivity: info.launcherActivity, launcherCandidates: null }
  }

  const listed = await adb.raw([
    'shell',
    'cmd package query-activities --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN',
  ])
  const candidates = listed.code === 0 ? parseLauncherActivities(listed.stdout, pkg) : []

  if (candidates.length === 0) return { launcherActivity: null, launcherCandidates: null }
  if (candidates.length === 1) {
    return { launcherActivity: candidates[0]!, launcherCandidates: null }
  }
  return { launcherActivity: candidates[0]!, launcherCandidates: candidates }
}

export async function resolveAppLabel(
  adb: AdbClient,
  pkg: string,
  opts: {
    preferredLanguage?: string
    cache?: LabelCache
    versionCode?: number | null
    withLauncherActivity?: boolean
  } = {},
): Promise<CachedLabel & LauncherResolution> {
  const preferredLanguage = opts.preferredLanguage ?? hostLanguage()

  const cached = opts.cache?.get(pkg, opts.versionCode ?? null)
  if (cached && opts.withLauncherActivity !== true) {
    return { ...cached, launcherActivity: null, launcherCandidates: null }
  }

  // 라벨 해석에는 `resolve-activity` 의 labelRes 가 필요하고, 런처 액티비티 결정에는 그 이상이
  // 필요하다. 캐시가 있으면 라벨 쪽은 건너뛰므로 런처만 정한다.
  if (cached) return { ...cached, ...(await resolveLauncher(adb, pkg)) }

  const raw = (await adb.raw(['shell', `cmd package resolve-activity -c android.intent.category.LAUNCHER ${shellQuote(pkg)}`])).stdout
  const info = parseResolveActivity(raw)

  const resolved = await resolveLabelValue(adb, pkg, info, preferredLanguage)
  // 폴백(source: 'package_name')은 캐싱하지 않는다 — 재계산 비용이 없는 값이고, 캐싱하면
  // 일시적 해석 실패가 그 버전 동안 영구히 얼어붙는다. 다음 실행에서 다시 시도하게 둔다.
  if (resolved.source !== 'package_name') {
    opts.cache?.set(pkg, opts.versionCode ?? null, resolved)
  }

  // 캐시가 없어서 어차피 `resolve-activity` 를 불렀다 — 그 결과는 그대로 돌려준다.
  // 다만 **선택창 폴백(query-activities)은 추가 왕복**이므로 필요할 때만 간다.
  if (opts.withLauncherActivity !== true) {
    const owned = info.launcherActivity !== null && info.launcherActivityPackage === pkg
    return {
      ...resolved,
      // 소유자가 대상 패키지가 아니면 그것은 이 앱의 진입점이 아니다. 폴백을 안 하는 경로에서는
      // 값을 지어내지 않고 null 로 둔다 — 옛 코드가 여기서 ResolverActivity 를 실어 보냈다.
      launcherActivity: owned ? info.launcherActivity : null,
      launcherCandidates: null,
    }
  }

  return { ...resolved, ...(await resolveLauncher(adb, pkg, info)) }
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
