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

  /**
   * **0초 기준점은 `trace_bounds.start_ts` 다 — 이 데이터소스의 첫 프레임이 아니다.**
   *
   * 이 화면의 존재 이유가 사용자 마크를 프레임 위에 겹쳐 보는 것이고, 마크는 이미 그 공통
   * 기준점으로 옮겨져 있다 (`gui/src/web/report/axis.ts` 의 `readMarks`). 여기만
   * `(select min(ts) from actual_frame_timeline_slice)` 같은 자기 기준으로 바꾸면, 앱이
   * 세션 초반 몇 초를 그리지 않은 만큼 **프레임 축만 통째로 밀리고 마크는 안 밀린다** —
   * 타입도 빌드도 테스트도 전부 초록인 채로 "이 마킹을 남긴 순간의 프레임" 이 몇 초씩
   * 어긋난 그림이 나온다. 실행 중 판정이 계획을 바꿔 가며 이 기준점을 못 박은 이유다.
   */
  it('0초를 trace_bounds 로 잡는다 — 마크와 같은 기준점이어야 한다', () => {
    expect(frameSamplesSql(42)).toContain('select start_ts from trace_bounds')
  })

  /**
   * **오름차순은 아래 두 소비자의 전제다.**
   *
   * `toDomain.ts` 는 `samples[0].tMs` 와 마지막 원소의 `tMs` 를 시간 범위의 양 끝으로 읽어
   * 버킷 폭을 정하고, 화면의 `idxAt` 은 막대 중심을 **이진 탐색**한다. 이 줄이 빠지면
   * 버킷 폭이 1ms 로 주저앉아 아무것도 접히지 않고 표본 상한(`MAX_SAMPLES`)이 무너지며
   * (`toDomain.test.ts` 의 내림차순 테스트가 그 결과를 적어 뒀다), 호버는 엉뚱한 프레임을
   * 짚는다. **정렬을 호스트에서 다시 하지 않는 대신 여기가 계약이다.**
   */
  it('t_ms 오름차순으로 낸다', () => {
    expect(frameSamplesSql(42)).toContain('order by t_ms')
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
