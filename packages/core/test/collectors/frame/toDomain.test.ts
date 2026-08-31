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

  /**
   * **입력이 `tMs` 오름차순이라는 것은 계약이고, 그 계약은 SQL 의 `order by t_ms` 가 지킨다**
   * (`frametimeline.test.ts` 의 같은 이름 테스트). 여기서 다시 정렬하지 않는 이유는
   * 5,000장 넘는 배열을 두 번 정렬할 이유가 없어서이지, 순서를 안 타서가 아니다.
   *
   * 이 테스트가 적는 것은 "이렇게 동작해야 한다" 가 아니라 **계약이 깨지면 무슨 일이
   * 나는가**다: `first` 가 마지막 프레임이 되어 폭이 음수가 되고 `Math.max(1, …)` 이
   * 그것을 1ms 로 만든다 → 버킷 키가 프레임마다 달라 아무것도 접히지 않고, 표본 상한이
   * 무너져 `result.json` 이 지표가 아니라 **원본 덤프**가 된다. 상한 하나 때문에 이 지표를
   * 파일에 실을 수 있는 것이므로, 그 상한이 입력 순서에 달렸다는 사실은 적혀 있어야 한다.
   */
  it('내림차순 입력은 버킷을 무너뜨린다 — 정렬은 SQL 이 지키는 계약이다', () => {
    const asc: FrameSample[] = []
    for (let i = 0; i < MAX_SAMPLES * 2; i++) asc.push(s(i, 1))

    expect(toFrameData(asc).samples.length, '계약을 지킨 입력은 상한 안에 든다')
      .toBeLessThanOrEqual(MAX_SAMPLES)

    const out = toFrameData([...asc].reverse())
    expect(out.bucket_ms, '버킷 폭이 1ms 로 주저앉는다').toBe(1)
    expect(out.samples.length, '아무것도 접히지 않아 상한을 넘는다').toBeGreaterThan(MAX_SAMPLES)
  })

  it('프레임이 하나도 없으면 빈 표본이다', () => {
    const out = toFrameData([])
    expect(out.samples).toEqual([])
    expect(out.frames_seen).toBe(0)
    expect(out.sampling).toBe('all')
  })
})
