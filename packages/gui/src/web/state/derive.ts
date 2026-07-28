import type { AppView, DeviceView } from '../../contract/api.js'
import type { AppState, Tab } from './model.js'

/**
 * 상태에서 계산해 낼 수 있는 것들. **상태에 저장하지 않는다** — 두 벌로 들고 있으면
 * 반드시 어긋나고, 어긋난 쪽이 화면에 나온다.
 */

export function activeTab(state: AppState): Tab {
  return state.tabs.find((t) => t.key === state.activeTabKey) ?? state.tabs[0]!
}

/**
 * 다른 탭이 점유한 기기 serial.
 *
 * 한 기기에 두 세션을 걸면 나중 것이 앞 것의 Perfetto 세션을 밀어내고, 두 result.json 이
 * 같은 트레이스를 나눠 갖는다. 그것은 데이터가 틀리는 것이라 UI 에서 먼저 막는다.
 */
export function busySerials(state: AppState, exceptTabKey?: string): Set<string> {
  const serials = new Set<string>()
  for (const tab of state.tabs) {
    if (tab.key === exceptTabKey) continue
    if (tab.phase === 'running' && tab.serial !== null) serials.add(tab.serial)
  }
  // 서버가 아는 진행 중 세션도 합친다 — 브라우저를 새로 고쳐도 점유는 그대로다.
  for (const device of state.devices) {
    if (device.measuring) serials.add(device.serial)
  }
  return serials
}

export function selectedDevice(state: AppState, tab: Tab): DeviceView | null {
  if (tab.serial === null) return null
  return state.devices.find((d) => d.serial === tab.serial) ?? null
}

export function selectedApp(state: AppState, tab: Tab): AppView | null {
  if (tab.serial === null || tab.packageName === null) return null
  const apps = state.appsBySerial[tab.serial] ?? []
  return apps.find((a) => a.packageName === tab.packageName) ?? null
}

/** 라벨 또는 패키지명 부분일치(대소문자 무시). 사람은 둘 중 아는 쪽으로 검색한다. */
export function filterApps(apps: AppView[], query: string): AppView[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return apps
  return apps.filter(
    (a) => a.label.toLowerCase().includes(needle) || a.packageName.toLowerCase().includes(needle),
  )
}

/** 기기와 앱이 모두 정해져야 시작할 수 있다. 이름은 비어도 서버가 붙여 준다. */
export function canStart(tab: Tab): boolean {
  return tab.serial !== null && tab.packageName !== null
}

export function runningCount(state: AppState): number {
  return state.tabs.filter((t) => t.phase === 'running').length
}

/** 측정 중 탭이 하나도 없으면 화면은 시계를 볼 이유가 없다 — 타이머를 재우기 위한 신호. */
export function needsClock(state: AppState): boolean {
  return runningCount(state) > 0
}

export function elapsedMs(tab: Tab, now: number): number {
  if (tab.startedAt === null) return 0
  return Math.max(0, now - tab.startedAt)
}
