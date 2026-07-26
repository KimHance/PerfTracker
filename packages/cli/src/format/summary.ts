import type {
  CpuData,
  LogData,
  LogEvent,
  MemoryData,
  NetworkData,
  Result,
  StartupData,
  ThermalData,
} from '@perftracker/core'

const num = (v: number): string => v.toLocaleString('en-US')
const mb = (kb: number): string => `${num(Math.round(kb / 1024))}MB`
const mhz = (khz: number): string => `${num(Math.round(khz / 1000))}MHz`

const bytes = (n: number): string => {
  if (n < 1024) return `${num(n)}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 부호를 반드시 붙인다. 실기기 4세션 중 **2세션에서 온도가 내려갔다**(32.1→30.8, 32.1→31.9).
 * 부호를 잃으면 요약이 "발열했다" 는 없던 사실을 말하게 된다.
 */
const signed = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

/** 못 읽은 숫자 자리. 0 으로 채우면 "재 봤더니 0" 이 되어 정반대 뜻이 된다. */
const orNa = (v: number | null): string => (v === null ? 'n/a' : String(v))

/** 앞 몇 개 존만 보여줄지. 나머지는 개수로 접는다 — 정렬하지 않으므로 기기 순서가 남는다. */
const ZONE_PREVIEW = 3

const LABEL_WIDTH = 10
const STATUS_WIDTH = 13

type AnyMetric = Result['metrics'][string] | undefined

/**
 * 값을 못 낸 항목의 줄. 상태와 **사유 코드**를 둘 다 보여준다 —
 * 코드는 사용자가 이슈에 그대로 옮길 수 있는 안정적인 키이고, 문장은 사람용이다.
 */
function statusLine(label: string, m: AnyMetric): string {
  if (m === undefined) {
    // 1.0.0 시절 result.json 이나 미지원 기기에서 아예 키가 없을 수 있다.
    return `${label.padEnd(LABEL_WIDTH)}${'not-collected'.padEnd(STATUS_WIDTH)} 이 결과에 없는 메트릭입니다.`
  }
  const code = m.reason_code !== null ? `[${m.reason_code}] ` : ''
  return `${label.padEnd(LABEL_WIDTH)}${m.status.padEnd(STATUS_WIDTH)} ${code}${m.reason ?? ''}`.trimEnd()
}

/** 값이 있는 항목의 줄. status 를 지우지 않는다 — partial 은 partial 이라고 쓴다. */
function valueLine(label: string, status: string, body: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${status.padEnd(STATUS_WIDTH)} ${body}`
}

/** 아직 stop 하지 않은 세션은 길이가 0 인 것이 아니라 **끝나지 않은** 것이다. */
function duration(ms: number | null): string {
  return ms === null ? 'n/a (stop 전)' : `${(ms / 1000).toFixed(1)}s`
}

/**
 * null 은 "셀 수 없었다" 다 (stop 전이고 활성 세션 포인터도 없다).
 * 0 으로 찍으면 "세어 봤더니 위반이 없었다" 가 되어 정확히 반대 뜻이 된다.
 */
function adbCalls(n: number | null): string {
  return n === null ? 'n/a (셀 수 없음)' : String(n)
}

/** 숫자와 수집 상태만 보여준다. 좋다/나쁘다를 색이나 문구로 칠하지 않는다. */
export function formatSummary(result: Result): string {
  const d = result.device.static
  const app = result.target_app
  const ram = Math.round(d.memory_total_kb / 1024 / 1024)
  const hz = d.display.active_refresh_rate_hz

  const lines = [
    `Session   ${result.session.name}  (${result.session.id})`,
    `Device    ${d.model} · Android ${d.android_release} · ${d.soc_model ?? '-'} · ${ram}GB · ` +
      `${d.display.width_px}x${d.display.height_px}${hz !== null ? `@${hz}Hz` : ''}`,
    `App       ${app.label}  ${app.package}  ${app.version_name ?? '-'}` +
      `${app.version_code !== null ? ` (${app.version_code})` : ''}`,
    // "adb calls during session: 0" 을 글자 그대로 읽으면 "아무도 기기를 안 건드렸다" 가 되는데
    // 그건 사실이 아니다. 이 카운터는 perftracker 를 통과한 호출만 센다. 라벨이 그걸 말한다.
    // 둘 다 null 일 수 있다 — 아직 stop 하지 않은 세션이다. 그때 0 을 찍으면 "0ms 동안
    // 돌았고 위반도 없었다" 라는, 어느 쪽도 사실이 아닌 문장이 된다.
    `Duration  ${duration(result.session.duration_ms)} · ` +
      `perftracker adb calls during session: ${adbCalls(result.measurement_overhead.adb_commands_during_session)}`,
    '',
  ]

  const frame = result.metrics.frame
  if (frame.data !== null) {
    const f = frame.data
    lines.push(
      // 16.67ms 는 구글의 60fps 기준(references)이지 이 패널의 예산이 아니다.
      // Device 줄의 @120Hz 와 나란히 놓이면 연관된 값으로 읽히므로 고정 기준임을 명시한다.
      valueLine(
        'Frame',
        frame.status,
        `${num(f.total_frames)} frames · ≤16.67ms (60fps ref) ${(f.within_16_67ms_ratio * 100).toFixed(1)}% · ` +
          `p50 ${f.percentiles.p50} · p95 ${f.percentiles.p95} · max ${f.max_ms} (ms)`,
      ),
      `          process       ${f.process} (pid ${f.pid})`,
    )
    // 값이 다 나왔어도 사유가 붙을 수 있다 — 프로세스 이름을 트레이스가 아니라 pid 로
    // 확인한 세션이 그렇다. 그 단서를 숫자 뒤에 숨기지 않는다.
    if (frame.reason !== null) lines.push(`          ${`[${frame.reason_code}]`} ${frame.reason}`)
  } else {
    lines.push(statusLine('Frame', frame))
  }

  const startup = result.metrics.startup
  if (startup?.data != null) {
    const s = startup.data as StartupData
    lines.push(
      valueLine(
        'Startup',
        startup.status,
        `TotalTime ${num(s.total_time_ms)}ms · ${s.launch_state ?? 'LaunchState 미보고'}`,
      ),
    )
  } else {
    lines.push(statusLine('Startup', startup))
  }

  const cpu = result.metrics.cpu
  if (cpu?.data != null) {
    const c = cpu.data as CpuData
    const cores = c.per_core.map((p) => `${p.busy_pct.toFixed(1)}%`).join('/')
    // 스펙: 사용률과 주파수는 함께 봐야 한다. 주파수가 없으면 그 자리에 n/a 를 남긴다 —
    // 빈칸으로 두면 "주파수는 원래 안 보여주는 도구" 로 읽힌다.
    const freq =
      c.frequency === null
        ? 'freq n/a'
        : c.frequency.map((f) => `cpu${f.cpu} ${mhz(f.avg_khz)}`).join(' · ')
    lines.push(
      valueLine('CPU', cpu.status, `total busy ${c.total_busy_pct.toFixed(1)}% · per-core ${cores} · ${freq}`),
    )
    if (cpu.reason !== null) lines.push(`          ${`[${cpu.reason_code}]`} ${cpu.reason}`)
  } else {
    lines.push(statusLine('CPU', cpu))
  }

  const memory = result.metrics.memory
  if (memory?.data != null) {
    const m = memory.data as MemoryData
    const system =
      m.system === null ? 'system n/a' : `system avail avg ${mb(m.system.mem_available.avg_kb)}`
    lines.push(
      valueLine('Memory', memory.status, `RSS avg ${mb(m.rss.avg_kb)} · peak ${mb(m.rss.max_kb)} · ${system}`),
    )
    if (memory.reason !== null) lines.push(`          ${`[${memory.reason_code}]`} ${memory.reason}`)
  } else {
    lines.push(statusLine('Memory', memory))
  }

  const log = result.metrics.log
  if (log?.data != null) {
    const l = log.data as LogData
    // null 은 "못 셌다" 다. 0 으로 찍으면 "재 봤더니 크래시가 없었다" 가 되어 정반대 뜻이 된다.
    const events = (v: LogEvent[] | null): string => (v === null ? 'n/a' : String(v.length))
    lines.push(
      valueLine(
        'Log',
        log.status,
        `crash ${events(l.crashes)} · ANR ${events(l.anrs)} · E ${num(l.by_priority.error)} · W ${num(l.by_priority.warn)} (device-wide, ${l.min_prio})`,
      ),
    )
    if (log.reason !== null) lines.push(`          ${`[${log.reason_code}]`} ${log.reason}`)
  } else {
    lines.push(statusLine('Log', log))
  }

  const thermal = result.metrics.thermal
  if (thermal?.data != null) {
    const t = thermal.data as ThermalData
    // hal_ready 는 세 상태다. null 을 "not ready" 로 접으면 확인하지 않은 것을 단정하게 된다.
    const hal =
      t.hal_ready_before === true ? 'HAL ready' : t.hal_ready_before === false ? 'HAL not ready' : 'HAL n/a'
    lines.push(
      valueLine(
        'Thermal',
        thermal.status,
        `${num(t.zones.length)} zone${t.zones.length === 1 ? '' : 's'} · ` +
          `Thermal Status ${orNa(t.device_status_before)} → ${orNa(t.device_status_after)} · ${hal}`,
      ),
    )

    // `zones` 가 온 순서 그대로 앞에서부터 자른다. 델타 크기로 정렬하지 않는다 —
    // 어느 센서가 중요한지는 이 도구가 말하지 않는 종류의 것이다.
    // (그 순서는 "기기가 준 순서" 가 아니라 HAL 절 먼저, cached 전용이 뒤다.
    //  스키마의 zones 설명에 규칙이 있다. 여기서 다시 정렬하면 그 규칙마저 지운다.)
    const preview = t.zones.slice(0, ZONE_PREVIEW)
    const shown = preview.map((z) => {
      const from = z.before_c === null ? 'n/a' : z.before_c.toFixed(1)
      const to = z.after_c === null ? 'n/a' : z.after_c.toFixed(1)
      // `cached` 만 표시한다. `hal` 은 기본값이라 붙이면 모든 줄이 길어지고 얻는 것이 없다.
      const notes = [
        z.delta_c === null ? null : signed(z.delta_c),
        z.source === 'cached' ? 'cached' : null,
      ].filter((v): v is string => v !== null)
      return `${z.name} ${from}→${to}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`
    })
    const rest = t.zones.length - shown.length
    // Network 줄이 uid 한정을 터미널까지 들고 가는 것과 같은 이유다. `cached` 존의 delta 0 을
    // "안 변했다" 로 읽는 것이 정확히 이 숫자의 오독이고, 요약만 보는 사람이 가장 많다.
    // 실기기에서는 HAL 존이 먼저 정렬되므로 cached 전용 존은 대개 "외 N개" 로 접히지만,
    // 그건 그 기기 계열의 관측이지 보장이 아니다 — HAL 이 존을 적게 주면 미리보기에 들어온다.
    // 표시 비용은 그때만 든다: cached 존이 안 보이면 이 문구는 아예 붙지 않는다.
    const cachedNote = preview.some((z) => z.source === 'cached')
      ? ' · cached = 갱신이 올 때만 바뀌는 값 (delta 0 이 "안 변했다" 가 아닐 수 있음)'
      : ''
    lines.push(
      `          ${'zones'.padEnd(STATUS_WIDTH)} ${shown.join(' · ')}` +
        `${rest > 0 ? ` · 외 ${num(rest)}개` : ''}${cachedNote}`,
    )
    if (thermal.reason !== null) lines.push(`          [${thermal.reason_code}] ${thermal.reason}`)
  } else {
    lines.push(statusLine('Thermal', thermal))
  }

  const network = result.metrics.network
  if (network?.data != null) {
    const n = network.data as NetworkData
    lines.push(
      valueLine(
        'Network',
        network.status,
        `rx ${bytes(n.rx_bytes)} / ${num(n.rx_packets)}pk · ` +
          `tx ${bytes(n.tx_bytes)} / ${num(n.tx_packets)}pk (세션 델타)`,
      ),
    )
    // uid 단위라는 한정을 터미널에도 남긴다. 요약만 보는 사람이 가장 많고,
    // "이 앱이 1.2MB 를 썼다" 로 읽는 것이 정확히 이 숫자의 오독이다.
    // null 은 "확인 안 됨" 이다 — [] 로 접어 "0개" 라고 쓰면 조회한 적도 없는 것을 단정한다.
    const shared =
      n.shared_uid_packages === null
        ? '이 uid 를 쓰는 패키지: 확인 안 됨'
        : `이 uid 를 쓰는 패키지 ${num(n.shared_uid_packages.length)}개` +
          (n.shared_uid_packages.length > 0 ? `: ${n.shared_uid_packages.join(', ')}` : '')
    // uid 는 수량이 아니라 **식별자**다. `num()` 을 태우면 `10,388` 이 되어
    // 기기에서 본 값(`10388`)과 글자가 달라지고 grep 이 안 된다.
    lines.push(`          ${'uid'.padEnd(STATUS_WIDTH)} ${String(n.uid)} · ${shared}`)
    if (network.reason !== null) lines.push(`          [${network.reason_code}] ${network.reason}`)
  } else {
    lines.push(statusLine('Network', network))
  }

  const o = result.measurement_overhead
  // null 은 "안 쟀다" 다. 0 으로 바꿔 쓰면 "재 봤더니 공짜였다" 가 되어 정확히 반대 뜻이 된다.
  const overhead =
    o.tracing_processes_cpu_share_pct !== null && o.tracing_processes_cpu_time_ms !== null
      ? `${o.tracing_processes_cpu_share_pct}% CPU (${num(o.tracing_processes_cpu_time_ms)}ms)` +
        `${o.tracing_processes_peak_rss_kb !== null ? ` · ${mb(o.tracing_processes_peak_rss_kb)} RSS` : ''}`
      : 'not measured'
  // null 은 "확인 못 함" 이다. no 로 찍으면 "확인해 봤더니 안 넘쳤다" 가 된다.
  const overrun =
    o.trace_buffer_overrun === null ? 'n/a (확인 못 함)' : o.trace_buffer_overrun ? 'yes' : 'no'
  lines.push('', `Overhead  tracing procs ${overhead} · buffer overrun: ${overrun}`)

  for (const w of result.warnings) lines.push(`Notes     ${w.message}`)

  return lines.join('\n')
}
