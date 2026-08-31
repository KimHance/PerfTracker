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
 * **오른쪽 끝은 `trace_span_ms` 다 — 세션 길이가 아니다.** 두 값은 다르다: `start` 가 adb
 * 왕복을 하는 동안 트레이서는 아직 돌지 않고 `stop` 은 트레이서를 먼저 멈춘다. 실측 네 세션
 * 모두 1~3초 짧았고, 세션 길이까지 축을 그리던 시절에는 **모든 그래프 꼬리에 회색 띠**가
 * 남았다 — 잰 적 없는 구간을 "값이 없는 구간" 으로 그린 것이다.
 *
 * `trace_span_ms` 가 없는 옛 세션에서는 세션 길이로 물러선다. 그때 꼬리가 비는 것은 맞지만,
 * 축이 데이터보다 일찍 끝나 잰 구간이 잘려 보이는 것보다는 낫다.
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

  // 초 단위 집계는 **온전히 덮인 초**에서만 값이 나온다. 트레이스가 8.25초를 덮었다면
  // 8초 칸은 4분의 1만 측정된 구간이라 표본이 없는 것이 정상이고, 거기까지 축을 그리면
  // 잰 적 없는 시간이 "값이 빠진 시간" 으로 보인다. 그래서 마지막 **온전한** 초까지만 간다.
  // 표본이 그보다 멀리 있으면 위에서 이미 축을 늘렸다 — 잰 것을 자르는 일은 없다.
  //
  // **이 규칙은 초 단위로 접힌 데이터에만 맞는다.** 프레임 타임라인은 초로 접히지 않아
  // `t_ms` 가 `trace_span_ms` 끝까지 가므로, 여기서 나온 `maxT` 를 그대로 폭으로 쓰면
  // 마지막 1초 남짓이 그림 밖으로 밀린다. 그 차트는 자기 데이터 끝까지 축을 늘리고
  // `maxT` 는 마크를 겹치는 데만 쓴다 (`blocks.ts` 의 `buildFrameTimeline`).
  const span = readPath(res, 'session.trace_span_ms')
  const dur = readPath(res, 'session.duration_ms')
  const end =
    typeof span === 'number'
      ? Math.floor(span / 1000) - 1
      : typeof dur === 'number'
        ? Math.ceil(dur / 1000)
        : null
  if (end !== null && end > maxT) maxT = end

  // 0 이면 나눗셈이 터진다. 축이 한 칸은 있어야 한다.
  return maxT === 0 ? 1 : maxT
}

export interface Mark {
  t: number
  label: string
}

/**
 * **마킹은 시계열과 다른 0초를 쓴다.** `offset_ms` 는 세션 시작(호스트 시계) 기준이고
 * `t_s` 는 트레이스 시작(기기 시계) 기준이다. 실측 0.88초 차이 — 1초 눈금에서 한 칸이
 * 밀린다. `trace_start_offset_ms` 로 옮겨야 "이 마킹을 남긴 순간의 CPU" 가 맞는 값이 된다.
 *
 * **그 값을 모르면 옮기지 않는다.** 0 으로 가정하고 옮기면 어긋난 자리에 찍히면서 맞는
 * 것처럼 보인다 — 틀린 줄 모르는 쪽이 더 나쁘다. 옛 세션이 그 경우다.
 *
 * 옮긴 결과가 음수면 0으로 붙인다: 트레이스가 시작되기 **전에** 찍힌 마킹이고
 * (`start` 직후 바로 남긴 경우), 축 밖으로 나가면 화면에서 사라진다.
 */
export function readMarks(res: unknown): Mark[] {
  const raw = readPath(res, 'session.marks')
  if (!Array.isArray(raw)) return []

  const offsetRaw = readPath(res, 'session.trace_start_offset_ms')
  const shiftMs = typeof offsetRaw === 'number' ? offsetRaw : 0

  return raw
    .filter((m): m is { offset_ms: number; label: string } =>
      typeof (m as { offset_ms?: unknown }).offset_ms === 'number')
    .map((m) => ({
      t: Math.max(0, Math.round((m.offset_ms - shiftMs) / 1000)),
      label: String(m.label),
    }))
}
