import type { AdbClient } from '../adb/client.js'

export interface DeviceProbe {
  hasPerfetto: boolean
  dataSources: string[]
  sdkInt: number
}

/** 세션을 시작하기 전에 이 기기가 무엇을 줄 수 있는지 확인한다. */
export async function probeDevice(adb: AdbClient): Promise<DeviceProbe> {
  const which = await adb.raw(['shell', 'which perfetto'])
  const query = await adb.raw(['shell', 'perfetto --query'])
  const sdk = await adb.raw(['shell', 'getprop ro.build.version.sdk'])

  const dataSources = query.code === 0
    ? [
        ...new Set(
          query.stdout
            .split('\n')
            .map((l) => /^([a-z][\w.]+)\s{2,}/.exec(l.trim())?.[1])
            .filter((v): v is string => v !== undefined),
        ),
      ].sort()
    : []

  return {
    hasPerfetto: which.code === 0 && which.stdout.trim().length > 0,
    dataSources,
    sdkInt: Number(sdk.stdout.trim()) || 0,
  }
}
