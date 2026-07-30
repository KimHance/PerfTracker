import type { SnapshotPair } from '../../snapshots.js'
import type { HwuiCollection, HwuiCounters } from '../model.js'

/**
 * **`dumpsys gfxinfo <패키지>` 의 집계.** 프레임워크(HWUI)가 자기 렌더링을 직접 센 값이다.
 *
 * 트레이스와 **다른 것을 센다.** 이쪽은 View 계층 렌더링만이라 SurfaceView 나 그 배경
 * 레이어가 섞이지 않고, 안드로이드 Vitals 가 보는 모집단과 같다. 대신 초 단위 추이는 없다 —
 * 그쪽은 트레이스가 담당한다. 둘은 대체가 아니라 짝이다.
 *
 * **누적값이라 전/후 차이가 이 세션의 값이다.** 앱이 시작된 뒤로 계속 더해지므로, 세션 전에
 * 한 번 후에 한 번 찍어 빼면 그 사이의 값이 된다 (network 의 uid 델타와 같은 방식).
 */
export const GFXINFO_KEY = 'gfxinfo'

/** 우리가 읽는 숫자들. 이름은 `dumpsys` 출력의 라벨 그대로다. */
const COUNTERS: { field: keyof HwuiCounters; label: string }[] = [
  { field: 'totalFrames', label: 'Total frames rendered' },
  { field: 'jankyFrames', label: 'Janky frames' },
  { field: 'missedVsync', label: 'Number Missed Vsync' },
  { field: 'highInputLatency', label: 'Number High input latency' },
  { field: 'slowUiThread', label: 'Number Slow UI thread' },
  { field: 'slowBitmapUploads', label: 'Number Slow bitmap uploads' },
  { field: 'slowDrawCommands', label: 'Number Slow issue draw commands' },
  { field: 'deadlineMissed', label: 'Number Frame deadline missed' },
]

/**
 * `Janky frames: 94 (1.43%)` 처럼 괄호가 붙는 줄이 있어 **첫 정수만** 읽는다.
 * 라벨은 줄 시작에 붙어 있어야 한다 — `Janky frames (legacy)` 를 `Janky frames` 로 읽으면
 * 두 값이 섞인다. 실측에서 그 둘은 94 와 138 로 달랐다.
 */
export function parseGfxinfoCounters(text: string): Record<string, number> | null {
  const out: Record<string, number> = {}
  let found = 0

  for (const { field, label } of COUNTERS) {
    const re = new RegExp(`^${label}:\\s*(\\d+)`, 'm')
    const m = re.exec(text)
    if (m === null) continue
    out[field] = Number(m[1])
    found += 1
  }

  // 한 줄도 못 읽었으면 이 앱은 HWUI 통계를 내지 않는다 (Unity·Vulkan·OpenGL 앱이 그렇다).
  // 0 으로 채우면 "재 봤더니 없었다" 가 되는데 그것은 사실이 아니다.
  return found === 0 ? null : out
}

/** `** Graphics info for pid 30912 [pkg] **` 의 pid. 프로세스가 바뀌었는지 가르는 유일한 근거다. */
export function parseGfxinfoPid(text: string): number | null {
  const m = /^\*\* Graphics info for pid (\d+)/m.exec(text)
  return m === null ? null : Number(m[1])
}

/**
 * 전/후 차이.
 *
 * **프로세스가 바뀌었으면 빼지 않고 `after` 를 그대로 쓴다.** 누적은 프로세스 시작부터인데
 * 그 프로세스가 이 세션 안에서 시작했다면 누적값이 곧 세션값이다. `--launch` 세션이 항상
 * 이 경우다 — `start` 가 앱을 force-stop 하고 콜드로 띄우므로, before 스냅샷은 곧 죽을
 * 프로세스의 것이다. 실측(Stream `--launch`): before pid 30912 → after pid 1283, 그리고
 * before 에는 카운터 줄이 **아예 없었다**.
 *
 * 그것을 빼려고 들면(또는 음수라고 버리면) **`--launch` 세션에서는 이 지표가 영영 안 나온다**
 * — 콜드 스타트를 재는 세션이 가장 흔한 측정인데 말이다.
 *
 * 되돌아온 값은 `processRestarted` 로 그 사실을 함께 낸다. 프로세스가 세션 중 여러 번 죽었다면
 * `after` 는 **마지막** 시작 이후만 담으므로, 그 한정을 사유로 붙일 수 있어야 한다.
 */
export interface GfxinfoDelta {
  collection: HwuiCollection
  /** 전/후 프로세스가 다르다 — 값은 뺀 것이 아니라 새 프로세스의 누적 그대로다. */
  processRestarted: boolean
}

export function diffGfxinfo(pair: SnapshotPair | undefined): GfxinfoDelta | null {
  if (pair === undefined || pair.before === null || pair.after === null) return null

  const after = parseGfxinfoCounters(pair.after)
  // 종료 시점에 통계가 없으면 이 앱은 HWUI 로 그리지 않는다. 그것만은 어느 경우든 확실하다.
  if (after === null) return null

  const before = parseGfxinfoCounters(pair.before)
  const beforePid = parseGfxinfoPid(pair.before)
  const afterPid = parseGfxinfoPid(pair.after)

  // 프로세스가 바뀌었거나 시작 쪽 통계가 없으면 뺄 대상이 없다 — after 가 곧 세션값이다.
  const restarted = before === null || beforePid === null || afterPid === null || beforePid !== afterPid

  const counters = {} as HwuiCounters
  let any = false

  for (const { field } of COUNTERS) {
    const a = after[field]
    if (a === undefined) {
      counters[field] = null
      continue
    }
    if (restarted) {
      counters[field] = a
      any = true
      continue
    }
    const b = before![field]
    // 같은 프로세스인데 값이 줄었다 — 카운터가 리셋된 것이고 그 차이는 세션값이 아니다.
    counters[field] = b === undefined || a < b ? null : a - b
    if (counters[field] !== null) any = true
  }

  return any ? { collection: { counters }, processRestarted: restarted } : null
}
