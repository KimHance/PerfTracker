import type { FrameData } from '../../schema/result.js'
import { staleNameReason } from '../appProcess.js'
import { FRAMETIMELINE_BLOCK, processStatsBlock } from '../blocks.js'
import type { CollectorEnv, ExtractContext, ExtractOutcome, SupportResult, TraceCollector } from '../types.js'
import { collectFromFrametimeline, FRAMETIMELINE_DATA_SOURCE, FRAMETIMELINE_MIN_SDK } from './sources/frametimeline.js'
import { toFrameData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/frametimeline.js'

/**
 * **프레임의 시간축.** `hwui` 를 대체하지 않는다 — `hwui` 는 트레이스 없이도, 어느 버전에서도
 * 나오는 렌더 수치이고 이쪽은 sdk 31+ 에서만 나오는 **시간축**이다. 둘을 한 지표로 합치지
 * 않는 이유는 `hwui` 가 `CaptureCollector` 라서다: 트레이스 없는 run 에서도 산출돼야 하는데
 * 트레이스 의존을 넣으면 그 성질이 깨진다.
 */
export const frameCollector: TraceCollector<FrameData> = {
  id: 'frame',
  source: 'perfetto: actual/expected_frame_timeline_slice',
  needsTrace: true,

  /**
   * sdk 만 보지 않는다. sdk 는 31 이상인데 데이터소스가 등록되지 않은 기기가 실제로 있고,
   * 그때 `sdk_too_low` 라고 말하면 거짓말이 된다.
   */
  supports(env: CollectorEnv): SupportResult {
    if (env.sdkInt < FRAMETIMELINE_MIN_SDK) {
      return {
        supported: false,
        reason: { code: 'sdk_too_low', detail: { sdk_int: env.sdkInt, min_sdk: FRAMETIMELINE_MIN_SDK } },
      }
    }
    if (!env.dataSources.includes(FRAMETIMELINE_DATA_SOURCE)) {
      return {
        supported: false,
        reason: { code: 'data_source_not_registered', detail: { data_source: FRAMETIMELINE_DATA_SOURCE } },
      }
    }
    return { supported: true }
  },

  /**
   * `process_stats` 를 함께 요청한다. **없으면 `process` 테이블이 비어 대상 앱을 못 찾는다** —
   * `resolveAppProcess` 가 upid→이름을 그 테이블에서 읽는다. 다른 collector 도 같은 블록을
   * 요청하므로 `mergeTraceConfigBlocks` 가 하나로 접는다 (같은 텍스트여야 한다).
   */
  traceConfigBlocks(env: CollectorEnv) {
    return [FRAMETIMELINE_BLOCK, processStatsBlock(env.sdkInt)]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<FrameData>> {
    const found = await collectFromFrametimeline(ctx)
    if (found === null) {
      return {
        collected: false,
        reason: { code: 'process_not_in_trace', detail: { package: ctx.packageName } },
      }
    }
    if (found.samples.length === 0) {
      return {
        collected: false,
        reason: { code: 'no_frames', detail: { process: found.resolved.name } },
      }
    }

    const data = toFrameData(found.samples)

    // 이름이 아니라 pid 로 확인한 경우, 트레이스가 다른 이름을 알고 있다는 사실을 숨기지 않는다.
    const stale = staleNameReason(found.resolved, ctx.packageName)
    return stale === null ? { collected: true, data } : { collected: true, data, partialReason: stale }
  },
}
