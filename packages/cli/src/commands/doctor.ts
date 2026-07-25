import type { DoctorCheck } from '@perftracker/core'

/** 점검 자체는 core 의 runDoctor 가 한다. 여기 남은 것은 표시뿐이다. */
export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name.padEnd(38)} ${c.detail}`).join('\n')
}
