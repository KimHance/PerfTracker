import { describe, expect, it } from 'vitest'
import type { FrameSample } from '../../../src/collectors/frame/model.js'
import { MAX_SAMPLES, toFrameData } from '../../../src/collectors/frame/toDomain.js'

const s = (tMs: number, appMs: number, presentMs = 1, deadlineMs: number | null = 8.33): FrameSample =>
  ({ tMs, appMs, presentMs, deadlineMs })

describe('toFrameData', () => {
  it('상한 이하면 전부 싣고 all 이라고 말한다', () => {
    const out = toFrameData([s(0, 6.3), s(8, 5.7)])
    expect(out.sampling).toBe('all')
    expect(out.bucket_ms).toBeNull()
    expect(out.frames_seen).toBe(2)
    expect(out.samples).toEqual([[0, 6.3, 1, 8.33], [8, 5.7, 1, 8.33]])
  })

  /**
   * 균등 추출은 튄 프레임을 놓친다 — 튄 것을 보려고 만드는 화면이므로 목적을 배반한다.
   * 버킷마다 합이 가장 큰 것을 남긴다.
   */
  it('상한을 넘으면 버킷마다 가장 오래 걸린 프레임을 남긴다', () => {
    const many: FrameSample[] = []
    for (let i = 0; i < MAX_SAMPLES * 2; i++) many.push(s(i, 1))
    many[3] = s(3, 999)
    const out = toFrameData(many)

    expect(out.sampling).toBe('max_per_bucket')
    expect(out.frames_seen).toBe(MAX_SAMPLES * 2)
    expect(out.samples.length).toBeLessThanOrEqual(MAX_SAMPLES)
    expect(out.samples.some((r) => r[1] === 999), '가장 튄 프레임이 살아남아야 한다').toBe(true)
    expect(out.bucket_ms).toBeGreaterThan(0)
  })

  it('앱과 표시의 합으로 고른다 — 앱만 보면 합성이 밀린 프레임을 놓친다', () => {
    const many: FrameSample[] = []
    for (let i = 0; i < MAX_SAMPLES * 2; i++) many.push(s(i, 5, 1))
    many[10] = s(10, 1, 500)
    const out = toFrameData(many)
    expect(out.samples.some((r) => r[2] === 500)).toBe(true)
  })

  it('표시 시간이 null 이어도 고르고, null 그대로 싣는다', () => {
    const many: FrameSample[] = []
    for (let i = 0; i < MAX_SAMPLES * 2; i++) many.push(s(i, 1))
    many[20] = { tMs: 20, appMs: 900, presentMs: null, deadlineMs: 8.33 }
    const out = toFrameData(many)
    const picked = out.samples.find((r) => r[1] === 900)
    expect(picked, 'null 이 섞였다고 후보에서 빠지면 안 된다').toBeDefined()
    expect(picked![2], 'null 은 null 로 실린다').toBeNull()
  })

  it('프레임이 하나도 없으면 빈 표본이다', () => {
    const out = toFrameData([])
    expect(out.samples).toEqual([])
    expect(out.frames_seen).toBe(0)
    expect(out.sampling).toBe('all')
  })
})
