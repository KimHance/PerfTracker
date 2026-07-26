import type { AdbClient } from '../adb/client.js'
import { shellQuote } from '../adb/shell.js'

export interface AppDetail {
  versionName: string | null
  installSource: string | null
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

export function parsePackageDetail(text: string): AppDetail {
  return {
    versionName: orNull(/versionName=(\S+)/.exec(text)?.[1]),
    installSource: orNull(/installerPackageName=(\S+)/.exec(text)?.[1]),
  }
}

/** 선택된 앱 하나에 대해서만 호출한다 (목록 전체에 돌리면 느리다). */
export async function getAppDetail(adb: AdbClient, pkg: string): Promise<AppDetail> {
  const r = await adb.raw(['shell', `dumpsys package ${shellQuote(pkg)}`])
  return r.code === 0 ? parsePackageDetail(r.stdout) : { versionName: null, installSource: null }
}
