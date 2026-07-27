import type { MemoryData } from '../../schema/result.js'
import { staleNameReason } from '../appProcess.js'
import { processStatsBlock, SYS_STATS_BLOCK } from '../blocks.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from '../types.js'
import { collectFromProcessStats, PROCESS_STATS_SOURCE } from './sources/processStats.js'
import { toMemoryData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/processStats.js'

/**
 * 계층은 frame 과 같다: `sources/*`(수집) → `model`(중간형) → `toDomain`(kB·스키마) → 여기(조립).
 *
 * SDK 하한이 없다 — `linux.process_stats` 는 오래된 안드로이드에도 있다 (A11 실측 확인).
 * 막히는 것은 데이터소스 등록 여부뿐이다.
 */
export const memoryCollector: TraceCollector<MemoryData> = {
  id: 'memory',
  source: 'perfetto: linux.process_stats mem.rss + linux.sys_stats meminfo',
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    // process_stats 만 하드 요구다. meminfo 는 없으면 system: null 로 빠질 뿐이다.
    if (!env.dataSources.includes(PROCESS_STATS_SOURCE)) {
      return {
        supported: false,
        reason: {
          code: 'data_source_not_registered',
          detail: { data_source: PROCESS_STATS_SOURCE },
        },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks(env: CollectorEnv) {
    return [processStatsBlock(env.sdkInt), SYS_STATS_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<MemoryData>> {
    const { collection, resolved, noRssSamples } = await collectFromProcessStats(ctx)

    if (resolved === null) {
      return {
        collected: false,
        reason: { code: 'process_not_in_trace', detail: { package: ctx.packageName } },
      }
    }
    if (noRssSamples || collection === null) {
      return {
        collected: false,
        reason: { code: 'no_rss_samples', detail: { process: resolved.name } },
      }
    }

    const data = toMemoryData(collection)

    // 사유는 하나만 실을 수 있다. 둘이 겹치면 **정체성** 쪽을 먼저 낸다 —
    // meminfo 가 없다는 사실은 `system: null` 로 데이터에 이미 드러나지만,
    // "이 프로세스가 그 앱이라는 근거가 이름이 아니라 pid 였다" 는 데이터 어디에도 안 남는다.
    const stale = staleNameReason(resolved, ctx.packageName)
    if (stale !== null) return { collected: true, data, partialReason: stale }
    return collection.system === null
      ? { collected: true, data, partialReason: { code: 'no_meminfo_samples' } }
      : { collected: true, data }
  },
}
