import type { AdbClient } from '../adb/client.js'

export interface InstalledApp {
  packageName: string
  versionCode: number | null
  uid: number | null
}

export interface LabeledApp extends InstalledApp {
  label: string
  labelSource: 'apk_resources' | 'aapt2' | 'package_name'
}

/** `package:com.x versionCode:123 uid:10359` 형태를 읽는다. */
export function parseInstalledPackages(text: string): InstalledApp[] {
  const out: InstalledApp[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('package:')) continue

    const packageName = /package:(\S+)/.exec(trimmed)?.[1]
    if (!packageName) continue

    const versionCode = /versionCode:(\d+)/.exec(trimmed)?.[1]
    const uid = /uid:(\d+)/.exec(trimmed)?.[1]

    out.push({
      packageName,
      versionCode: versionCode !== undefined ? Number(versionCode) : null,
      uid: uid !== undefined ? Number(uid) : null,
    })
  }
  return out
}

/**
 * `pm list packages -U` 원문에서 패키지 하나의 uid 를 찾는다. 없으면 null.
 *
 * `extract` 가 쓴다: 캡처 때 uid 를 못 적은 run 이라도 `raw/packages_*.txt` 원문에는
 * 답이 있을 수 있다. **없는 답을 지어내지 않는다** — 목록에 그 행이 없으면 null 이다.
 */
export function findPackageUid(text: string, packageName: string): number | null {
  return parseInstalledPackages(text).find((a) => a.packageName === packageName)?.uid ?? null
}

/**
 * **런처가 아이콘을 그릴 때 쓰는 그 질의.** 사람이 눌러서 열 수 있는 앱의 정의다.
 *
 * 실기기 확인: sdk 36(SM-S901N) 82개 · sdk 30(SM-A405S) 32개. 출력 형식도 둘이 같다.
 */
export const LAUNCHER_QUERY =
  'cmd package query-activities --brief' +
  ' -a android.intent.action.MAIN -c android.intent.category.LAUNCHER'

/**
 * `query-activities` 출력에서 **패키지명만** 뽑는다. 한 패키지가 런처 액티비티를 여러 개
 * 가질 수 있으므로 중복은 첫 등장만 남긴다.
 *
 * 원문은 이렇게 생겼다 — 컴포넌트 줄만 `<패키지>/<클래스>` 한 덩어리다:
 * ```
 * 85 activities found:
 *   Activity #0:
 *     priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
 *     com.android.chrome/com.google.android.apps.chrome.Main
 * ```
 */
export function parseLaunchablePackages(text: string): string[] {
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    // **줄의 첫 토큰만 본다.** 줄 전체를 훑으면 `dataPath=/data/app/com.x/base.apk` 처럼
    // 경로가 섞인 줄에서 엉뚱한 패키지를 주워 온다 — 열 수도 없는 앱이 목록에 앉는다.
    // 뒤에 따라오는 것은 무시한다: 못 보던 ROM 이 컴포넌트 뒤에 뭔가 더 붙이더라도
    // 그 앱을 통째로 놓치는 것보다는 낫다.
    const first = line.trim().split(/\s+/)[0] ?? ''
    const m = /^([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/\S+$/.exec(first)
    if (m !== null) seen.add(m[1]!)
  }
  return [...seen]
}

/** 서드파티(사용자가 직접 설치한) 앱. `listLaunchableApps` 가 못 물었을 때의 대비책이다. */
export async function listInstalledApps(adb: AdbClient): Promise<InstalledApp[]> {
  return parseInstalledPackages(await adb.shell('pm list packages -3 -U --show-versioncode'))
}

/**
 * **사람이 눌러서 열 수 있는 앱의 목록.**
 *
 * 한동안 `pm list packages -3`(서드파티) 를 썼는데, 그 둘은 다른 집합이다. 실기기(SM-S901N)
 * 실측 — `-3` 84개 · 런처 82개인데 **겹치는 것은 58개**뿐이었다:
 *
 * | | |
 * | --- | --- |
 * | `-3` 에 없는데 열 수 있다 (24개) | **유튜브** · 크롬 · 지도 · Gmail · Play 스토어 · 카메라 · 갤러리 · 설정 — 선탑재라 시스템 앱으로 분류된다 |
 * | `-3` 에 있는데 못 연다 (26개) | `*.test`(androidTest APK) 11개 · maestro · 폰트 팩 · 지오펜스 서비스 |
 *
 * 재고 싶은 앱이 목록에 없고, 고를 수 없는 것이 목록에 있었다.
 *
 * **uid·versionCode 는 `listAllPackages`(시스템 포함) 에서 온다.** 런처 질의는 그 값을 주지
 * 않고, `-3` 으로 되찾으면 처음 문제로 돌아간다. 전체 목록에 없는 패키지도 버리지 않는다 —
 * 셸 권한이 닿지 않는 안드로이드 user 의 앱이 그럴 수 있고, 그때 값은 `null` 이다
 * (모르는 것을 0 으로 적지 않는다).
 *
 * 왕복은 둘이다. **측정 창 밖**이고, 라벨 해석이 항목마다 APK 를 읽는 것에 비하면 무시할 수
 * 있다 — 오히려 골라내는 항목이 84 → 82 로 줄어 라벨 비용은 그대로다.
 */
export async function listLaunchableApps(adb: AdbClient): Promise<InstalledApp[]> {
  const launchable = parseLaunchablePackages(await adb.shell(LAUNCHER_QUERY))

  // 한 개도 못 읽었다면 이 기기에 앱이 없는 것이 아니라 **질의가 실패한 것**이다.
  // 빈 목록을 내면 화면이 "설치된 앱 없음" 이라는 거짓을 말한다.
  if (launchable.length === 0) return listInstalledApps(adb)

  const byName = new Map((await listAllPackages(adb)).map((a) => [a.packageName, a]))
  return launchable.map(
    (packageName) => byName.get(packageName) ?? { packageName, versionCode: null, uid: null },
  )
}

/**
 * **기기가 아는 패키지 전부** (시스템 앱 포함). uid·versionCode 해석의 출처다.
 *
 * 왜 따로 있는가: 옛 코드는 대상 앱의 uid 를 `listInstalledApps`(=`-3`) 에서 찾았다.
 * 시스템 앱은 그 목록에 없으므로 `uid` 는 null 이 되고, `--app com.android.settings` 는
 * 아예 `AppNotFoundError` 로 끝났다 — **기기는 그 답을 알고 있는데** 도구가 모른다고
 * 말하는 것이다. 실기기 실측: `pm list packages -U | grep com.android.settings` →
 * `package:com.android.settings uid:1000`.
 *
 * 명령 수는 늘지 않는다. 대상 해석은 이미 목록을 한 번 불렀고, 그 한 번에서 `-3` 이 빠질 뿐이다.
 *
 * **이 목록도 전부는 아니다.** 셸 권한이 닿지 않는 안드로이드 user(삼성 시큐어 폴더의
 * user 150 등)의 패키지는 stdout 에 아예 나오지 않는다 — 기기는 그 사실을 stderr 로만
 * 말하고(`SecurityException: Shell does not have permission to access user 150`,
 * 실기기에서 종료 코드는 **0**), 이 도구는 stderr 를 stdout 과 섞지 않으므로 파싱은
 * 안전하지만 목록은 조용히 불완전하다. 그 불완전을 사실로 바꾸는 것은
 * `collectors/network.ts` 의 `sharedUidPackages` 다.
 */
export async function listAllPackages(adb: AdbClient): Promise<InstalledApp[]> {
  return parseInstalledPackages(await adb.shell('pm list packages -U --show-versioncode'))
}
