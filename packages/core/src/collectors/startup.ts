import type { StartupData } from '../schema/result.js'
import type {
  BaseExtractContext,
  CaptureCollector,
  ExtractOutcome,
  SupportResult,
} from './types.js'

/**
 * 유일하게 트레이스를 읽지 않는 collector 다. 값은 `start` 가 `am start -W` 를 돌려 받아
 * `session.json` 에 적어 둔 것이고, `extractRun` 이 그것을 `CaptureFacts` 로 넘겨준다.
 *
 * 스펙: `am start -W` 는 exported 진입점만 실행할 수 있으므로 런처 액티비티만 대상이다.
 * 내부 화면 진입 시간은 v1 범위 밖이다.
 */
export const startupCollector: CaptureCollector<StartupData> = {
  id: 'startup',
  source: 'am start -W: TotalTime / LaunchState',
  needsTrace: false,

  /** 데이터소스도 SDK 하한도 없다 — `am start -W` 는 어느 안드로이드에서나 돈다. */
  supports(): SupportResult {
    return { supported: true }
  },

  /**
   * 빈 배열이다. 이 collector 때문에 TraceConfig 가 커지지 않는다.
   * `collectTraceConfigBlocks` 가 빈 배열을 걸러 주므로 config 에는 아무것도 안 남는다.
   */
  traceConfigBlocks(): string[] {
    return []
  },

  async extract(ctx: BaseExtractContext): Promise<ExtractOutcome<StartupData>> {
    if (!ctx.capture.launchRequested) {
      // 재려 하지 않은 것과 재려다 실패한 것은 다르다. 전자는 skipped 다.
      return { collected: false, status: 'skipped', reason: { code: 'launch_not_requested' } }
    }

    const startup = ctx.capture.startup
    // 음수는 파싱이 어긋났다는 뜻이다. 스키마의 nonnegative 에서 터뜨리는 대신 여기서 사유로 만든다 —
    // 스키마 실패는 result.json 을 통째로 못 내게 하고, 이건 메트릭 하나의 문제다.
    if (startup === null || startup.totalTimeMs === null || startup.totalTimeMs < 0) {
      // 기기가 `Status: timeout` 을 냈다면 TotalTime 이 없는 이유를 **기기가 이미 말한 것**이다.
      // 그걸 "앱이 이미 떠 있었을 수 있습니다" 로 렌더하면 도구가 원인을 지어낸다.
      if (startup?.status === 'timeout') {
        /**
         * **못 잰 것과 아무것도 모르는 것은 다르다.**
         *
         * TotalTime 은 없지만 기기는 두 가지를 말해 줬다: 스스로 `timeout` 이라고 했고,
         * 얼마나 기다렸는지도 찍었다. 예전에는 그 둘이 한국어 `reason` 문장 안에만 있어서
         * `result.json` 만 읽는 소비자(CI · LLM)가 쓸 수 없었다.
         *
         * `data` 를 채우되 `total_time_ms` 는 **null 로 남긴다** — `wait_time_ms` 를 그 자리에
         * 넣으면 기기의 임계치가 측정값으로 둔갑한다 (스키마의 `wait_time_ms` 주석에 실측이 있다).
         * status 는 여전히 `partial` 이다: 값이 있는 것이 아니라 정황이 있는 것이다.
         */
        return {
          // `collected: true` + `partialReason` 은 **값이 나왔지만 일부만 나온** 자리다
          // (types.ts 의 ExtractOutcome). 여기가 정확히 그것이다: 시작 시간은 없지만
          // 기기가 무엇을 했는지는 있다. status 는 `partial` 로 나간다.
          collected: true,
          data: {
            total_time_ms: null,
            launch_state: startup.launchState ?? null,
            status: startup.status ?? null,
            wait_time_ms: startup.waitTimeMs ?? null,
          },
          partialReason: {
            code: 'launch_wait_timed_out',
            detail: { wait_time_ms: startup.waitTimeMs ?? null },
          },
        }
      }
      return {
        collected: false,
        reason: { code: 'launch_time_unreported', detail: { am_start_status: startup?.status ?? null } },
      }
    }

    return {
      collected: true,
      data: {
        total_time_ms: startup.totalTimeMs,
        launch_state: startup.launchState ?? null,
        status: startup.status ?? null,
        wait_time_ms: startup.waitTimeMs ?? null,
      },
    }
  },
}
