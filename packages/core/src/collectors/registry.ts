import { mergeTraceConfigBlocks } from '../perfetto/config.js'
import { renderReason } from '../schema/reasons.js'
import { frameCollector } from './frame.js'
import type { Collector, CollectorEnv } from './types.js'

/**
 * 활성 collector 목록. **이 배열이 실제로 소비된다** — `startSession` 이 여기서 TraceConfig
 * 블록을 모으고 `extractRun` 이 여기를 순회해 `metrics` 를 채운다.
 * M2 에서 cpu/memory/log/startup 이, M3 에서 network/thermal/power 가 여기 한 줄로 붙는다.
 */
export const COLLECTORS: Collector<unknown>[] = [frameCollector]

/** 이 기기에서 실제로 뭔가를 낼 수 있는 collector 들. */
export function supportedCollectors(env: CollectorEnv): Collector<unknown>[] {
  return COLLECTORS.filter((c) => c.supports(env).supported)
}

/**
 * 지원되는 collector 들이 요청한 데이터소스 블록을 합친다.
 * 같은 데이터소스를 두 collector 가 요구하는 것은 정상이고(예: `linux.process_stats`),
 * 그때는 **완전히 같은 블록 텍스트**여야 한다 — 규칙은 `mergeTraceConfigBlocks` 에 있다.
 */
export function collectTraceConfigBlocks(env: CollectorEnv): string[] {
  return mergeTraceConfigBlocks(supportedCollectors(env).flatMap((c) => c.traceConfigBlocks()))
}

/** 아무것도 수집할 수 없을 때 사용자에게 보여줄 사유 목록. */
export function unsupportedReasons(env: CollectorEnv): string[] {
  return COLLECTORS.map((c) => {
    const support = c.supports(env)
    return `${c.id}: ${support.supported ? '알 수 없음' : (renderReason(support.reason) ?? '')}`
  })
}
