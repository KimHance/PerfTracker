import type { Action } from './actions.js'
import { type AppState, CLI_LOG_LIMIT, type Tab, newTab } from './model.js'

/** 탭 하나만 갈아끼운다. 없는 키면 아무 일도 없다 — 닫힌 탭에 늦게 도착한 응답은 버린다. */
function patchTab(state: AppState, key: string, patch: Partial<Tab>): AppState {
  if (!state.tabs.some((t) => t.key === key)) return state
  return { ...state, tabs: state.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }
}

/**
 * 측정을 끝낸 탭은 **설정 화면으로 되돌아간다**. 기기와 `--launch`/`--force` 는 남기고
 * 앱·이름·마킹은 비운다: 같은 기기로 조건만 바꿔 다시 재는 것이 가장 흔한 다음 행동이고,
 * 이름과 마킹을 물려받으면 직전 세션의 흔적이 새 기록에 섞인다.
 */
function resetAfterStop(tab: Tab): Tab {
  return {
    ...tab,
    phase: 'setup',
    startedAt: null,
    sessionId: null,
    name: '',
    packageName: null,
    appQuery: '',
    marks: [],
    markDraft: '',
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'env/loaded':
      return { ...state, env: action.env }

    case 'devices/loaded':
      return { ...state, devices: action.devices }

    case 'apps/loaded':
      return { ...state, appsBySerial: { ...state.appsBySerial, [action.serial]: action.apps } }

    case 'runs/loaded':
      return { ...state, runs: action.runs }

    case 'doctor/loaded':
      return { ...state, doctor: action.checks }

    case 'doctor/dismissed':
      return { ...state, doctor: null }

    case 'tab/added': {
      const tab = newTab(action.key)
      return { ...state, tabs: [...state.tabs, tab], activeTabKey: tab.key }
    }

    case 'tab/selected':
      return { ...state, activeTabKey: action.key }

    case 'tab/closed': {
      // 최소 한 개는 남는다 — 탭이 0개면 사용자가 아무것도 할 수 없는 화면이 된다.
      if (state.tabs.length <= 1) return state
      const index = state.tabs.findIndex((t) => t.key === action.key)
      if (index < 0) return state
      const tabs = state.tabs.filter((t) => t.key !== action.key)
      const activeTabKey =
        state.activeTabKey === action.key
          ? (tabs[Math.min(index, tabs.length - 1)]?.key ?? tabs[0]!.key)
          : state.activeTabKey
      return { ...state, tabs, activeTabKey, confirm: null }
    }

    case 'tab/patched':
      return patchTab(state, action.key, action.patch)

    case 'mark/added': {
      const tab = state.tabs.find((t) => t.key === action.tabKey)
      if (!tab) return state
      // 최신이 위로 오게 앞에 붙인다 — 방금 남긴 마킹을 스크롤 없이 확인할 수 있어야 한다.
      const marks = [{ key: action.key, label: action.label, offsetMs: action.offsetMs }, ...tab.marks]
      return patchTab(state, action.tabKey, { marks, markDraft: '' })
    }

    case 'mark/removed': {
      const tab = state.tabs.find((t) => t.key === action.tabKey)
      if (!tab) return state
      return patchTab(state, action.tabKey, { marks: tab.marks.filter((m) => m.key !== action.key) })
    }

    case 'session/started':
      return patchTab(state, action.tabKey, {
        phase: 'running',
        sessionId: action.sessionId,
        name: action.name,
        startedAt: action.startedAt,
        marks: [],
        markDraft: '',
      })

    case 'session/stopped': {
      const tab = state.tabs.find((t) => t.key === action.tabKey)
      if (!tab) return state
      const next = patchTab(state, action.tabKey, resetAfterStop(tab))
      if (!action.run) return next
      // 여러 탭이 동시에 끝나도 기록은 항상 최신순이다 — 배열 앞에 넣고 시각으로 다시 세운다.
      const runs = [action.run, ...next.runs].sort((a, b) => b.at.localeCompare(a.at))
      return { ...next, runs, freshRunIds: [action.run.id, ...next.freshRunIds], drawerOpen: true }
    }

    case 'session/aborted': {
      const tab = state.tabs.find((t) => t.key === action.tabKey)
      if (!tab) return state
      return patchTab(state, action.tabKey, resetAfterStop(tab))
    }

    case 'run/renamed':
      return {
        ...state,
        runs: state.runs.map((r) => (r.id === action.runId ? { ...r, name: action.name } : r)),
        editingRunId: null,
        editDraft: '',
      }

    case 'run/removed':
      return {
        ...state,
        runs: state.runs.filter((r) => r.id !== action.runId),
        freshRunIds: state.freshRunIds.filter((id) => id !== action.runId),
        confirm: null,
      }

    case 'runs/cleared':
      return { ...state, runs: [], freshRunIds: [], confirm: null }

    case 'run/opened':
      // 한 번 열면 `NEW` 는 사라진다. 배지는 "아직 안 본 것" 을 뜻한다.
      return { ...state, freshRunIds: state.freshRunIds.filter((id) => id !== action.runId) }

    case 'run/editStarted':
      return { ...state, editingRunId: action.runId, editDraft: action.draft }

    case 'run/editChanged':
      return { ...state, editDraft: action.draft }

    case 'run/editCancelled':
      return { ...state, editingRunId: null, editDraft: '' }

    case 'drawer/toggled':
      return { ...state, drawerOpen: !state.drawerOpen }

    case 'drawer/opened':
      return { ...state, drawerOpen: true }

    case 'cli/toggled':
      return { ...state, cliOpen: !state.cliOpen }

    case 'cli/logged':
      return {
        ...state,
        cliLog: [{ at: action.at, command: action.command }, ...state.cliLog].slice(0, CLI_LOG_LIMIT),
      }

    case 'loading/began':
      return { ...state, loading: action.loading }

    case 'loading/ended':
      return { ...state, loading: null }

    case 'confirm/asked':
      return { ...state, confirm: action.confirm }

    case 'confirm/dismissed':
      return { ...state, confirm: null }

    case 'error/raised':
      // 실패는 로딩을 함께 걷는다 — 오버레이가 남으면 화면이 영원히 잠긴다.
      return { ...state, error: action.message, loading: null }

    case 'error/dismissed':
      return { ...state, error: null }

    case 'clock/ticked':
      return { ...state, now: action.now }
  }
}
