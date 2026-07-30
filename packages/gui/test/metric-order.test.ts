import { COLLECTORS } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { METRIC_ORDER } from '../src/contract/api.js'

/**
 * **두 목록이 갈리면 화면에서 지표가 통째로 사라진다.**
 *
 * `server/view.ts` 가 doctor 결과를 `METRIC_ORDER` 집합으로 거른다. 거기 없는 id 는 조용히
 * 버려진다 — 오류도 경고도 없다. 실제로 `hwui` 가 한동안 빠져 있었고, `frame` 이 미지원인
 * sdk 30 기기에서 화면은 "5/7 측정 가능" 이라고만 말하면서 **정작 그 기기에서 되는 렌더
 * 지표를 안 알려 줬다.** 그 기기에서 hwui 가 유일한 렌더 지표인데도.
 *
 * 계약은 core 를 모르지만(그래서 id 를 문자열로 다시 적는다) **테스트는 알아야 한다** —
 * 두 곳에 적은 목록이 같은지 확인할 사람이 아무도 없으면 그것이 갈리는 것은 시간 문제다.
 */
describe('화면의 지표 목록이 core 와 같다', () => {
  it('빠진 것도 남는 것도 없다', () => {
    expect([...METRIC_ORDER].sort()).toEqual(COLLECTORS.map((c) => c.id).sort())
  })

  /** 순서도 맞춘다 — `frame` 과 `hwui` 가 붙어 있는 것이 "둘은 짝" 이라는 표시다. */
  it('순서도 같다', () => {
    expect([...METRIC_ORDER]).toEqual(COLLECTORS.map((c) => c.id))
  })
})
