import { describe, expect, it } from 'vitest'
import { INLINE_REPORT_GLOBAL } from '../src/contract/api.js'
import { chooseRoute, hasInlineReport } from '../src/web/route.js'

/**
 * **이 규칙이 틀리면 증상이 빈 화면이다.** 오류도 로그도 없이 조용히 깨지므로 사람이
 * 열어 보기 전까지 아무도 모른다 — 그래서 진입점에서 뽑아내 여기서 확인한다.
 */
describe('무엇을 그릴지 고르는 규칙', () => {
  it('`?report=<id>` 면 보고서다', () => {
    expect(chooseRoute('?report=bc7a6a', false)).toEqual({ kind: 'report', runId: 'bc7a6a' })
  })

  /**
   * **실제로 여기서 깨졌다.** `perftracker report` 가 만든 파일은 `file://` 로 열려서
   * 쿼리가 붙을 자리가 없다. 쿼리만 보면 측정 화면으로 떨어지고, 그 화면은 서버를 부르다
   * 실패해 아무것도 안 보인다.
   */
  it('데이터가 심겨 있으면 쿼리가 없어도 보고서다', () => {
    expect(chooseRoute('', true)).toEqual({ kind: 'report', runId: '' })
  })

  it('심겨 있으면 `?mock` 보다도 세다 — 그 파일에는 부를 서버가 없다', () => {
    expect(chooseRoute('?mock', true).kind).toBe('report')
  })

  it('둘 다 없으면 측정 화면이다', () => {
    expect(chooseRoute('', false)).toEqual({ kind: 'app', mock: false, noDevices: false })
  })

  it('`?mock=empty` 는 기기 0대 화면이다', () => {
    expect(chooseRoute('?mock=empty', false)).toEqual({ kind: 'app', mock: true, noDevices: true })
  })

  /** 빈 값(`?report=`)은 id 가 아니다 — 그것으로 `/api/runs//report` 를 부르면 404 다. */
  it('`?report=` 빈 값은 보고서가 아니다', () => {
    expect(chooseRoute('?report=', false).kind).toBe('app')
  })
})

describe('심어진 데이터를 알아본다', () => {
  it('전역이 객체면 있다고 본다', () => {
    expect(hasInlineReport({ [INLINE_REPORT_GLOBAL]: { a: 1 } })).toBe(true)
  })

  it('없거나 null 이면 없다 — `null` 을 데이터로 읽으면 빈 보고서가 뜬다', () => {
    expect(hasInlineReport({})).toBe(false)
    expect(hasInlineReport({ [INLINE_REPORT_GLOBAL]: null })).toBe(false)
  })
})
