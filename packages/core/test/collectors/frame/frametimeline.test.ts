import { describe, expect, it } from 'vitest'
import { frameSamplesSql, parseFrameSamples } from '../../../src/collectors/frame/sources/frametimeline.js'

describe('frameSamplesSql', () => {
  /**
   * 레이어를 접지 않으면 화면 갱신 한 번이 최대 20행이 된다 (실측 Stream 33초: 행 6,932 대
   * 실제 프레임 2,875 — 2.4배). 빈 배경 레이어가 1~2ms 에 끝나 빠른 쪽으로 몰린다.
   */
  it('display_frame_token 으로 접고 가장 오래 걸린 레이어를 고른다', () => {
    const sql = frameSamplesSql(42)
    expect(sql).toContain('partition by a.display_frame_token')
    expect(sql).toContain('order by a.dur desc')
    expect(sql).toContain('rn = 1')
  })

  /** --stop 이 끊은 진행 중 프레임은 dur = -1 로 온다. 남기면 0ms 대 유령이 된다. */
  it('끝나지 않은 프레임(dur < 0)을 버린다', () => {
    expect(frameSamplesSql(42)).toContain('a.dur >= 0')
  })

  it('표시 프레임(display frame)을 같은 행에 붙인다', () => {
    expect(frameSamplesSql(42)).toContain('d.dur')
  })

  /** 앱 프레임과 같은 가드. --stop 이 끊은 표시 프레임은 dur = -1 로 온다. */
  it('끝나지 않은 표시 프레임도 버린다', () => {
    expect(frameSamplesSql(42)).toContain('d.dur >= 0')
  })

  it('upid 를 그대로 박는다', () => {
    expect(frameSamplesSql(7)).toContain('a.upid = 7')
  })
})

describe('parseFrameSamples', () => {
  it('네 칸 배열을 표본으로 읽는다', () => {
    const out = parseFrameSamples('[[0,6.3,7.97,8.33],[8,5.72,7.99,8.33]]')
    expect(out).toEqual([
      { tMs: 0, appMs: 6.3, presentMs: 7.97, deadlineMs: 8.33 },
      { tMs: 8, appMs: 5.72, presentMs: 7.99, deadlineMs: 8.33 },
    ])
  })

  /** 마감이 없는 프레임이 있다. 0 으로 채우면 "마감이 0" 이라는 없던 사실이 된다. */
  it('마감이 없으면 null 로 남긴다', () => {
    expect(parseFrameSamples('[[0,6.3,7.97,null]]')[0]!.deadlineMs).toBeNull()
  })

  /** 표시 프레임 짝이 없는 것과 "0ms 만에 합성됐다" 는 다른 사실이다. */
  it('표시 시간이 없으면 null 로 남긴다 — 0 으로 채우지 않는다', () => {
    expect(parseFrameSamples('[[0,6.3,null,8.33]]')[0]!.presentMs).toBeNull()
  })

  it('빈 배열은 빈 배열이다', () => {
    expect(parseFrameSamples('[]')).toEqual([])
  })
})
