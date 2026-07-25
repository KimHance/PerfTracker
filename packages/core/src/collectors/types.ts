import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import type { MetricReason } from '../schema/reasons.js'

export interface CollectorEnv {
  sdkInt: number
  dataSources: string[]
}

export interface ExtractContext {
  tp: TraceProcessor
  packageName: string
  env: CollectorEnv
}

/**
 * 지원 판정. 미지원일 때는 산문이 아니라 안정적인 코드로 말한다 —
 * 그 코드가 그대로 `MetricResult.reason_code` 로 나간다.
 */
export type SupportResult = { supported: true } | ({ supported: false } & MetricReason)

/**
 * 추출 결과. 값이 없을 때 "왜 없는지"를 코드로 구분한다.
 * 예전에는 collector 가 두 경우(렌더 프로세스 없음 / 프레임 없음)에 똑같이 null 을 냈고,
 * extract 가 둘 다 "렌더 프로세스를 찾지 못했습니다" 로 적어서 한쪽은 틀린 사유였다.
 */
export type ExtractOutcome<T> = { data: T } | ({ data: null } & MetricReason)

/**
 * 메트릭 하나 = 파일 하나.
 * traceConfigBlocks 는 capture 단계에 기여하고, extract 는 기기 없이 원본만 읽는다.
 */
export interface Collector<T> {
  id: string
  /** 어떤 방법으로 잰 값인지. result.json 의 metrics[id].source 로 그대로 나간다. */
  source: string
  supports(env: CollectorEnv): SupportResult
  traceConfigBlocks(): string[]
  extract(ctx: ExtractContext): Promise<ExtractOutcome<T>>
}
