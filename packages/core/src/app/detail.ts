import type { AdbClient } from '../adb/client.js'

export interface AppDetail {
  versionName: string | null
  installSource: string | null
}

export function parsePackageDetail(text: string): AppDetail {
  return {
    versionName: /versionName=(\S+)/.exec(text)?.[1] ?? null,
    installSource: /installerPackageName=(\S+)/.exec(text)?.[1] ?? null,
  }
}

/** 선택된 앱 하나에 대해서만 호출한다 (목록 전체에 돌리면 느리다). */
export async function getAppDetail(adb: AdbClient, pkg: string): Promise<AppDetail> {
  const r = await adb.raw(['shell', `dumpsys package ${pkg}`])
  return r.code === 0 ? parsePackageDetail(r.stdout) : { versionName: null, installSource: null }
}
