import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * **진단 세션도 `stop` · `extract` 는 요약을 찍지 않는다** (DM-11 · 안 바뀔 것). slice 표가 아무리
 * 커도 산출물은 `result.json` 하나이고, 무엇을 앞에 둘지 고르는 순간 그것이 판정이 된다.
 */
describe('DM-11 stop 출력 그대로', () => {
  it('DM-11 stop 출력 그대로 — 진단 세션 기록도 경로와 보고서 명령 두 줄뿐이다', () => {
    const diagnoseRun = resolve('runs', '2026-10-08T00-29-11_유튜브-진단_a1b2c3')

    expect(
      formatStopResult({ runDir: diagnoseRun, id: 'a1b2c3', state: 'completed', reportPath: null }),
    ).toBe(`→ ${diagnoseRun}/result.json\n  perftracker report a1b2c3 로 보고서를 엽니다`)
  })

  /**
   * 위 함수는 세션 종류를 입력으로 받지 않으므로, 진단 표시가 끼어들 길은 두 명령이 진단 블록을
   * 읽기 시작하는 것뿐이다. 그 길을 막아 둔다 — 붙이려면 이 시험을 먼저 지워야 하고 그것이 의사 표시다.
   */
  it('DM-11 stop 출력 그대로 — stop · extract 는 진단 블록 · 진단 문구를 읽지 않는다', () => {
    for (const file of ['stop.ts', 'extract.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../../src/commands/${file}`, import.meta.url)), 'utf8')
      expect(source, file).not.toMatch(/diagnos|slice|진단/i)
    }
  })
})
