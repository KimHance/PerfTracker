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

/**
 * `perfetto --query` 의 출력 형식은 **안드로이드 버전에 따라 완전히 다르다.** 둘 다 읽는다.
 *
 * **형식 A — 사람이 읽는 표** (perfetto v49 실측, SM-F936N / Android 16):
 * ```
 * DATA SOURCES REGISTERED:
 *
 * NAME                     PRODUCER              DETAILS
 * ==                       ========              ========
 * android.heapprofd        traced (1)
 * ```
 *
 * **형식 B — protobuf 텍스트** (SM-A405S / Android 11 실측):
 * ```
 * data_sources: {
 *   producer_id: 2
 *   descriptor: {
 *     name: "android.log"
 *   }
 * }
 * ```
 *
 * **형식 B 만 아는 기기에서 이 함수는 예전에 빈 배열을 냈다.** 그러면 등록되어 있는
 * 데이터소스가 하나도 없다고 읽혀 `linux.sys_stats` · `linux.process_stats` · `android.log`
 * 가 전부 "미등록" 으로 거부되고, **기기가 실제로는 줄 수 있는 지표를 도구가 스스로 막았다.**
 * (A405S 에서 셋 다 등록되어 있는 것을 `perfetto --query` 원문으로 확인했다.)
 *
 * 두 정규식은 서로의 형식을 잘못 잡지 않는다: 형식 B 의 줄은 `data_sources:` `producer_id:`
 * `name:` 처럼 이름 바로 뒤에 `:` 가 와서 표 정규식의 `\s{2,}` 를 만족하지 못하고, 형식 A 에는
 * `descriptor: {` 가 없다. 그래서 합집합을 그대로 쓴다.
 *
 * 출력 첫 줄은 스스로 "Not meant for machine consumption. Use --query-raw for scripts." 라고
 * 말한다. `--query-raw` 는 protobuf 바이너리라 여기서 파싱할 수 없어 텍스트를 읽되, **형식이
 * 또 바뀔 수 있다는 것을 전제로** 둘 다 지원하고 새 형식이 오면 여기 하나를 더 넣는다.
 */
export function parseDataSources(stdout: string): string[] {
  const names = new Set<string>()

  // 형식 A: 줄 맨 앞의 소문자 이름 + 공백 2칸 이상 (표의 NAME 열).
  for (const line of stdout.split('\n')) {
    const m = /^([a-z][\w.]+)\s{2,}/.exec(line.trim())
    if (m !== null) names.add(m[1]!)
  }

  // 형식 B: `descriptor` 절 안의 name 만 취한다. 최상위 `producers` 절에도 `name:` 이 있는데
  // 그것은 데이터소스가 아니라 프로세스 이름이라 여기 섞이면 안 된다.
  for (const m of stdout.matchAll(/descriptor:\s*\{\s*name:\s*"([^"]+)"/g)) {
    names.add(m[1]!)
  }

  return [...names].sort()
}

/** 세션을 시작하기 전에 이 기기가 무엇을 줄 수 있는지 확인한다. */
export async function probeDevice(adb: AdbClient): Promise<DeviceProbe> {
  const which = await adb.raw(['shell', 'which perfetto'])
  const query = await adb.raw(['shell', 'perfetto --query'])
  const sdk = await adb.raw(['shell', 'getprop ro.build.version.sdk'])

  return {
    hasPerfetto: which.code === 0 && which.stdout.trim().length > 0,
    dataSources: query.code === 0 ? parseDataSources(query.stdout) : [],
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
