import { PerfettoSessionError } from '../errors.js'

export const DEFAULT_BUFFER_SIZE_KB = 65_536
export const DEFAULT_FLUSH_PERIOD_MS = 30_000
export const DEFAULT_FILE_WRITE_PERIOD_MS = 30_000
/** 세션 상한. 사람이 stop 을 잊어도 무한히 돌지 않게 한다. */
export const DEFAULT_MAX_DURATION_MS = 1_800_000

/** 초당 수만 건이 쏟아져 그 자체로 CPU 를 먹는 이벤트들. 켜는 순간 측정이 대상을 바꾼다. */
export const FORBIDDEN_FTRACE_EVENTS = [
  'sched/sched_switch',
  'sched/sched_waking',
  'sched/sched_wakeup',
  'raw_syscalls/sys_enter',
  'raw_syscalls/sys_exit',
  'ftrace/print',
]

const MIN_POLL_PERIOD_MS = 1000

export interface TraceConfigOptions {
  dataSourceBlocks: string[]
  durationMs?: number
  bufferSizeKb?: number
  flushPeriodMs?: number
  fileWritePeriodMs?: number
}

export function buildTraceConfig(opts: TraceConfigOptions): string {
  if (opts.dataSourceBlocks.length === 0) {
    throw new PerfettoSessionError('데이터소스가 하나도 없는 TraceConfig 는 만들 수 없습니다.')
  }

  const lines = [
    `buffers { size_kb: ${opts.bufferSizeKb ?? DEFAULT_BUFFER_SIZE_KB} fill_policy: RING_BUFFER }`,
    ...opts.dataSourceBlocks,
    // --detach 는 write_into_file 이 true 여야 한다 (없으면 perfetto 가 실행 자체를 거부한다).
    'write_into_file: true',
    `file_write_period_ms: ${opts.fileWritePeriodMs ?? DEFAULT_FILE_WRITE_PERIOD_MS}`,
    // write_into_file 과 짝이 아니면 trace_processor 가 트레이스를 전부 메모리에 올린다.
    `flush_period_ms: ${opts.flushPeriodMs ?? DEFAULT_FLUSH_PERIOD_MS}`,
    `duration_ms: ${opts.durationMs ?? DEFAULT_MAX_DURATION_MS}`,
  ]

  const text = `${lines.join('\n')}\n`
  assertLowOverheadConfig(text)
  return text
}

/**
 * 관찰자 효과를 만드는 설정이 config 에 들어가지 못하게 막는다.
 * 이 함수가 통과시킨 config 만 기기로 나간다.
 */
export function assertLowOverheadConfig(text: string): void {
  for (const event of FORBIDDEN_FTRACE_EVENTS) {
    if (text.includes(event)) {
      throw new PerfettoSessionError(
        `고빈도 ftrace 이벤트 "${event}" 는 측정 자체가 기기에 부하를 주므로 사용할 수 없습니다.`,
      )
    }
  }

  if (!text.includes('write_into_file: true')) {
    throw new PerfettoSessionError('write_into_file: true 가 없습니다 — --detach 사용 시 필수입니다.')
  }

  if (!/flush_period_ms:\s*\d+/.test(text)) {
    throw new PerfettoSessionError(
      'flush_period_ms 가 없습니다 — write_into_file 과 반드시 함께 설정해야 합니다.',
    )
  }

  for (const m of text.matchAll(/(\w*poll_ms|\w*period_ms):\s*(\d+)/g)) {
    const key = m[1]!
    if (!key.endsWith('poll_ms') && !/^(stat|meminfo|vmstat)_period_ms$/.test(key)) continue
    if (Number(m[2]) < MIN_POLL_PERIOD_MS) {
      throw new PerfettoSessionError(`${key} 가 ${m[2]}ms 입니다 — 폴링 주기는 1000ms 이상이어야 합니다.`)
    }
  }
}
