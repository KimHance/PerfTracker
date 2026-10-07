import { PerfettoSessionError } from '../errors.js'

export const DEFAULT_BUFFER_SIZE_KB = 65_536
export const DEFAULT_FLUSH_PERIOD_MS = 30_000
export const DEFAULT_FILE_WRITE_PERIOD_MS = 30_000
/** 세션 상한. 사람이 stop 을 잊어도 무한히 돌지 않게 한다. */
export const DEFAULT_MAX_DURATION_MS = 1_800_000
/**
 * 진단 세션(`--diagnose`)의 상한 (plan D11 · DM-17). 평소 세션은 위 30분 그대로다.
 *
 * atrace 를 켜면 원본이 15초에 6.5–8.1 MiB 로 평소의 약 7–9배다 (SM-S901N · YouTube 실측).
 * 30분이면 0.8–1.0 GB 라 호스트 trace_processor 적재와 slice 표 행 수가 함께 커진다.
 */
export const DIAGNOSE_MAX_DURATION_MS = 600_000

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

/**
 * 진단 세션이 켜는 atrace 카테고리이자 **허용 목록** (DM-3 · DM-4). 여기 없는 카테고리는
 * 진단 세션이어도 config 에 들어갈 수 없다.
 *
 * 왜 이 셋인가 (SM-S901N · YouTube 15초 실측, 2026-10-07): am · wm · view 에 대상 앱 slice 를
 * 더한 원본이 6.5–8.1 MiB 다. **gfx** 를 더하면 37 MiB · slice 38만으로 늘고 늘어난 몫은 대부분
 * surfaceflinger · HWC composer 다 (plan D21). **input** 은 gfx 와 함께 33 MiB 였고 몫을 떼지
 * 못했다. **sched** 는 고빈도라 `ALLOWED_FTRACE_EVENTS` 와 같은 이유로 막는다.
 *
 * atrace slice 의 비용은 커널 ftrace 와 달리 **slice 를 남기는 프로세스 자신**에게 청구된다.
 * 그래서 평소 세션에는 하나도 켜지 않는다 — `assertLowOverheadConfig` 가 `atrace_` 키를 본다.
 */
export const DIAGNOSE_ATRACE_CATEGORIES: readonly string[] = ['am', 'wm', 'view']

/**
 * 진단 config 에 들어갈 수 있는 `atrace_` 키. **이 둘 밖은 진단 세션이어도 거부한다.**
 *
 * 키를 금지 목록이 아니라 허용 목록으로 두는 이유는 `ALLOWED_FTRACE_EVENTS` 와 같다 —
 * `atrace_categories_prefer_sdk` 처럼 나중에 생기는 키가 검사 없이 지나가지 않게.
 */
const ALLOWED_ATRACE_KEYS: readonly string[] = ['atrace_categories', 'atrace_apps']

/** 진단 세션의 config 를 검사할 때 필요한 것. `atrace_apps` 가 가리켜도 되는 패키지 하나. */
export interface DiagnoseConfigCheck {
  packageName: string
}

const MIN_POLL_PERIOD_MS = 1000
/** Global Constraint: 파일 쓰기 주기가 짧으면 세션 내내 I/O 가 측정 대상에 섞인다. */
const MIN_FILE_WRITE_PERIOD_MS = 30_000

export interface TraceConfigOptions {
  dataSourceBlocks: string[]
  durationMs?: number
  bufferSizeKb?: number
  flushPeriodMs?: number
  fileWritePeriodMs?: number
  /** 진단 세션이면 그 대상 패키지. 없으면 평소 세션이고 `atrace_` 키가 하나도 허용되지 않는다. */
  diagnose?: DiagnoseConfigCheck
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
  assertLowOverheadConfig(text, opts.diagnose ?? null)
  return text
}

/**
 * 관찰자 효과를 만드는 설정이 config 에 들어가지 못하게 막는다.
 * 이 함수가 통과시킨 config 만 기기로 나간다.
 *
 * `diagnose` 가 없으면(기본) 평소 세션이다 — `atrace_` 키가 하나라도 있으면 거부한다.
 * 있으면 진단 세션이고 그 키를 `assertAtraceKeys` 의 범위 안에서만 허용한다.
 */
export function assertLowOverheadConfig(text: string, diagnose: DiagnoseConfigCheck | null = null): void {
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

  // `*_poll_ms` / `*_period_ms` 로 끝나는 키는 **전부** 하한을 받는다.
  //
  // 예전에는 여기에도 화이트리스트(`stat|meminfo|vmstat`)가 있어서, 목록에 없는 주기 키는
  // 어떤 값이든 검사 없이 통과했다 — `thermal_period_ms: 250` 같은 설정이 원칙 1 의 강제
  // 장치를 그냥 지나갔다는 뜻이다. ftrace 이벤트에서 블랙리스트가 만든 것과 같은 종류의
  // 구멍이라 같이 막는다. 지금 쓰는 값은 전부 1000 / 30000 이라 이 강화로 달라지는 config 는
  // 없고, 앞으로 추가되는 데이터소스가 자동으로 검사를 받는다.
  //
  // 여전히 안 잡히는 것: 키 이름이 이 두 접미사로 끝나지 않는 주기 설정
  // (예: android.power 의 `battery_poll_ms` 는 잡히지만 `pull_frequency_ms` 는 안 잡힌다).
  // 그런 데이터소스를 들일 때 이 정규식도 함께 넓혀야 한다.
  for (const m of text.matchAll(/(\w*(?:poll|period)_ms):\s*(\d+)/g)) {
    if (Number(m[2]) < MIN_POLL_PERIOD_MS) {
      throw new PerfettoSessionError(
        `${m[1]} 가 ${m[2]}ms 입니다 — 주기는 1000ms 이상이어야 합니다. ` +
          `짧은 주기는 세션 내내 대상 앱과 CPU 를 다툽니다.`,
      )
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

  assertAtraceKeys(text, diagnose)
}

/**
 * atrace 의 문. 예전에는 이 검증기가 `ftrace_events` 만 봐서 atrace 카테고리 · 앱은 검사 없이
 * 통과했다 (기능 문서 「왜」). 그 구멍을 키 단위로 막는다.
 *
 * **키는 따옴표 밖에서 센다.** 따옴표 안(데이터소스 이름 · 패키지 이름)은 키가 아니다.
 * 그다음 키마다 `key: "값"` 한 쌍이어야 한다 — textproto 의 리스트 문법
 * (`atrace_categories: ["am", "gfx"]`)은 값 검사를 건너뛰는 길이라 꼴 자체를 거부한다.
 */
function assertAtraceKeys(text: string, diagnose: DiagnoseConfigCheck | null): void {
  const bare = text.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const keys = [...bare.matchAll(/\batrace_\w*/g)].map((m) => m[0])
  if (keys.length === 0) return

  if (diagnose === null) {
    throw new PerfettoSessionError(
      `평소 세션 config 에 ${keys[0]} 가 있습니다 — atrace 는 진단 세션(--diagnose)에서만 켭니다.\n` +
        `atrace slice 의 비용은 앱 프로세스 자신에게 청구되고 measurement_overhead 에 잡히지 않습니다.`,
    )
  }

  const outside = keys.find((k) => !ALLOWED_ATRACE_KEYS.includes(k))
  if (outside !== undefined) {
    throw new PerfettoSessionError(
      `진단 config 의 ${outside} 는 허용한 키가 아닙니다 — ${ALLOWED_ATRACE_KEYS.join(' · ')} 만 씁니다.`,
    )
  }

  const pairs = [...text.matchAll(/\b(atrace_\w*)\s*:\s*"([^"\\]*)"/g)].map((m) => ({ key: m[1]!, value: m[2]! }))
  if (pairs.length !== keys.length) {
    throw new PerfettoSessionError(
      `진단 config 의 atrace 키는 \`키: "값"\` 꼴이어야 합니다 — 키 ${keys.length}개 중 ${pairs.length}개만 그 꼴입니다.`,
    )
  }

  for (const { key, value } of pairs) {
    if (key === 'atrace_categories' && !DIAGNOSE_ATRACE_CATEGORIES.includes(value)) {
      throw new PerfettoSessionError(
        `atrace 카테고리 "${value}" 는 허용 목록에 없습니다 — ${DIAGNOSE_ATRACE_CATEGORIES.join(' · ')} 만 켭니다 ` +
          `(perfetto/config.ts 의 DIAGNOSE_ATRACE_CATEGORIES).`,
      )
    }
  }

  const apps = pairs.filter((p) => p.key === 'atrace_apps').map((p) => p.value)
  if (apps.length > 1) {
    throw new PerfettoSessionError(`진단 config 의 atrace_apps 가 ${apps.length}개입니다 — 대상 앱 하나만 씁니다.`)
  }
  for (const app of apps) {
    if (app.includes('*')) {
      throw new PerfettoSessionError(
        `atrace_apps "${app}" 에 와일드카드가 있습니다 — 모든 앱의 slice 비용을 각 앱에 청구하게 됩니다.`,
      )
    }
    if (app !== diagnose.packageName) {
      throw new PerfettoSessionError(
        `atrace_apps "${app}" 는 대상 앱(${diagnose.packageName})이 아닙니다 — 대상 앱 하나만 씁니다.`,
      )
    }
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
