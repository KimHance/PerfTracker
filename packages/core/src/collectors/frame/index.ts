import type { FrameData } from '../../schema/result.js'
import { staleNameReason } from '../appProcess.js'
import { FRAMETIMELINE_BLOCK, processStatsBlock } from '../blocks.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from '../types.js'
import {
  collectFromFrametimeline,
  FRAMETIMELINE_DATA_SOURCE,
  FRAMETIMELINE_MIN_SDK,
} from './sources/frametimeline.js'
import { findOutOfRange, toFrameData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/frametimeline.js'

/**
 * **수집 경로를 고르고, 그 결과를 도메인 모델로 옮긴다.** 계층은 셋이다:
 *
 * ```
 *   sources/*       SDK 별 수집 — 어디서 어떻게 꺼내는가
 *   model.ts        FrameSample[] — 소스와 무관한 중간형
 *   toDomain.ts     버킷·백분위·시계열 — 기기를 모른다
 * ```
 *
 * **sdk 30 이하는 미지원이다.** `frametimeline` 데이터소스가 Android 12 부터라서인데,
 * 대안을 찾아봤고 없었다 (실측):
 *   - `android.surfaceflinger.frame` 데이터소스는 A40 에 등록돼 있지만 6초 트레이스에서
 *     프레임 관련 slice 를 **한 건도** 내지 않았다.
 *   - `dumpsys gfxinfo <pkg> framestats` 에는 프레임별 타임스탬프가 있지만 버퍼가 방금 그린
 *     몇 장뿐이다 (실측: 2행 · 0.1초). 세션 전체를 모으려면 측정 중 폴링해야 하고
 *     그것은 규칙 1(측정 창 안 기기 접촉 0회)을 깬다.
 *
 * 그래서 값을 지어내는 대신 `sdk_too_low` 로 **미지원이라고 말한다.** 새 경로가 생기면
 * `sources/` 에 파일 하나를 더하고 여기서 고르면 되고, 도메인 계층은 손대지 않는다.
 */
export const frameCollector: TraceCollector<FrameData> = {
  id: 'frame',
  source: 'perfetto: actual_frame_timeline_slice.dur',
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    if (env.sdkInt < FRAMETIMELINE_MIN_SDK) {
      return {
        supported: false,
        reason: {
          code: 'sdk_too_low',
          detail: { sdk_int: env.sdkInt, min_sdk: FRAMETIMELINE_MIN_SDK },
        },
      }
    }
    if (!env.dataSources.includes(FRAMETIMELINE_DATA_SOURCE)) {
      return {
        supported: false,
        reason: {
          code: 'data_source_not_registered',
          detail: { data_source: FRAMETIMELINE_DATA_SOURCE },
        },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks(env: CollectorEnv) {
    return [FRAMETIMELINE_BLOCK, processStatsBlock(env.sdkInt)]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<FrameData>> {
    const { collection, resolved } = await collectFromFrametimeline(ctx)
    if (collection === null || resolved === null) {
      return {
        collected: false,
        reason: { code: 'render_process_not_found', detail: { package: ctx.packageName } },
      }
    }

    if (collection.samples.length === 0) {
      return {
        collected: false,
        reason: { code: 'no_frames', detail: { process: collection.process } },
      }
    }

    // 도메인 계층의 `bucketFrames` 는 범위 밖 값에 던진다. 그것을 `runCollector` 의 포괄
    // catch 까지 흘려보내면 "트레이스 쿼리에 실패했습니다" 로 렌더되는데 쿼리는 성공했으므로
    // 사유가 틀린다. 부르기 전에 같은 규칙으로 걸러 사유로 바꾼다.
    const outOfRange = findOutOfRange(collection.samples)
    if (outOfRange !== undefined) {
      return {
        collected: false,
        reason: {
          code: 'frame_duration_out_of_range',
          detail: { process: collection.process, duration_ms: outOfRange },
        },
      }
    }

    const data = toFrameData(collection)

    // 이름이 아니라 pid 로 확인한 경우, 트레이스가 다른 이름을 알고 있다는 사실을 숨기지 않는다.
    const stale = staleNameReason(resolved, ctx.packageName)
    return stale === null ? { collected: true, data } : { collected: true, data, partialReason: stale }
  },
}
