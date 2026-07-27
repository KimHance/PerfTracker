import type { AppLogData, LogEvent, LogTimelinePoint } from '../../schema/result.js'
import type { AppLogCollection, LogEventRow, LogRateSample, PriorityCount } from './model.js'

/** android_logs.prio 의 정수 값. AndroidLogPriority 열거형 그대로다. */
export const PRIO_WARN = 5
export const PRIO_ERROR = 6
export const PRIO_FATAL = 7

/** 메시지 원문을 무한정 싣지 않는다. 한 줄이 스택트레이스 전체인 경우가 있다. */
export const MAX_MESSAGE_CHARS = 500

function countOf(counts: PriorityCount[], prio: number): number {
  return counts.find((c) => c.prio === prio)?.count ?? 0
}

/** 정수 우선순위를 이름 있는 세 자리로 옮긴다. 합이 total 과 다를 수 있다 — 셋 밖도 세니까. */
export function bucketPriorities(counts: PriorityCount[]): {
  warn: number
  error: number
  fatal: number
} {
  return {
    warn: countOf(counts, PRIO_WARN),
    error: countOf(counts, PRIO_ERROR),
    fatal: countOf(counts, PRIO_FATAL),
  }
}

export function totalOf(counts: PriorityCount[]): number {
  return counts.reduce((sum, c) => sum + c.count, 0)
}

export function buildLogTimeline(rate: LogRateSample[]): LogTimelinePoint[] {
  return rate.map(({ second, count, error }) => ({ t_s: second, count, error }))
}

/**
 * 태그와 메시지 접두어를 **둘 다** 본다.
 * 메시지만 보면 자기 로그에 "FATAL EXCEPTION" 을 찍는 앱이 크래시로 집계되고,
 * 태그만 보면 `AndroidRuntime` 의 평범한 줄까지 크래시가 된다.
 *
 * **판정 규칙이 도메인 계층에 있는 이유:** 소스가 바뀌어도 "무엇이 크래시인가" 는 같아야 한다.
 */
export function classifyLogEvent(row: LogEventRow): 'crash' | 'anr' | null {
  if (row.tag === 'AndroidRuntime' && row.msg.startsWith('FATAL EXCEPTION')) return 'crash'
  if (row.tag === 'libc' && row.msg.startsWith('Fatal signal ')) return 'crash'
  if (row.tag === 'ActivityManager' && row.msg.startsWith('ANR in ')) return 'anr'
  return null
}

export function toLogEvent(row: LogEventRow): LogEvent {
  return { tag: row.tag, message: row.msg, pid: row.pid, process: row.process }
}

export function toAppLogData(app: AppLogCollection): AppLogData {
  return {
    process: app.process,
    pid: app.pid,
    total: totalOf(app.byPriority),
    by_priority: bucketPriorities(app.byPriority),
    timeline: buildLogTimeline(app.rate),
  }
}
