import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PerfTrackerError } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { runReport } from '../../src/commands/report.js'

/**
 * **예상된 실수는 예상된 얼굴로 답한다.**
 *
 * 진입점(`index.ts`)은 `PerfTrackerError` 만 한 문장으로 찍고, 나머지는 "예상치 못한 오류가
 * 발생했습니다 … 이슈로 알려주세요" 와 스택트레이스로 답한다. id 오타는 예상된 일인데
 * 한동안 평범한 `Error` 라서 뒤쪽으로 갔다 — 같은 실수를 `runs rename` 은 한 문장으로
 * 답하는데. `stop` 이 `perftracker report <id>` 를 안내하게 된 뒤로는 더 흔한 길이다.
 */
describe('runReport — 없는 id', () => {
  it('스택트레이스가 아니라 한 문장으로 답한다', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pt-report-'))
    await expect(runReport('zzzzzz', { out: empty, open: false })).rejects.toBeInstanceOf(
      PerfTrackerError,
    )
  })

  it('무엇을 쳐야 하는지도 함께 말한다', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pt-report-'))
    await expect(runReport('zzzzzz', { out: empty, open: false })).rejects.toThrow(
      /perftracker runs list/,
    )
  })
})
