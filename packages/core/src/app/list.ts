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

/** 패키지·버전코드·uid 가 한 번의 호출로 다 나온다 — 앱마다 dumpsys 를 도는 것보다 훨씬 싸다. */
export async function listInstalledApps(adb: AdbClient): Promise<InstalledApp[]> {
  return parseInstalledPackages(await adb.shell('pm list packages -3 -U --show-versioncode'))
}
