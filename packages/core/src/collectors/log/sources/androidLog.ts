import { appProcessSql, resolveAppProcess, type ResolvedAppProcess } from '../../appProcess.js'
import type { AppProcessCandidate } from '../../appProcess.js'
import { relativeSecondSql } from '../../timeline.js'
import type { ExtractContext } from '../../types.js'
import { MAX_MESSAGE_CHARS, PRIO_ERROR } from '../toDomain.js'
import type { AppLogCollection, LogEventRow, PriorityCount } from '../model.js'

/**
 * **perfetto `android.log` 경로.** 이 파일이 아는 것은 SQL 뿐이다 —
 * 무엇이 크래시인지, 우선순위 정수가 어떤 이름인지는 도메인 계층이 정한다.
 */
export const ANDROID_LOG_SOURCE = 'android.log'

/**
 * 크래시 폭풍이 result.json 을 수십 MB 로 만들지 않도록.
 *
 * 이 상한이 실제로 걸리는 상황이 곧 이 상한을 만든 상황이므로, 걸렸을 때 짧아진 배열을
 * 전부인 것처럼 내보내지 않는다 — `log_events_truncated` 로 말한다.
 */
export const MAX_LOG_EVENTS = 200

export const LOG_COUNT_SQL =
  "select json_group_array(json_object('prio', prio, 'count', n)) as j from (" +
  'select prio as prio, count(*) as n from android_logs group by prio order by prio)'

/**
 * **대상 앱 프로세스가 찍은 줄만** 센다.
 *
 * `android_logs` 에는 프로세스가 아니라 `utid` 가 있어서 `thread` 를 한 번 거쳐야 `upid` 에
 * 닿는다. **pid 가 아니라 upid 로 거는 것이 요점이다** — pid 는 세션 뒤에 재사용될 수 있고,
 * 그러면 남의 로그가 이 앱의 것으로 집계된다.
 *
 * **시간으로 자르지 않는다.** 프로세스가 첫 폴링 표본을 남기기 전에 찍은 줄(콜드 스타트
 * 구간이 정확히 그렇다)까지 세는 것이 맞다. 트레이스의 구간이 곧 세션의 구간이다.
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
 * 앱 로그의 초당 발생량. 필터는 `appLogCountSql` 과 **같다** (utid → thread → upid).
 * 시간 기준점은 frame·memory 와 같은 trace_bounds 다.
 */
export function appLogTimelineSql(upid: number): string {
  return (
    'select json_group_array(json_array(t_s, n, e)) as j from (' +
    `select ${relativeSecondSql('l.ts')} as t_s, ` +
    `count(*) as n, sum(case when l.prio >= ${PRIO_ERROR} then 1 else 0 end) as e ` +
    'from android_logs l join thread th on l.utid = th.utid ' +
    `where th.upid = ${Math.trunc(upid)} group by t_s order by t_s)`
  )
}

/**
 * 후보만 좁혀 온다. 최종 판정은 도메인의 `classifyLogEvent` 가 한다 —
 * 그래야 규칙이 기기 없이 테스트된다.
 *
 * **이 목록은 대상 앱으로 거르지 않는다.** 실측(SM-S901N / Android 16): 이 트레이스의
 * `ActivityManager` 태그 16줄은 **전부 `system_server`(pid 2414)가 찍었다.** ANR 은 앱이
 * 아니라 그 프로세스가 기록하므로 앱 pid 로 거르면 ANR 이 통째로 사라진다.
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

export async function collectDevicePriorities(ctx: ExtractContext): Promise<PriorityCount[]> {
  return ctx.tp.queryJson<PriorityCount[]>(LOG_COUNT_SQL)
}

/** 상한만큼 받아 왔으면 그 뒤에 더 있었는지 알 수 없다. 그 사실을 함께 돌려준다. */
export async function collectEvents(
  ctx: ExtractContext,
): Promise<{ rows: LogEventRow[]; truncated: boolean }> {
  const rows = await ctx.tp.queryJson<LogEventRow[]>(LOG_EVENT_SQL)
  return { rows, truncated: rows.length >= MAX_LOG_EVENTS }
}

export interface AppLogResult {
  app: AppLogCollection | null
  resolved: ResolvedAppProcess<AppProcessCandidate> | null
  failure: string | null
}

/** **절대 던지지 않는다** — 앱 부분을 못 읽는 것이 기기 전역 개수까지 잃을 이유는 아니다. */
export async function collectAppLog(ctx: ExtractContext): Promise<AppLogResult> {
  try {
    const candidates = await ctx.tp.queryJson<AppProcessCandidate[]>(
      appProcessSql(ctx.packageName, ctx.capture.appPid),
    )
    const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
    if (resolved === null) return { app: null, resolved: null, failure: null }

    const upid = resolved.candidate.upid
    const byPriority = await ctx.tp.queryJson<PriorityCount[]>(appLogCountSql(upid))
    const rows = await ctx.tp.queryJson<[number, number, number][]>(appLogTimelineSql(upid))

    return {
      resolved,
      failure: null,
      app: {
        process: resolved.name,
        pid: resolved.candidate.pid,
        byPriority,
        rate: rows.map(([second, count, error]) => ({ second, count, error })),
      },
    }
  } catch (e) {
    return { app: null, resolved: null, failure: (e as Error).message }
  }
}
