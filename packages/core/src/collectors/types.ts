import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'

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
 * 메트릭 하나 = 파일 하나.
 * traceConfigBlocks 는 capture 단계에 기여하고, extract 는 기기 없이 원본만 읽는다.
 */
export interface Collector<T> {
  id: string
  /** 어떤 방법으로 잰 값인지. result.json 의 metrics[id].source 로 그대로 나간다. */
  source: string
  supports(env: CollectorEnv): { supported: boolean; reason?: string }
  traceConfigBlocks(): string[]
  extract(ctx: ExtractContext): Promise<T | null>
}
