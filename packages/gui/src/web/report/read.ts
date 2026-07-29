/**
 * **세 상태를 가른다: 필드 부재 / `null` / 값.**
 *
 * 이 저장소 전체를 관통하는 규칙("`null` 은 `0` 이 아니다")이 화면에서 지켜지려면 두 가지를
 * 구분해야 한다. `result.json` 에서 두 상황은 서로 다른 사실이다:
 *
 * - **필드가 없다** — 이 도구가 그 값을 낼 줄 모르던 시절의 세션이다. "수집 안 함".
 * - **`null` 이다** — 재려고 했는데 값이 없었다. `reason_code` 가 왜인지 말한다. "값 없음".
 *
 * `undefined` 하나로 뭉치면 저 둘이 같아지고, 화면은 "이 도구는 원래 이걸 안 잰다" 와
 * "이 세션에서는 못 쟀다" 를 같은 회색으로 그리게 된다.
 *
 * 실제로 `samples/low-end.json` 의 `metrics.cpu.data.app` 이 `null` 인데 기기 쪽 값은
 * 멀쩡하다 — 그 하나를 "앱 CPU 0%" 로 그리면 그 화면은 거짓말이다.
 */
export const MISSING = Symbol('missing')

export type Read = typeof MISSING | null | unknown

/**
 * 점 표기 경로를 읽는다 (`'metrics.cpu.data.app.timeline'`).
 *
 * **`in` 으로 검사하는 것이 요점이다.** `cur[seg] === undefined` 로 판정하면 값이 실제로
 * `undefined` 인 필드와 없는 필드가 같아진다. JSON 에는 `undefined` 가 없으므로 여기서
 * `undefined` 를 만났다면 그것은 **키가 없다**는 뜻이다.
 */
export function readPath(root: unknown, path: string): Read {
  if (root === null || root === undefined) return MISSING
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return MISSING
    if (!(seg in (cur as Record<string, unknown>))) return MISSING
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}
