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

/**
 * 전/후 차이. **음수면 `null` 이다** — 세션 중 앱 프로세스가 죽어 누적이 리셋된 것이고,
 * 그때 차이는 이 세션의 값이 아니다. 0 으로 뭉개면 "아무 일도 없었다" 가 된다.
 */
export function diffGfxinfo(pair: SnapshotPair | undefined): HwuiCollection | null {
  if (pair === undefined || pair.before === null || pair.after === null) return null

  const before = parseGfxinfoCounters(pair.before)
  const after = parseGfxinfoCounters(pair.after)
  if (before === null || after === null) return null

  const counters = {} as HwuiCounters
  let any = false

  for (const { field } of COUNTERS) {
    const b = before[field]
    const a = after[field]
    if (b === undefined || a === undefined || a < b) {
      counters[field] = null
      continue
    }
    counters[field] = a - b
    any = true
  }

  return any ? { counters } : null
}
