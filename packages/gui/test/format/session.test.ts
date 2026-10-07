import { describe, expect, it } from 'vitest'
import type { RunView } from '../../src/contract/api.js'
import { DIAGNOSE_MEASURE_COPY } from '../../src/web/format/diagnose.js'
import { runMetaLine, runningDiagnoseLines, runningKicker, tabBadge } from '../../src/web/format/session.js'
import { type Tab, newTab } from '../../src/web/state/model.js'

/**
 * **측정 화면의 진단 표시 넷** (DM-12) — 탭 배지 · running 킥커 · 각주 둘째 줄 · 기록 드로어 메타 줄.
 *
 * DOM 시험 도구가 없어서 화면이 무슨 글자를 내는지는 이 순수 함수들로 확인한다. 컴포넌트는 이것을
 * 부르기만 한다. 평소 세션 · 기록이면 진단 표시가 하나도 없고 글자가 이 기능 전과 같아야 한다 —
 * 기존 문구는 그대로다 (plan D10).
 */

const NOTICE = '앱 slice 열림 모름 — sdk 30 · debuggable 아님'

function running(overrides: Partial<Tab> = {}): Tab {
  return { ...newTab('t'), serial: 'S1', packageName: 'com.x', phase: 'running', startedAt: 0, ...overrides }
}

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'r1',
    name: '진단 스크롤',
    runDir: 'runs/r1',
    serial: 'S1',
    model: 'SM-S901N',
    packageName: 'com.x',
    appLabel: 'X',
    appVersion: '1.0',
    at: '2026-10-08T00:29:00',
    durationMs: 102_000,
    launch: true,
    unsupportedCount: 0,
    warningCount: 0,
    markCount: 0,
    ...overrides,
  }
}

describe('DM-12 진단 표시 4곳', () => {
  it('DM-12 진단 표시 4곳 — 진단 세션 탭 · running · 기록에 배지 · 킥커 · 각주 · 메타 꼬리가 있다', () => {
    const tab = running({ diagnose: true })

    expect(tabBadge(tab, 41_000)).toBe('진단 00:41')
    expect(runningKicker(tab)).toBe('측정 중 · 진단')
    expect(runningDiagnoseLines(tab).footnote).toBe(
      '진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분',
    )
    expect(runMetaLine(run({ diagnose: true }))).toBe('10/08 00:29 · 01:42 · launch · 경고 0 · 진단')
  })

  it('DM-12 진단 표시 4곳 — 각주는 두 사실(앱 프로세스 몫 · 평소 세션과 비교 불가)을 담는다', () => {
    const footnote = runningDiagnoseLines(running({ diagnose: true })).footnote!
    expect(footnote).toContain('slice 비용 앱 프로세스 몫')
    expect(footnote).toContain('평소 세션과 비교 불가')
  })

  it('DM-12 진단 표시 4곳 — 메타 꼬리 `진단` 은 기존 꼬리(미지원 · 마킹) 맨 끝이다', () => {
    expect(runMetaLine(run({ diagnose: true, warningCount: 3, unsupportedCount: 2, markCount: 4, launch: false }))).toBe(
      '10/08 00:29 · 01:42 · attach · 경고 3 · 미지원 2 · 마킹 4 · 진단',
    )
  })

  it('DM-12 진단 표시 4곳 — 표시 글자는 문구 모음에서 온다 (화면이 따로 적지 않는다)', () => {
    const tab = running({ diagnose: true })
    expect(tabBadge(tab, 0)).toBe(DIAGNOSE_MEASURE_COPY.tabBadge.replace('{elapsed}', '00:00'))
    expect(runningKicker(tab).endsWith(DIAGNOSE_MEASURE_COPY.kickerTail)).toBe(true)
    expect(runningDiagnoseLines(tab).footnote).toBe(DIAGNOSE_MEASURE_COPY.footnote)
    expect(runMetaLine(run({ diagnose: true })).endsWith(` · ${DIAGNOSE_MEASURE_COPY.drawerTag}`)).toBe(true)
  })
})

describe('DM-12 평소 세션엔 없음', () => {
  it('DM-12 평소 세션엔 없음 — 배지 · 킥커 · 각주 · 메타 줄이 이 기능 전과 같은 글자다', () => {
    const tab = running()

    expect(tabBadge(tab, 41_000)).toBe('00:41')
    expect(runningKicker(tab)).toBe('측정 중')
    expect(runningDiagnoseLines(tab)).toEqual({ notice: null, footnote: null })
    expect(runMetaLine(run())).toBe('10/08 00:29 · 01:42 · launch · 경고 0')
    expect(runMetaLine(run({ warningCount: 3, unsupportedCount: 2, markCount: 4 }))).toBe(
      '10/08 00:29 · 01:42 · launch · 경고 3 · 미지원 2 · 마킹 4',
    )
  })

  it('DM-12 평소 세션엔 없음 — 고지 칸에 무엇이 남아 있어도 진단이 아니면 찍지 않는다', () => {
    expect(runningDiagnoseLines(running({ diagnose: false, diagnoseNotice: NOTICE }))).toEqual({
      notice: null,
      footnote: null,
    })
  })

  it('DM-12 평소 세션엔 없음 — 설정 화면 배지는 진단 토글과 상관없이 `준비` 다', () => {
    // 토글은 아직 실행 전의 선택이다 — 진단 세션이 열린 것은 서버가 응답한 뒤다.
    expect(tabBadge({ ...newTab('t'), diagnose: true }, 41_000)).toBe('준비')
    expect(tabBadge(newTab('t'), 41_000)).toBe('준비')
  })
})

describe('DM-10 running 고지', () => {
  it('DM-10 running 고지 — 모름 칸 진단 세션이면 core 의 고지 줄을 글자 그대로 낸다', () => {
    // 화면이 판정하거나 조립하지 않는다 — `start --diagnose` 가 터미널에 찍는 줄과 같은 글자다.
    expect(runningDiagnoseLines(running({ diagnose: true, diagnoseNotice: NOTICE })).notice).toBe(NOTICE)
  })

  it('DM-10 running 고지 — 앱 slice 가 열리는 진단 세션은 고지가 없고 각주만 있다', () => {
    const lines = runningDiagnoseLines(running({ diagnose: true, diagnoseNotice: null }))
    expect(lines.notice).toBeNull()
    expect(lines.footnote).not.toBeNull()
  })
})
