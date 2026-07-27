import { describe, expect, it } from 'vitest'
import { formatDoctor } from '../../src/commands/doctor.js'

describe('formatDoctor', () => {
  it('통과 항목과 실패 항목을 다른 기호로 표시한다', () => {
    const out = formatDoctor([
      { name: 'adb', ok: true, kind: 'requirement' as const, detail: '/sdk/platform-tools/adb (default-sdk)' },
      { name: 'device', ok: false, kind: 'requirement' as const, detail: '연결된 기기 없음' },
    ])

    expect(out).toContain('✓ adb')
    expect(out).toContain('✗ device')
    expect(out).toContain('연결된 기기 없음')
  })

  it('모두 통과하면 실패 표시가 없다', () => {
    expect(formatDoctor([{ name: 'adb', ok: true, kind: 'requirement' as const, detail: 'ok' }])).not.toContain('✗')
  })
})
