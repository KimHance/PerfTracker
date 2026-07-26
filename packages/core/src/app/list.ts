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
 * **사용자가 고를 수 있는 앱의 목록** — `-3` 은 서드파티만 남긴다.
 *
 * 여기에 `-3` 이 있는 이유는 라벨 때문이다. 이 목록의 쓰임은 `apps` 명령의 렌더링과
 * 라벨 검색이고, 둘 다 항목마다 APK 리소스를 읽는다. 실기기에서 이 필터를 빼면
 * 169개가 632개가 되고 라벨 해석 비용이 그대로 4배가 된다.
 *
 * **uid 를 해석할 때는 이 목록을 쓰면 안 된다** — `listAllPackages` 를 보라.
 */
export async function listInstalledApps(adb: AdbClient): Promise<InstalledApp[]> {
  return parseInstalledPackages(await adb.shell('pm list packages -3 -U --show-versioncode'))
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
