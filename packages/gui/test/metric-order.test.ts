import { COLLECTORS } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { METRIC_ORDER } from '../src/contract/api.js'
import { KNOWN_METRICS } from '../src/web/report/manifest.js'

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

/**
 * **이 지표 목록은 사실 세 군데에 따로 적혀 있다** — core 의 `COLLECTORS`, 계약의
 * `METRIC_ORDER`(위에서 검사), 그리고 `manifest.ts` 의 `KNOWN_METRICS`(매니페스트에 없는
 * 지표의 개수를 세는 데 쓴다). 세 번째는 **아무도 지키는 사람이 없었다** — `frame` 을
 * `KNOWN_METRICS` 에는 넣었는데 같은 파일의 `MetricId` 타입에는 넣지 않은 채로 커밋이
 * 들어갔고, `npm test`(vitest) 와 `npm run build`(`tsc --build`, `web` 소스는 안 봄)
 * 둘 다 그것을 못 잡고 통과했다 — `tsc -p packages/gui/tsconfig.web.json` 을 따로 돌려야만
 * 드러나는 에러였다. 목록이 두 군데 이상에 적히면 갈리는 것은 시간 문제라는 것이 이
 * 저장소의 규칙이고, 그래서 이 파일에 세 번째 목록도 같이 검사한다.
 */
describe('manifest 의 KNOWN_METRICS 도 같다', () => {
  it('빠진 것도 남는 것도 없고 순서도 같다', () => {
    expect(KNOWN_METRICS).toEqual([...METRIC_ORDER])
  })
})
