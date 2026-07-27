import type { MetricReason } from '../../schema/reasons.js'
import type { LogData, LogEvent } from '../../schema/result.js'
import { staleNameReason } from '../appProcess.js'
import { ANDROID_LOG_BLOCK, ANDROID_LOG_MIN_PRIO, processStatsBlock } from '../blocks.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from '../types.js'
import {
  ANDROID_LOG_SOURCE,
  collectAppLog,
  collectDevicePriorities,
  collectEvents,
  MAX_LOG_EVENTS,
} from './sources/androidLog.js'
import { bucketPriorities, classifyLogEvent, toAppLogData, toLogEvent, totalOf } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/androidLog.js'

export const logCollector: TraceCollector<LogData> = {
  id: 'log',
  source: `perfetto: android.log (min_prio=${ANDROID_LOG_MIN_PRIO}) + linux.process_stats (앱 프로세스 특정)`,
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    if (!env.dataSources.includes(ANDROID_LOG_SOURCE)) {
      return {
        supported: false,
        reason: { code: 'data_source_not_registered', detail: { data_source: ANDROID_LOG_SOURCE } },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks(env: CollectorEnv) {
    // process_stats 는 앱 단위 집계에 필요한 `thread`/`process` 테이블을 채우려고 선언한다.
    // 블록 텍스트는 공유 상수 그대로라 기기로 나가는 데이터소스가 늘지 않는다.
    return [ANDROID_LOG_BLOCK, processStatsBlock(env.sdkInt)]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<LogData>> {
    const devicePriority = await collectDevicePriorities(ctx)

    // 데이터소스가 등록되어 있다고 로그가 흘렀다는 뜻은 아니다 — API 35 에뮬레이터 이미지는
    // SELinux 가 traced_probes 의 logdr 소켓 접근을 막는다. 그 상황에서 "crash 0 · W 0" 을
    // collected 로 내보내면 그건 거짓말이다.
    //
    // **이 관문이 앱 단위 0 을 정직하게 만드는 근거이기도 하다**: 여기를 지났다는 것은
    // 기기에서 로그가 실제로 흘렀다는 뜻이므로, 그 뒤에 나오는 앱 0건은 관측이다.
    if (devicePriority.length === 0) {
      return {
        collected: false,
        reason: { code: 'no_log_entries', detail: { min_prio: ANDROID_LOG_MIN_PRIO } },
      }
    }

    const appResult = await collectAppLog(ctx)

    // 이벤트 추출은 개수와 별개로 실패할 수 있다. 개수까지 잃지 않는다.
    const crashes: LogEvent[] = []
    const anrs: LogEvent[] = []
    let eventFailure: string | null = null
    let truncated = false
    try {
      const { rows, truncated: cut } = await collectEvents(ctx)
      truncated = cut
      for (const row of rows) {
        const kind = classifyLogEvent(row)
        if (kind === 'crash') crashes.push(toLogEvent(row))
        else if (kind === 'anr') anrs.push(toLogEvent(row))
      }
    } catch (e) {
      eventFailure = (e as Error).message
    }

    const data: LogData = {
      min_prio: ANDROID_LOG_MIN_PRIO,
      app: appResult.app === null ? null : toAppLogData(appResult.app),
      // 문턱보다 낮은 우선순위가 섞여 오면(설정을 바꿔 재파싱한 경우) 그것도 total 에 넣는다 —
      // 트레이스에 있는 것을 세는 게 이 숫자의 정의다.
      device_total: totalOf(devicePriority),
      device_by_priority: bucketPriorities(devicePriority),
      // 쿼리가 실패했으면 **null** 이다. 빈 배열은 "관측된 것이 없다" 는 사실 주장인데,
      // 못 센 것을 그렇게 실으면 이 collector 가 스스로 내세운 규칙(위 관문)을 뒤집는 것이 된다.
      device_crashes: eventFailure === null ? crashes : null,
      device_anrs: eventFailure === null ? anrs : null,
    }

    const appReason: MetricReason | null =
      appResult.failure !== null
        ? { code: 'query_failed', detail: { message: appResult.failure } }
        : appResult.resolved === null
          ? { code: 'process_not_in_trace', detail: { package: ctx.packageName } }
          : staleNameReason(appResult.resolved, ctx.packageName)

    /**
     * **사유 자리는 하나뿐이라 순서를 여기서 못 박는다.** 위에서 아래로 처음 걸리는 것 하나:
     *
     * 1. 앱 부분이 값을 못 낸 사유 — `app: null` 의 **이유는 데이터 어디에도 없다.**
     * 2. 이벤트 쿼리 실패 — `device_crashes: null` 로 드러나지만 원인 메시지는 여기에만 있다.
     * 3. `process_name_stale_in_trace` — 값은 정상이고 근거가 pid 였다는 사실. (1 과 배타적)
     * 4. `log_events_truncated` — 배열 길이가 상한과 같다는 흔적이 데이터에 남는다.
     */
    const reasons: MetricReason[] = [
      ...(appReason !== null && data.app === null ? [appReason] : []),
      ...(eventFailure !== null
        ? [{ code: 'query_failed' as const, detail: { message: eventFailure } }]
        : []),
      ...(appReason !== null && data.app !== null ? [appReason] : []),
      ...(truncated
        ? [{ code: 'log_events_truncated' as const, detail: { limit: MAX_LOG_EVENTS } }]
        : []),
    ]

    const first = reasons[0]
    return first === undefined
      ? { collected: true, data }
      : { collected: true, data, partialReason: first }
  },
}
