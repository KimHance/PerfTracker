import type { Result } from '@perftracker/core'

const num = (v: number): string => v.toLocaleString('en-US')

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
    `Duration  ${(result.session.duration_ms / 1000).toFixed(1)}s · ` +
      `adb calls during session: ${result.measurement_overhead.adb_commands_during_session}`,
    '',
  ]

  const frame = result.metrics.frame
  if (frame.status === 'collected' && frame.data) {
    const f = frame.data
    lines.push(
      `Frame     collected     ${num(f.total_frames)} frames · ≤16.67ms ${(f.within_16_67ms_ratio * 100).toFixed(1)}% · ` +
        `p50 ${f.percentiles.p50} · p95 ${f.percentiles.p95} · max ${f.max_ms} (ms)`,
    )
    lines.push(`          process       ${f.process}`)
  } else {
    lines.push(`Frame     ${frame.status.padEnd(13)} ${frame.reason ?? ''}`.trimEnd())
  }

  lines.push(
    '',
    `Overhead  buffer overrun: ${result.measurement_overhead.trace_buffer_overrun ? 'yes' : 'no'}`,
  )
  for (const w of result.warnings) lines.push(`Notes     ${w.message}`)

  return lines.join('\n')
}
