import { PerfettoSessionError } from '../errors.js'

export const DEFAULT_BUFFER_SIZE_KB = 65_536
export const DEFAULT_FLUSH_PERIOD_MS = 30_000
export const DEFAULT_FILE_WRITE_PERIOD_MS = 30_000
/** 세션 상한. 사람이 stop 을 잊어도 무한히 돌지 않게 한다. */
export const DEFAULT_MAX_DURATION_MS = 1_800_000

/**
 * ftrace 이벤트 **허용 목록**. 여기 없는 이벤트는 config 에 들어갈 수 없다.
 *
 * 원래는 `FORBIDDEN_FTRACE_EVENTS` 라는 블랙리스트(sched 계열 6개)였는데, 블랙리스트는
 * "명시적으로 금지한 것 말고는 다 괜찮다" 고 말한다. 그 말은 사실이 아니었다 —
 * `power/cpu_idle` 이 검사를 그대로 통과해 에뮬레이터 33초 세션에서 47,752건,
 * ftrace 페이로드의 **94%** 를 차지했고(전체 50,654건), 저장소 어디에도 그것을 읽는 코드는
 * 없었다. `sched/sched_switch` 를 "켜는 것만으로 부하" 라며 막는 도구가 읽지도 않는 이벤트에
 * 예산의 대부분을 쓰고 있었다.
 *
 * 뒤집은 이유는 볼륨이 아니라 **입증 책임**이다. 목록에 이벤트를 더하려는 사람은 여기를
 * 고쳐야 하고, 그때 "이걸 읽는 collector 가 어디 있나" 라는 질문이 자동으로 따라온다.
 * 블랙리스트에서는 그 질문이 아무 데서도 발생하지 않았다.
 *
 * **여기 추가할 때의 규칙: 그 이벤트를 읽는 collector 와 같은 커밋에 넣는다.**
 */
export const ALLOWED_FTRACE_EVENTS: readonly string[] = [
  // collectors/cpu.ts 의 CPU_FREQ_SQL 이 `cpufreq` 카운터 트랙으로 읽는다.
  'power/cpu_frequency',
]

const MIN_POLL_PERIOD_MS = 1000
/** Global Constraint: 파일 쓰기 주기가 짧으면 세션 내내 I/O 가 측정 대상에 섞인다. */
const MIN_FILE_WRITE_PERIOD_MS = 30_000

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
  for (const m of text.matchAll(/ftrace_events:\s*"([^"]+)"/g)) {
    const event = m[1]!
    if (ALLOWED_FTRACE_EVENTS.includes(event)) continue
    throw new PerfettoSessionError(
      `ftrace 이벤트 "${event}" 는 허용 목록에 없습니다.\n` +
        `perftracker 는 켜는 이벤트를 화이트리스트로 관리합니다 (perfetto/config.ts 의 ALLOWED_FTRACE_EVENTS).\n` +
        `  - 새 이벤트가 필요하면 **그것을 읽는 collector 와 함께** 목록에 추가하세요. ` +
        `읽지 않는 이벤트는 트레이스만 키우고 대상 앱의 CPU 를 씁니다.\n` +
        `  - sched/*, raw_syscalls/*, ftrace/print 처럼 초당 수만 건이 쏟아지는 이벤트는 ` +
        `켜는 것만으로 측정이 대상을 바꾸므로 목록에 올릴 수 없습니다.`,
    )
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

  // Global Constraint 를 정규식이 매치만 하고 지나가던 자리 — 명시적으로 검사한다.
  const fileWrite = /file_write_period_ms:\s*(\d+)/.exec(text)
  if (fileWrite === null) {
    throw new PerfettoSessionError(
      'file_write_period_ms 가 없습니다 — write_into_file 과 반드시 함께 설정해야 합니다.',
    )
  }
  if (Number(fileWrite[1]) < MIN_FILE_WRITE_PERIOD_MS) {
    throw new PerfettoSessionError(
      `file_write_period_ms 가 ${fileWrite[1]}ms 입니다 — ${MIN_FILE_WRITE_PERIOD_MS}ms 이상이어야 합니다.`,
    )
  }
}

/**
 * 여러 collector 가 낸 data_sources 블록을 합친다.
 *
 * 규칙: **같은 데이터소스는 완전히 같은 블록 텍스트로만 요청할 수 있다.**
 * 같은 텍스트면 하나로 접고, 같은 `name` 에 다른 설정이 오면 던진다 — 둘 중 하나를 말없이
 * 이기게 하면 어떤 설정으로 측정했는지가 결과에서 사라진다.
 * 공유 데이터소스가 필요한 collector 는 블록 문자열 상수를 공유해야 한다.
 */
export function mergeTraceConfigBlocks(blocks: string[]): string[] {
  const byName = new Map<string, string>()
  const out: string[] = []

  for (const block of blocks) {
    const name = /name:\s*"([^"]+)"/.exec(block)?.[1]
    if (name === undefined) {
      if (!out.includes(block)) out.push(block)
      continue
    }

    const seen = byName.get(name)
    if (seen === undefined) {
      byName.set(name, block)
      out.push(block)
      continue
    }
    if (seen !== block) {
      throw new PerfettoSessionError(
        `데이터소스 "${name}" 를 서로 다른 설정으로 두 번 요청했습니다. ` +
          `공유 데이터소스는 동일한 블록 텍스트를 써야 합니다.\n  A: ${seen}\n  B: ${block}`,
      )
    }
  }

  return out
}
