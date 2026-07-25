import type { AdbClient } from '../adb/client.js'

export interface DeviceProbe {
  hasPerfetto: boolean
  dataSources: string[]
  sdkInt: number
}

/** 캡처를 시작하기 전에 반드시 등록되어 있어야 하는 perfetto 데이터소스. */
export const REQUIRED_DATA_SOURCES = [
  'android.surfaceflinger.frametimeline',
  'linux.process_stats',
  'linux.sys_stats',
] as const

export interface DataSourceCheck {
  name: string
  ok: boolean
  reason: string | null
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

/**
 * 필수 데이터소스가 이 기기에 등록되어 있는지 판단한다. 캡처 가능 여부를 가르는 기준이라
 * `doctor` 뿐 아니라 세션 시작 전 검증(Task 12)과 향후 GUI 의 호환성 화면에서도 재사용된다.
 */
export function evaluateDataSources(probe: DeviceProbe): DataSourceCheck[] {
  return REQUIRED_DATA_SOURCES.map((name) => {
    const ok = probe.dataSources.includes(name)
    return {
      name,
      ok,
      reason: ok ? null : `등록되지 않음 (sdk_int=${probe.sdkInt})`,
    }
  })
}
