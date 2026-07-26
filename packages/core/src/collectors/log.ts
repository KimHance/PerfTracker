import type { LogData, LogEvent } from '../schema/result.js'
import { ANDROID_LOG_BLOCK, ANDROID_LOG_MIN_PRIO } from './blocks.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from './types.js'

const DATA_SOURCE = 'android.log'

/** android_logs.prio 의 정수 값. AndroidLogPriority 열거형 그대로다. */
const PRIO_WARN = 5
const PRIO_ERROR = 6
const PRIO_FATAL = 7

/** 메시지 원문을 무한정 싣지 않는다. 한 줄이 스택트레이스 전체인 경우가 있다. */
const MAX_MESSAGE_CHARS = 500
/** 크래시 폭풍이 result.json 을 수십 MB 로 만들지 않도록. */
const MAX_EVENTS = 200

export interface LogCountRow {
  prio: number
  count: number
}

export interface LogEventRow {
  tag: string
  msg: string
}

export const LOG_COUNT_SQL =
  "select json_group_array(json_object('prio', prio, 'count', n)) as j from (" +
  'select prio as prio, count(*) as n from android_logs group by prio order by prio)'

/**
 * 후보만 좁혀 온다. 최종 판정은 호스트의 `classifyLogEvent` 가 한다 —
 * 그래야 규칙이 기기 없이 테스트된다.
 * `like` 의 `%` 는 여기서 접두어 매칭용이고, `_` 가 와일드카드인 것은 이 패턴들에서 무해하다.
 */
export const LOG_EVENT_SQL =
  "select json_group_array(json_object('tag', tag, 'msg', msg)) as j from (" +
  `select tag as tag, substr(msg, 1, ${MAX_MESSAGE_CHARS}) as msg from android_logs where ` +
  "(tag = 'AndroidRuntime' and msg like 'FATAL EXCEPTION%') or " +
  "(tag = 'libc' and msg like 'Fatal signal %') or " +
  "(tag = 'ActivityManager' and msg like 'ANR in %') " +
  `order by ts limit ${MAX_EVENTS})`

/**
 * 태그와 메시지 접두어를 **둘 다** 본다.
 * 메시지만 보면 자기 로그에 "FATAL EXCEPTION" 을 찍는 앱이 크래시로 집계되고,
 * 태그만 보면 `AndroidRuntime` 의 평범한 줄까지 크래시가 된다.
 */
export function classifyLogEvent(row: LogEventRow): 'crash' | 'anr' | null {
  if (row.tag === 'AndroidRuntime' && row.msg.startsWith('FATAL EXCEPTION')) return 'crash'
  if (row.tag === 'libc' && row.msg.startsWith('Fatal signal ')) return 'crash'
  if (row.tag === 'ActivityManager' && row.msg.startsWith('ANR in ')) return 'anr'
  return null
}

export const logCollector: TraceCollector<LogData> = {
  id: 'log',
  source: `perfetto: android.log (device-wide, min_prio=${ANDROID_LOG_MIN_PRIO})`,
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    if (!env.dataSources.includes(DATA_SOURCE)) {
      return {
        supported: false,
        reason: { code: 'data_source_not_registered', detail: { data_source: DATA_SOURCE } },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks() {
    return [ANDROID_LOG_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<LogData>> {
    const counts = await ctx.tp.queryJson<LogCountRow[]>(LOG_COUNT_SQL)

    // 여기가 D6 이다. 데이터소스가 등록되어 있다고 로그가 흘렀다는 뜻은 아니다 —
    // API 35 에뮬레이터 이미지는 SELinux 가 traced_probes 의 logdr 소켓 접근을 막는다.
    // 그 상황에서 "crash 0 · ANR 0 · W 0" 을 collected 로 내보내면 그건 거짓말이다.
    if (counts.length === 0) {
      return {
        collected: false,
        reason: { code: 'no_log_entries', detail: { min_prio: ANDROID_LOG_MIN_PRIO } },
      }
    }

    const countOf = (prio: number): number =>
      counts.find((c) => c.prio === prio)?.count ?? 0

    // 이벤트 추출은 개수와 별개로 실패할 수 있다. 개수까지 잃지 않는다.
    const crashes: LogEvent[] = []
    const anrs: LogEvent[] = []
    let eventFailure: string | null = null
    try {
      for (const row of await ctx.tp.queryJson<LogEventRow[]>(LOG_EVENT_SQL)) {
        const kind = classifyLogEvent(row)
        if (kind === 'crash') crashes.push({ tag: row.tag, message: row.msg })
        else if (kind === 'anr') anrs.push({ tag: row.tag, message: row.msg })
      }
    } catch (e) {
      eventFailure = (e as Error).message
    }

    const data: LogData = {
      min_prio: ANDROID_LOG_MIN_PRIO,
      // 문턱보다 낮은 우선순위가 섞여 오면(설정을 바꿔 재파싱한 경우) 그것도 total 에 넣는다 —
      // 트레이스에 있는 것을 세는 게 이 숫자의 정의다.
      total: counts.reduce((sum, c) => sum + c.count, 0),
      by_priority: {
        warn: countOf(PRIO_WARN),
        error: countOf(PRIO_ERROR),
        fatal: countOf(PRIO_FATAL),
      },
      crashes,
      anrs,
    }

    return eventFailure === null
      ? { collected: true, data }
      : {
          collected: true,
          data,
          partialReason: { code: 'query_failed', detail: { message: eventFailure } },
        }
  },
}
