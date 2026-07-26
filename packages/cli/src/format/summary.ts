import type { CpuData, LogData, LogEvent, MemoryData, Result, StartupData } from '@perftracker/core'

const num = (v: number): string => v.toLocaleString('en-US')
const mb = (kb: number): string => `${num(Math.round(kb / 1024))}MB`
const mhz = (khz: number): string => `${num(Math.round(khz / 1000))}MHz`

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
