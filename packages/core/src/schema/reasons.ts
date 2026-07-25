/**
 * 메트릭이 왜 수집되지 않았는지를 **안정적인 기계 키**로 말한다.
 *
 * 예전에는 `MetricResult.reason` 하나가 두 일을 했다: CI 와 LLM 이 읽는 버전 있는 계약의
 * 필드이면서 동시에 한국어 사용자에게 보내는 터미널 설명. 하나로는 양쪽 다 실패한다 —
 * 기계 키로서는 문구를 다듬는 순간 깨지고, 사람 메시지로서는 영어 산문이었다.
 *
 * 그래서 갈랐다: `reason_code` 는 여기 있는 식별자이고 절대 문구 때문에 바뀌지 않는다.
 * `reason` 은 이 표가 렌더한 사람용 문장이며 언제든 다듬을 수 있다.
 */
export interface MetricReason {
  code: MetricReasonCode
  detail?: Record<string, unknown>
}

export const METRIC_REASON_CODES = [
  /** 기기 SDK 가 이 메트릭의 최소 요구치보다 낮다. detail: sdk_int, min_sdk */
  'sdk_too_low',
  /** 필요한 perfetto 데이터소스가 기기에 등록되어 있지 않다. detail: data_source */
  'data_source_not_registered',
  /** 회수된 트레이스 원본이 run 디렉토리에 없다. */
  'trace_missing',
  /** 트레이스 안에서 대상 앱의 렌더 프로세스를 특정하지 못했다. detail: package */
  'render_process_not_found',
  /** 프로세스는 찾았지만 완료된 프레임이 하나도 없다. detail: process */
  'no_frames',
  /** trace_processor 쿼리가 실패했다. detail: message */
  'query_failed',
] as const

export type MetricReasonCode = (typeof METRIC_REASON_CODES)[number]

const RENDERERS: Record<MetricReasonCode, (d: Record<string, unknown>) => string> = {
  sdk_too_low: (d) =>
    `Android 12 이상이 필요합니다 (기기 sdk_int=${String(d['sdk_int'])}, 최소 sdk_int=${String(d['min_sdk'])}).`,
  data_source_not_registered: (d) =>
    `이 기기에 perfetto 데이터소스가 등록되어 있지 않습니다: ${String(d['data_source'])}`,
  trace_missing: () => '트레이스 원본이 없습니다.',
  render_process_not_found: (d) =>
    `대상 앱(${String(d['package'])})의 렌더 프로세스를 트레이스에서 찾지 못했습니다.`,
  no_frames: (d) => `렌더 프로세스(${String(d['process'])})에서 완료된 프레임을 찾지 못했습니다.`,
  query_failed: (d) => `트레이스 쿼리에 실패했습니다: ${String(d['message'])}`,
}

/** 코드 → 한국어 문장. 모르는 코드는 조용히 비우지 않고 코드 자체를 남긴다. */
export function renderReason(reason: MetricReason | null): string | null {
  if (reason === null) return null
  const render = RENDERERS[reason.code] as ((d: Record<string, unknown>) => string) | undefined
  return render === undefined ? reason.code : render(reason.detail ?? {})
}
