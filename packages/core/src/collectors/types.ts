import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import type { MetricReason } from '../schema/reasons.js'

export interface CollectorEnv {
  sdkInt: number
  dataSources: string[]
}

/**
 * capture 단계에서만 알 수 있고 트레이스에는 없는 사실.
 * `extractRun` 이 `session.json` 에서 조립해 넣는다 — capture.json 의 버전을 올리지 않는 이유다.
 */
export interface CaptureFacts {
  /** `am start -W` 가 보고한 값. `--launch` 없이 시작했으면 null. */
  startup: { totalTimeMs: number | null; launchState: string | null } | null
  /**
   * 사용자가 `--launch` 를 줬는지.
   * `startup` 이 null 인 이유가 "안 켰다"(skipped)인지 "켰는데 못 읽었다"(partial)인지를 가른다.
   */
  launchRequested: boolean
}

/** 트레이스를 읽지 않는 collector 의 컨텍스트. `tp` 가 **아예 없다** — 있으면 쓰게 된다. */
export interface CaptureOnlyContext {
  packageName: string
  env: CollectorEnv
  capture: CaptureFacts
}

export interface ExtractContext extends CaptureOnlyContext {
  tp: TraceProcessor
}

/**
 * 지원 판정. 미지원일 때는 산문이 아니라 안정적인 코드로 말한다 —
 * 그 코드가 그대로 `MetricResult.reason_code` 로 나간다.
 */
export type SupportResult = { supported: true } | { supported: false; reason: MetricReason }

/**
 * 추출 결과. 값이 없을 때 "왜 없는지"를 코드로 구분한다.
 *
 * `partialReason` 은 **값이 나왔지만 일부만 나온** 경우다 — CPU 사용률은 잡혔는데
 * `cpufreq` 이벤트가 하나도 없는 상황이 정확히 이것이고, 그걸 `collected` 로 내보내면
 * 사용률만 있는 결과가 사용률+주파수인 척한다.
 *
 * `status` 는 값이 아예 없을 때 `partial`(기본) 과 `skipped`(수집을 시도조차 안 함) 를 가른다.
 */
export type ExtractOutcome<T> =
  | { collected: true; data: T; partialReason?: MetricReason }
  | { collected: false; reason: MetricReason; status?: 'partial' | 'skipped' }

interface CollectorBase {
  id: string
  /** 어떤 방법으로 잰 값인지. result.json 의 metrics[id].source 로 그대로 나간다. */
  source: string
  supports(env: CollectorEnv): SupportResult
  /** 이 collector 가 필요로 하는 데이터소스 블록. 반드시 `collectors/blocks.ts` 의 상수를 쓴다. */
  traceConfigBlocks(): string[]
}

/** 트레이스를 파싱해야 값이 나오는 collector. */
export interface TraceCollector<T> extends CollectorBase {
  needsTrace: true
  extract(ctx: ExtractContext): Promise<ExtractOutcome<T>>
}

/**
 * capture 단계의 사실만으로 값이 나오는 collector (startup).
 * 트레이스가 없는 run 에서도 정상 산출돼야 하므로 `runCollector` 의 trace_missing 단축로를 타지 않는다.
 */
export interface CaptureCollector<T> extends CollectorBase {
  needsTrace: false
  extract(ctx: CaptureOnlyContext): Promise<ExtractOutcome<T>>
}

/**
 * 메트릭 하나 = 파일 하나.
 * `needsTrace` 가 판별자다 — `runCollector` 가 이걸로 좁히면 `as` 캐스트 없이 타입이 맞는다.
 */
export type Collector<T> = TraceCollector<T> | CaptureCollector<T>
