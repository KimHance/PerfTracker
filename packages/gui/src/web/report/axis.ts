import { MANIFEST } from './manifest.js'
import { readPath } from './read.js'

/**
 * **시간축은 하나다.**
 *
 * 모든 `t_s` 와 `session.marks[].offset_ms / 1000` 이 같은 0초(트레이스 시작)를 쓴다.
 * 그래서 한 시계열에 마우스를 올리면 나머지가 같은 순간을 가리킬 수 있고, "CPU 가 튄 그
 * 순간 프레임은 어땠나" 를 눈을 안 옮기고 읽는다.
 *
 * 지표마다 자기 배열의 최댓값으로 축을 잡으면 그 설계 의도가 죽는다 — 길이가 다른 두 계열이
 * 같은 폭으로 그려져서, 나란히 놓인 두 그래프의 같은 x 좌표가 서로 다른 초를 가리킨다.
 * 그래서 `maxT` 는 **화면 전체에서 한 번** 계산한다.
 *
 * 세션 길이까지 넣는 이유: 마지막 몇 초에 표본이 없는 세션에서 축이 일찍 끝나면, 그 빈 구간이
 * "측정하지 않은 시간" 이 아니라 "존재하지 않는 시간" 처럼 보인다.
 */
export function computeMaxT(res: unknown, marks: { t: number }[]): number {
  let maxT = 0

  for (const b of MANIFEST) {
    if (b.kind !== 'series') continue
    const arr = readPath(res, b.path)
    if (!Array.isArray(arr)) continue
    for (const row of arr) {
      const t = (row as { t_s?: unknown }).t_s
      if (typeof t === 'number' && t > maxT) maxT = t
    }
  }

  for (const m of marks) if (m.t > maxT) maxT = m.t

  const dur = readPath(res, 'session.duration_ms')
  if (typeof dur === 'number' && Math.ceil(dur / 1000) > maxT) maxT = Math.ceil(dur / 1000)

  // 0 이면 나눗셈이 터진다. 축이 한 칸은 있어야 한다.
  return maxT === 0 ? 1 : maxT
}

export interface Mark {
  t: number
  label: string
}

export function readMarks(res: unknown): Mark[] {
  const raw = readPath(res, 'session.marks')
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { offset_ms: number; label: string } =>
      typeof (m as { offset_ms?: unknown }).offset_ms === 'number')
    .map((m) => ({ t: Math.round(m.offset_ms / 1000), label: String(m.label) }))
}
