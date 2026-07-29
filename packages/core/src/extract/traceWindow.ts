import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'

/**
 * **트레이스가 실제로 덮은 시간과, 그것이 세션 시작보다 얼마나 늦게 시작했는가.**
 *
 * 이 둘이 없으면 보고서의 시간축이 두 가지로 틀린다:
 *
 * 1. **꼬리에 빈 구간이 생긴다.** 축을 `session.duration_ms` 까지 그리는데 표본은 트레이스
 *    끝에서 멈추므로, 실측 네 세션 모두 마지막 2~3초가 비었다. 그 구간은 "측정했는데 값이
 *    없다" 가 아니라 **애초에 측정하지 않은 시간**이다.
 * 2. **마킹이 어긋난다.** `offset_ms` 는 세션 시작(호스트 시계) 기준이고 `t_s` 는 트레이스
 *    시작(기기 시계) 기준이다. 실측 0.88초 차이 — 1초 눈금에서 한 칸이 밀린다.
 *
 * `start` 가 adb 왕복을 몇 번 하는 동안 트레이서는 아직 돌지 않는다. 그 지연이 곧 offset 이다.
 */
export interface TraceWindow {
  /** 트레이스 첫 패킷 ~ 마지막 패킷. 축의 오른쪽 끝이 여기다. */
  spanMs: number | null
  /** 세션 시작 → 트레이스 시작 (ms). 마킹을 시계열과 같은 축으로 옮길 때 뺀다. */
  startOffsetMs: number | null
}

/**
 * `TO_REALTIME` 은 트레이스 안의 clock_snapshot 을 써서 기기 벽시계로 환산한다.
 * 스냅샷이 없는 트레이스에서는 null 이 나오고, 그때 offset 도 null 이다 — 모르는 값으로
 * 마킹을 옮기지 않는다.
 */
export const TRACE_WINDOW_SQL =
  'select json_array(' +
  '(select end_ts - start_ts from trace_bounds), ' +
  '(select TO_REALTIME(start_ts) from trace_bounds)) as j'

export function computeTraceWindow(
  spanNs: number | null,
  traceStartRealtimeNs: number | null,
  sessionStartedAtMs: number,
  deviceClockSkewMs: number | null | undefined,
): TraceWindow {
  const spanMs = spanNs === null || !Number.isFinite(spanNs) ? null : Math.round(spanNs / 1e6)

  // 셋 중 하나라도 모르면 offset 을 내지 않는다. 여기서 0 을 쓰면 "두 축이 같다" 는
  // 없던 사실이 되고, 마킹은 조용히 제자리인 척 어긋난 자리에 찍힌다.
  if (
    traceStartRealtimeNs === null ||
    !Number.isFinite(traceStartRealtimeNs) ||
    deviceClockSkewMs === null ||
    deviceClockSkewMs === undefined
  ) {
    return { spanMs, startOffsetMs: null }
  }

  const traceStartHostMs = traceStartRealtimeNs / 1e6 - deviceClockSkewMs
  return { spanMs, startOffsetMs: Math.round(traceStartHostMs - sessionStartedAtMs) }
}

export async function readTraceWindow(
  tp: TraceProcessor,
  sessionStartedAtMs: number,
  deviceClockSkewMs: number | null | undefined,
): Promise<TraceWindow> {
  try {
    const [spanNs, realtimeNs] = await tp.queryJson<[number | null, number | null]>(
      TRACE_WINDOW_SQL,
    )
    return computeTraceWindow(spanNs, realtimeNs, sessionStartedAtMs, deviceClockSkewMs)
  } catch {
    // 축을 못 그리는 것이 result.json 전체를 못 내는 이유가 되면 안 된다.
    return { spanMs: null, startOffsetMs: null }
  }
}
