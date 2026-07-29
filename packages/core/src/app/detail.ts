import type { AdbClient } from '../adb/client.js'
import { shellQuote } from '../adb/shell.js'

export interface AppDetail {
  versionName: string | null
  installSource: string | null
  /** `flags=[ ... ]` 에서 읽는다. 그 줄을 못 찾으면 `false` 가 아니라 `null` 이다. */
  debuggable: boolean | null
  largeHeap: boolean | null
  minSdk: number | null
  targetSdk: number | null
  primaryCpuAbi: string | null
}

const EMPTY: AppDetail = {
  versionName: null,
  installSource: null,
  debuggable: null,
  largeHeap: null,
  minSdk: null,
  targetSdk: null,
  primaryCpuAbi: null,
}

/**
 * 기기는 "값이 없다" 를 **`null` 이라는 네 글자로 찍는다.** 실기기 실측:
 * `installerPackageName=null` (시스템 앱과 프리로드는 전부 이렇다).
 *
 * 그 네 글자를 그대로 실으면 `result.json` 에 `"install_source": "null"` 이 들어간다 —
 * JSON 의 `null` 이 아니라 문자열이라, 소비자에게는 `null` 이라는 이름의 설치 출처가 있는
 * 것으로 읽힌다. 없는 것은 없다고 말한다.
 */
function orNull(v: string | undefined): string | null {
  return v === undefined || v === 'null' ? null : v
}

function intOrNull(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * ApplicationInfo 의 플래그 줄.
 *
 * **`flags=` 로 그냥 찾으면 안 된다.** 실기기 `dumpsys package` 한 출력 안에 `flags=` 가
 * 최소 세 형태로 나온다 (SM-F936N / Android 16 실측):
 * ```
 *     flags=0x0                                          ← 다른 절. 비트마스크라 이름이 없다
 *     flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA LARGE_HEAP ] ← 우리가 원하는 줄
 *       android.permission.CAMERA: granted=true, flags=[ USER_SET|... ]  ← 권한별 플래그
 * ```
 * 대괄호 조건이 첫째를, **줄 시작 앵커**가 셋째를 거른다. 실측 출력에서는 앱 플래그가 권한
 * 목록보다 앞에 있어 앵커가 없어도 우연히 맞지만, 그 순서는 우리가 정하는 것이 아니다 —
 * 순서가 바뀌면 앵커 없는 정규식은 권한 플래그를 앱 플래그로 읽는다.
 *
 * 못 찾으면 `null` 을 돌려준다 — 여기서 `false` 를 내면 "릴리스 빌드임을 확인했다" 가 되고,
 * 그것이 이 파일에서 가장 비싼 거짓말이다.
 */
export function parseApplicationFlags(text: string): Set<string> | null {
  const m = /^[ \t]*flags=\[([^\]]*)\]/m.exec(text)
  if (m === null) return null
  return new Set(m[1]!.trim().split(/\s+/).filter(Boolean))
}

export function parsePackageDetail(text: string): AppDetail {
  const flags = parseApplicationFlags(text)

  return {
    versionName: orNull(/versionName=(\S+)/.exec(text)?.[1]),
    installSource: orNull(/installerPackageName=(\S+)/.exec(text)?.[1]),
    debuggable: flags === null ? null : flags.has('DEBUGGABLE'),
    largeHeap: flags === null ? null : flags.has('LARGE_HEAP'),
    // 실측 형식: `versionCode=8280302 minSdk=26 targetSdk=36` (한 줄에 셋이 붙어 나온다).
    minSdk: intOrNull(/\bminSdk=(\d+)/.exec(text)?.[1]),
    targetSdk: intOrNull(/\btargetSdk=(\d+)/.exec(text)?.[1]),
    // 네이티브 코드가 없는 APK 에서는 기기가 `primaryCpuAbi=null` 을 찍는다.
    primaryCpuAbi: orNull(/primaryCpuAbi=(\S+)/.exec(text)?.[1]),
  }
}

/**
 * 선택된 앱 하나에 대해서만 호출한다 (목록 전체에 돌리면 느리다).
 *
 * **일곱 필드가 이 한 번의 출력에서 나온다.** 필드를 늘릴 때 명령을 늘리지 않는 것이 요점이다 —
 * `start` 전에 기기로 나가는 왕복 하나하나가 세션 시작 지연이고, 그 지연은 콜드 스타트를
 * 재는 세션에서 앱이 그만큼 늦게 뜬다는 뜻이다.
 */
export async function getAppDetail(adb: AdbClient, pkg: string): Promise<AppDetail> {
  const r = await adb.raw(['shell', `dumpsys package ${shellQuote(pkg)}`])
  return r.code === 0 ? parsePackageDetail(r.stdout) : EMPTY
}
