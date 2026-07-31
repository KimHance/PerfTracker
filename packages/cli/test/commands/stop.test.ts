import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatStopResult } from '../../src/commands/stop.js'

/**
 * **`stop` 이 사람에게 남기는 문장.** 값 요약은 여전히 없고, 있는 것은 *다음에 무엇을
 * 열면 되는가* 뿐이다. 그 한 줄이 **그대로 쳐서 도는 명령**이어야 한다는 것이 여기의 요점이다.
 */
describe('formatStopResult', () => {
  const inDefaultOut = resolve('runs', '2026-07-31T09-00-00_홈-스크롤')
  const inOtherOut = resolve('/tmp/pt-e2e-x1', '2026-07-31T09-00-00_홈-스크롤')

  it('result.json 경로와 보고서 만드는 법을 함께 낸다', () => {
    const out = formatStopResult({
      runDir: inDefaultOut,
      id: 'a3f9c1',
      state: 'completed',
      reportPath: null,
    })
    expect(out).toContain(`${inDefaultOut}/result.json`)
    expect(out).toContain('perftracker report a3f9c1')
  })

  /**
   * 기본 `runs` 에 있는 기록에까지 `-o` 를 붙이면 읽는 사람은 그것이 **필수 인자**인 줄 안다.
   * 필요할 때만 나와야 필요하다는 뜻이 된다.
   */
  it('기본 디렉토리에 있으면 -o 를 붙이지 않는다', () => {
    const out = formatStopResult({
      runDir: inDefaultOut,
      id: 'a3f9c1',
      state: 'completed',
      reportPath: null,
    })
    expect(out).not.toContain('-o')
  })

  /**
   * **`start -o <다른 곳>` 으로 잰 기록이 함정이다.** `report` 의 `-o` 기본값은 `runs` 라,
   * `-o` 없이 안내하면 그대로 쳤을 때 "기록을 찾지 못했습니다" 가 난다 — 안내한 명령이
   * 실패하면 사람은 도구가 아니라 자기 기록을 의심한다.
   */
  it('다른 디렉토리에 있으면 -o 로 그 자리를 함께 알려준다', () => {
    const out = formatStopResult({
      runDir: inOtherOut,
      id: 'a3f9c1',
      state: 'completed',
      reportPath: null,
    })
    expect(out).toContain('perftracker report a3f9c1 -o /tmp/pt-e2e-x1')
  })

  /** `--report` 로 이미 만들었으면 만드는 법을 다시 알릴 이유가 없다. */
  it('--report 로 만들었으면 그 경로를 내고 안내는 내지 않는다', () => {
    const out = formatStopResult({
      runDir: inOtherOut,
      id: 'a3f9c1',
      state: 'completed',
      reportPath: `${inOtherOut}/report.html`,
    })
    expect(out).toContain(`→ ${inOtherOut}/report.html`)
    expect(out).not.toContain('perftracker report')
  })

  /** 중단된 세션이라는 사실이 경로에 묻히지 않는다 — 그것이 첫 줄이다. */
  it('중단된 세션은 그 사실을 먼저 말한다', () => {
    const out = formatStopResult({
      runDir: inDefaultOut,
      id: 'a3f9c1',
      state: 'aborted',
      reportPath: null,
    })
    expect(out.split('\n')[0]).toContain('중단된 상태')
    expect(out).toContain(`${inDefaultOut}/result.json`)
  })
})
