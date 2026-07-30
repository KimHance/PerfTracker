import { INLINE_REPORT_GLOBAL } from '../contract/api.js'

/**
 * **이 화면이 무엇을 그릴지 정하는 규칙 하나.**
 *
 * 라우터를 들이지 않았다 — 경로가 둘뿐이고, 이 저장소는 런타임 의존성을 늘리는 값을 매번
 * 따진다 (core 는 zod 하나, cli 는 commander 하나로 산다).
 *
 * **`main.tsx` 안에 두지 않는 이유는 테스트다.** 진입점은 import 하는 순간 `document` 를
 * 만지고 React 를 마운트해서, 규칙만 확인하려 해도 브라우저가 필요해진다. 그리고 이 규칙이
 * 틀리면 나오는 증상이 **빈 화면**이라 — 아무 오류도 없이 — 사람이 보기 전까지 아무도 모른다.
 * `axis.ts` `blocks.ts` 를 순수 함수로 뽑은 것과 같은 이유다.
 */
export type Route =
  | { kind: 'report'; runId: string }
  | { kind: 'app'; mock: boolean; noDevices: boolean }

export function hasInlineReport(scope: object = globalThis): boolean {
  const v = (scope as Record<string, unknown>)[INLINE_REPORT_GLOBAL]
  return v !== undefined && v !== null && typeof v === 'object'
}

/**
 * **심어진 데이터가 쿼리보다 세다.** `perftracker report` 가 만든 파일은 `file://` 로
 * 열려서 `?report=<id>` 가 붙을 자리가 없다 — 쿼리만 보면 측정 화면으로 떨어지고, 그
 * 화면은 서버를 부르다 실패해 아무것도 안 보인다.
 */
export function chooseRoute(search: string, inline: boolean): Route {
  const params = new URLSearchParams(search)
  const run = params.get('report')

  if (inline) return { kind: 'report', runId: run ?? '' }
  if (run !== null && run !== '') return { kind: 'report', runId: run }

  return {
    kind: 'app',
    mock: params.has('mock'),
    noDevices: params.get('mock') === 'empty',
  }
}
