import type { ActiveSessionView } from '../../contract/api.js'
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

/**
 * **기기 목록이 바뀌면 탭의 선택을 다시 맞춘다.**
 *
 * 실측 결함: 기기·앱을 고른 뒤 케이블을 뽑고 `새로고침` 을 누르면 목록에서 기기가 사라지는데
 * 탭은 그 serial 과 packageName 을 **그대로 들고 있었다.** 화면에는 아무것도 선택되지 않은
 * 것처럼 보이는데 `측정 시작` 은 활성 상태였고, 누르면 없는 기기로 세션을 열려 했다.
 *
 * 쓸 수 없게 된 기기(`unauthorized` / `offline`)도 같이 본다 — 꽂혀 있기는 하지만 그 기기로
 * 세션을 열 수는 없다.
 *
 * **측정 중인 탭은 건드리지 않는다.** 케이블이 빠져도 그 세션의 포인터는 살아 있고, 정리는
 * `sessions/loaded` 와 `stop` 의 몫이다. 여기서 지우면 되찾을 길이 사라진다.
 */
function reconcileSelection(state: AppState): AppState {
  const usable = new Set(state.devices.filter((d) => d.state === 'device').map((d) => d.serial))

  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.phase === 'running' || tab.serial === null || usable.has(tab.serial)) return tab
      // 고른 기기가 사라졌거나 쓸 수 없게 됐다. 앱 선택도 함께 푼다 —
      // 앱 목록은 그 기기에서 읽은 것이라 기기 없이는 의미가 없다.
      return { ...tab, serial: null, packageName: null, appQuery: '' }
    }),
  }
}

/** `appVersions` 의 키. 같은 패키지라도 기기가 다르면 버전이 다를 수 있다. */
export function appVersionKey(serial: string, packageName: string): string {
  return `${serial}|${packageName}`
}

/** 아직 아무것도 고르지 않은 빈 탭. 세션을 되살릴 때 새 탭을 만드는 대신 이 자리를 쓴다. */
function isPristine(tab: Tab): boolean {
  return (
    tab.phase === 'setup' &&
    tab.serial === null &&
    tab.packageName === null &&
    tab.name.trim() === '' &&
    tab.marks.length === 0
  )
}

function tabFromSession(key: string, session: ActiveSessionView): Tab {
  return {
    ...newTab(key),
    name: session.name,
    serial: session.serial,
    packageName: session.packageName,
    launch: session.launch,
    phase: 'running',
    // 경과는 **서버가 준 시작 시각**부터 이어서 센다. 0 부터 다시 세면 새로고침 한 번에
    // 그 세션의 길이가 화면에서 거짓이 된다.
    startedAt: Date.parse(session.startedAt),
    sessionId: session.id,
    unsupported: session.unsupported,
    marks: session.marks,
  }
}

/**
 * 화면의 측정 중 탭을 **서버가 아는 세션 목록에 맞춘다.**
 *
 * 세 가지를 한 번에 한다:
 *   1. 서버에는 있는데 화면에 없는 세션 → 탭을 되살린다 (새로고침 복구, CLI 로 연 세션 표시)
 *   2. 화면에는 측정 중인데 서버에 없는 세션 → 밖에서 끝났다. 탭을 설정 화면으로 되돌린다
 *   3. 둘 다 있는 세션 → 마킹을 갱신한다 (`perftracker mark` 로 남긴 것이 여기서 들어온다)
 *
 * 몇 초마다 불리므로 **여러 번 불려도 결과가 같아야 한다** — 기기(serial)로 짝을 맞추는
 * 이유가 그것이다. 탭을 새로 만드는 판단은 짝이 없을 때만 한다.
 */
function syncSessions(state: AppState, sessions: ActiveSessionView[]): AppState {
  const bySerial = new Map(sessions.map((s) => [s.serial, s]))
  const matched = new Set<string>()

  let tabs = state.tabs.map((tab) => {
    if (tab.serial !== null && bySerial.has(tab.serial)) {
      const session = bySerial.get(tab.serial)!
      matched.add(tab.serial)
      if (tab.phase === 'running') {
        return { ...tab, marks: session.marks, unsupported: session.unsupported }
      }
      // 설정 화면인데 그 기기에 세션이 있다 = 이 탭이 잃어버린 세션이다. 되살린다.
      return tabFromSession(tab.key, session)
    }
    // 측정 중이었는데 서버에 없다 = 밖에서 끝났거나 버려졌다.
    if (tab.phase === 'running') {
      return { ...tab, phase: 'setup' as const, startedAt: null, sessionId: null, marks: [], unsupported: [] }
    }
    return tab
  })

  let seq = 0
  for (const session of sessions) {
    if (matched.has(session.serial)) continue
    const key = `s-${session.id}-${seq++}`
    const pristine = tabs.findIndex(isPristine)
    // 빈 탭이 있으면 그 자리를 쓴다 — 새로고침 직후처럼 탭이 하나뿐일 때 유령 탭이 남지 않게.
    if (pristine >= 0) tabs = tabs.map((t, i) => (i === pristine ? tabFromSession(t.key, session) : t))
    else tabs = [...tabs, tabFromSession(key, session)]
  }

  const activeTabKey = tabs.some((t) => t.key === state.activeTabKey)
    ? state.activeTabKey
    : (tabs[0]?.key ?? state.activeTabKey)

  return { ...state, tabs, activeTabKey }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'env/loaded':
      return { ...state, env: action.env }

    case 'devices/loaded':
      return reconcileSelection({ ...state, devices: action.devices })

    case 'apps/loaded':
      return { ...state, appsBySerial: { ...state.appsBySerial, [action.serial]: action.apps } }

    case 'appVersion/loaded':
      return {
        ...state,
        appVersions: {
          ...state.appVersions,
          [appVersionKey(action.serial, action.packageName)]: action.versionName,
        },
      }

    case 'runs/loaded':
      return { ...state, runs: action.runs, incompleteRunCount: action.incompleteCount }

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

    case 'sessions/loaded':
      return syncSessions(state, action.sessions)

    case 'marks/loaded':
      // 초안도 함께 비운다 — 서버가 받아들였다는 뜻이므로 입력칸에 남아 있을 이유가 없다.
      return patchTab(state, action.tabKey, { marks: action.marks, markDraft: '' })

    case 'session/started':
      return patchTab(state, action.tabKey, {
        phase: 'running',
        sessionId: action.sessionId,
        name: action.name,
        startedAt: action.startedAt,
        unsupported: action.unsupported,
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
      return { ...state, runs: [], incompleteRunCount: 0, freshRunIds: [], confirm: null }

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
