import type { HwuiData } from '../../schema/result.js'
import { gfxinfoSnapshot } from '../snapshots.js'
import type {
  BaseExtractContext,
  CaptureCollector,
  CollectorEnv,
  ExtractOutcome,
  SupportResult,
} from '../types.js'
import { diffGfxinfo, GFXINFO_KEY } from './sources/gfxinfo.js'
import { toHwuiData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/gfxinfo.js'

/**
 * **프레임워크가 자기 렌더링을 직접 센 값.** `dumpsys gfxinfo <패키지>` 의 세션 전후 델타다.
 *
 * `frame` 과 나란히 있고 **대체가 아니라 짝이다.** 세는 대상이 다르다:
 *
 * ```
 *   frame   트레이스 — 화면에 나간 프레임의 분포·초 단위 추이. 레이어를 접어야 프레임이 된다
 *   hwui    프레임워크 — View 계층만. Vitals 모집단. 추이는 없고 대신 원인별 개수가 있다
 * ```
 *
 * 숫자가 다르면 그 차이가 정보다. 실측에서 둘이 212 로 일치해 `frame` 의 프레임 정의를
 * 확증한 적이 있다 — 서로 다른 두 경로가 같은 수를 내는 것이 가장 싼 증거다.
 *
 * **별도 지표인 이유는 트레이스가 없어도 나오기 때문이다.** 한동안 `frame.data.hwui` 였는데,
 * 그러면 트레이스 쪽이 실패할 때(sdk 30 은 `frametimeline` 자체가 없다) 함께 사라졌다 —
 * **gfxinfo 가 가장 쓸모 있는 자리가 정확히 그때**다. `CaptureCollector` 라 트레이스가 없는
 * run 에서도 정상 산출된다.
 *
 * **누적 카운터의 차이라 측정 중 기기 접촉은 0회다** (network 의 uid 델타와 같은 방식).
 */
export const hwuiCollector: CaptureCollector<HwuiData> = {
  id: 'hwui',
  source: 'dumpsys gfxinfo (세션 전후 델타)',
  needsTrace: false,

  /**
   * 기기 성질로는 막지 않는다. `dumpsys gfxinfo` 는 이 도구가 지원하는 모든 안드로이드에
   * 있고, 값이 안 나오는 것은 **앱**의 성질이다 (Unity·Vulkan·OpenGL 은 HWUI 를 안 쓴다).
   * 그것은 `supports()` 가 아니라 `extract()` 의 사유로 말한다 — 층이 다르다.
   */
  supports(_env: CollectorEnv): SupportResult {
    return { supported: true }
  },

  traceConfigBlocks() {
    return []
  },

  captureSnapshots(env: CollectorEnv) {
    // 대상 앱을 모르는 경로(`doctor`)에서는 명령을 내지 않는다.
    return env.packageName === undefined ? [] : [gfxinfoSnapshot(env.packageName)]
  },

  async extract(ctx: BaseExtractContext): Promise<ExtractOutcome<HwuiData>> {
    const delta = diffGfxinfo(ctx.capture.snapshots[GFXINFO_KEY])
    if (delta === null) {
      return {
        collected: false,
        reason: { code: 'hwui_stats_unavailable', detail: { package: ctx.packageName } },
      }
    }

    const data = toHwuiData(delta.collection)
    if (!delta.processRestarted) return { collected: true, data }

    // 값은 나왔지만 **뺀 것이 아니다.** 그 한정을 숨기면 소비자는 이것을 세션 델타로 읽는다.
    return {
      collected: true,
      data,
      partialReason: {
        code: 'hwui_counters_since_process_start',
        detail: { package: ctx.packageName },
      },
    }
  },
}
