import type { MetricReason } from '../schema/reasons.js'
import type { AppLogData, LogData, LogEvent } from '../schema/result.js'
import {
  type AppProcessCandidate,
  appProcessSql,
  resolveAppProcess,
  staleNameReason,
} from './appProcess.js'
import { ANDROID_LOG_BLOCK, ANDROID_LOG_MIN_PRIO, PROCESS_STATS_BLOCK } from './blocks.js'
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
/**
 * 크래시 폭풍이 result.json 을 수십 MB 로 만들지 않도록.
 *
 * 이 상한이 실제로 걸리는 상황이 곧 이 상한을 만든 상황이므로, 걸렸을 때 짧아진 배열을
 * 전부인 것처럼 내보내지 않는다 — `log_events_truncated` 로 말한다. 값은 `LogDataSchema` 의
 * `.describe()` 에도 실린다 (`z.toJSONSchema` 는 주석을 못 본다).
 */
export const MAX_LOG_EVENTS = 200

export interface LogCountRow {
  prio: number
  count: number
}

export interface LogEventRow {
  tag: string
  msg: string
  /** 이 줄을 찍은 프로세스. `android_logs` 는 utid 만 갖고 있어 thread → process 를 거친다. */
  pid: number | null
  process: string | null
}

export const LOG_COUNT_SQL =
  "select json_group_array(json_object('prio', prio, 'count', n)) as j from (" +
  'select prio as prio, count(*) as n from android_logs group by prio order by prio)'

/**
 * **대상 앱 프로세스가 찍은 줄만** 센다.
 *
 * `android_logs` 에는 프로세스가 아니라 `utid` 가 있어서 `thread` 를 한 번 거쳐야 `upid` 에
 * 닿는다. **pid 가 아니라 upid 로 거는 것이 요점이다** — pid 는 세션 뒤에 재사용될 수 있고,
 * 그러면 남의 로그가 이 앱의 것으로 집계된다. upid 는 trace_processor 가 프로세스 하나에
 * 부여하는 식별자이고, memory 가 `mem.rss` 를 고를 때 쓰는 것과 같은 키다.
 *
 * **시간으로 자르지 않는다.** 프로세스가 첫 폴링 표본을 남기기 전에 찍은 줄(콜드 스타트
 * 구간이 정확히 그렇다)까지 세는 것이 맞고, 프로세스가 죽은 뒤의 줄은 애초에 존재할 수 없다.
 * 트레이스의 구간이 곧 세션의 구간이다.
 *
 * upid 는 숫자라 인터폴레이션이 안전하다.
 */
export function appLogCountSql(upid: number): string {
  return (
    "select json_group_array(json_object('prio', prio, 'count', n)) as j from (" +
    'select l.prio as prio, count(*) as n from android_logs l ' +
    'join thread th on l.utid = th.utid ' +
    `where th.upid = ${Math.trunc(upid)} group by l.prio order by l.prio)`
  )
}

/**
 * 후보만 좁혀 온다. 최종 판정은 호스트의 `classifyLogEvent` 가 한다 —
 * 그래야 규칙이 기기 없이 테스트된다.
 * `like` 의 `%` 는 여기서 접두어 매칭용이고, `_` 가 와일드카드인 것은 이 패턴들에서 무해하다.
 *
 * **이 목록은 대상 앱으로 거르지 않는다.** 실측(SM-S901N / Android 16): 이 트레이스의
 * `ActivityManager` 태그 16줄은 **전부 `system_server`(pid 2414)가 찍었다.** ANR 은 앱이
 * 아니라 그 프로세스가 기록하므로 앱 pid 로 거르면 ANR 이 통째로 사라진다. 대신 **찍은
 * 프로세스를 함께 실어** 소비자가 직접 귀속을 판단할 수 있게 한다 (`left join` 이라
 * 프로세스를 못 찾은 줄도 버려지지 않는다).
 */
export const LOG_EVENT_SQL =
  "select json_group_array(json_object('tag', tag, 'msg', msg, 'pid', pid, 'process', process)) as j from (" +
  `select l.tag as tag, substr(l.msg, 1, ${MAX_MESSAGE_CHARS}) as msg, ` +
  'p.pid as pid, p.name as process ' +
  'from android_logs l left join thread th on l.utid = th.utid ' +
  'left join process p on th.upid = p.upid where ' +
  "(l.tag = 'AndroidRuntime' and l.msg like 'FATAL EXCEPTION%') or " +
  "(l.tag = 'libc' and l.msg like 'Fatal signal %') or " +
  "(l.tag = 'ActivityManager' and l.msg like 'ANR in %') " +
  `order by l.ts limit ${MAX_LOG_EVENTS})`

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

function countOf(counts: LogCountRow[], prio: number): number {
  return counts.find((c) => c.prio === prio)?.count ?? 0
}

function bucket(counts: LogCountRow[]): { warn: number; error: number; fatal: number } {
  return {
    warn: countOf(counts, PRIO_WARN),
    error: countOf(counts, PRIO_ERROR),
    fatal: countOf(counts, PRIO_FATAL),
  }
}

/** 대상 앱 부분의 산출 결과. 값이 없으면 사유가 왜인지 말한다 — 0 을 내지 않는다. */
interface AppLogOutcome {
  data: AppLogData | null
  reason: MetricReason | null
}

/**
 * `app` 자리를 채운다. **절대 던지지 않는다** — 앱 프로세스를 못 읽는 것이 기기 전역 개수까지
 * 잃을 이유는 아니다 (이벤트 쿼리 실패를 개수와 분리해 온 것과 같은 규칙).
 *
 * **앱이 한 줄도 안 찍은 경우는 `0` 이다.** 이 함수는 호출자가 `no_log_entries` 관문을
 * 이미 통과한 뒤에만 불린다 — 즉 로그 파이프라인이 살아 있었다는 것이 확인된 상태다.
 * 그 0 은 관측이지 거짓 청정 신호가 아니다. 반대로 앱을 **특정하지 못한** 경우는 null 이다.
 */
async function extractAppLog(ctx: ExtractContext): Promise<AppLogOutcome> {
  try {
    const candidates = await ctx.tp.queryJson<AppProcessCandidate[]>(
      appProcessSql(ctx.packageName, ctx.capture.appPid),
    )
    const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
    if (resolved === null) {
      return {
        data: null,
        reason: { code: 'process_not_in_trace', detail: { package: ctx.packageName } },
      }
    }

    const counts = await ctx.tp.queryJson<LogCountRow[]>(appLogCountSql(resolved.candidate.upid))
    return {
      data: {
        process: resolved.name,
        pid: resolved.candidate.pid,
        total: counts.reduce((sum, c) => sum + c.count, 0),
        by_priority: bucket(counts),
      },
      reason: staleNameReason(resolved, ctx.packageName),
    }
  } catch (e) {
    return { data: null, reason: { code: 'query_failed', detail: { message: (e as Error).message } } }
  }
}

export const logCollector: TraceCollector<LogData> = {
  id: 'log',
  source: `perfetto: android.log (min_prio=${ANDROID_LOG_MIN_PRIO}) + linux.process_stats (앱 프로세스 특정)`,
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
    // process_stats 는 앱 단위 집계에 필요한 `thread`/`process` 테이블을 채우려고 선언한다.
    // **블록 텍스트는 공유 상수 그대로라 기기로 나가는 데이터소스가 늘지 않는다** —
    // frame/memory/cpu 가 이미 같은 상수를 요청하고 `mergeTraceConfigBlocks` 가 접는다.
    return [ANDROID_LOG_BLOCK, PROCESS_STATS_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<LogData>> {
    const counts = await ctx.tp.queryJson<LogCountRow[]>(LOG_COUNT_SQL)

    // 여기가 D6 이다. 데이터소스가 등록되어 있다고 로그가 흘렀다는 뜻은 아니다 —
    // API 35 에뮬레이터 이미지는 SELinux 가 traced_probes 의 logdr 소켓 접근을 막는다.
    // 그 상황에서 "crash 0 · ANR 0 · W 0" 을 collected 로 내보내면 그건 거짓말이다.
    //
    // **이 관문이 앱 단위 0 을 정직하게 만드는 근거이기도 하다**: 여기를 지났다는 것은
    // 기기에서 로그가 실제로 흘렀다는 뜻이므로, 그 뒤에 나오는 앱 0건은 관측이다.
    if (counts.length === 0) {
      return {
        collected: false,
        reason: { code: 'no_log_entries', detail: { min_prio: ANDROID_LOG_MIN_PRIO } },
      }
    }

    const app = await extractAppLog(ctx)

    // 이벤트 추출은 개수와 별개로 실패할 수 있다. 개수까지 잃지 않는다.
    const crashes: LogEvent[] = []
    const anrs: LogEvent[] = []
    let eventFailure: string | null = null
    let truncated = false
    try {
      const rows = await ctx.tp.queryJson<LogEventRow[]>(LOG_EVENT_SQL)
      // 상한만큼 받아 왔다 = 그 뒤에 더 있었는지 알 수 없다. SQL 의 limit 이 여기서 끝났다.
      truncated = rows.length >= MAX_LOG_EVENTS
      for (const row of rows) {
        const kind = classifyLogEvent(row)
        const event: LogEvent = {
          tag: row.tag,
          message: row.msg,
          pid: row.pid ?? null,
          process: row.process ?? null,
        }
        if (kind === 'crash') crashes.push(event)
        else if (kind === 'anr') anrs.push(event)
      }
    } catch (e) {
      eventFailure = (e as Error).message
    }

    const data: LogData = {
      min_prio: ANDROID_LOG_MIN_PRIO,
      app: app.data,
      // 문턱보다 낮은 우선순위가 섞여 오면(설정을 바꿔 재파싱한 경우) 그것도 total 에 넣는다 —
      // 트레이스에 있는 것을 세는 게 이 숫자의 정의다.
      device_total: counts.reduce((sum, c) => sum + c.count, 0),
      device_by_priority: bucket(counts),
      // 쿼리가 실패했으면 **null** 이다. 빈 배열은 "관측된 것이 없다" 는 사실 주장인데,
      // 못 센 것을 그렇게 실으면 이 collector 가 스스로 내세운 규칙(빈 로그 버퍼를 0 으로
      // 보고하지 않는다, 위 D6)을 두 줄 아래에서 뒤집는 것이 된다.
      device_crashes: eventFailure === null ? crashes : null,
      device_anrs: eventFailure === null ? anrs : null,
    }

    /**
     * **사유 자리는 하나뿐이라 순서를 여기서 못 박는다.** 위에서 아래로 처음 걸리는 것 하나:
     *
     * 1. 앱 부분이 값을 못 낸 사유 — `app: null` 의 **이유는 데이터 어디에도 없다.**
     *    (앱 단위 값이 이 변경의 표제이므로 그것이 비어 있는 이유가 가장 먼저다.)
     * 2. 이벤트 쿼리 실패 — `device_crashes: null` 로 드러나지만 원인 메시지는 여기에만 있다.
     * 3. `process_name_stale_in_trace` — 값은 정상이고 근거가 pid 였다는 사실. (1 과 배타적)
     * 4. `log_events_truncated` — 배열 길이가 상한과 같다는 흔적이 데이터에 남는다.
     */
    const reasons: MetricReason[] = [
      ...(app.reason !== null && app.data === null ? [app.reason] : []),
      ...(eventFailure !== null
        ? [{ code: 'query_failed' as const, detail: { message: eventFailure } }]
        : []),
      ...(app.reason !== null && app.data !== null ? [app.reason] : []),
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
