import type { AppView, DeviceView, DoctorCheckView, MarkView, RunView } from '../../contract/api.js'

/**
 * 화면 전체의 상태. **React 를 모른다** — 순수 데이터와 순수 함수만 있고,
 * 그래서 리듀서를 DOM 없이 테스트할 수 있다.
 *
 * 왜 탭이 배열인가: 세션은 동시에 여러 개 돈다. 브라우저 탭처럼 각 탭이 기기·앱·이름·
 * 옵션·마킹을 **독립으로** 들고 있어야 한 탭을 만져도 다른 탭의 측정이 흔들리지 않는다.
 */

export type TabPhase = 'setup' | 'running'


export interface Tab {
  key: string
  name: string
  serial: string | null
  packageName: string | null
  launch: boolean
  force: boolean
  offline: boolean
  appQuery: string
  phase: TabPhase
  /** 측정 중일 때만 값이 있다 (epoch ms). */
  startedAt: number | null
  /** 서버가 준 세션 id — 정지할 때 쓴다. */
  sessionId: string | null
  /**
   * 이 기기에서 못 재는 지표. `start` 응답이 준 것을 그대로 들고 있다가 측정 중 화면에 띄운다.
   * 예전에는 서버가 보내 주는데도 화면이 버렸다 — 사람이 30초 조작하고 나서야
   * "프레임이 안 잡혔다" 를 아는 것은 측정을 한 번 더 하게 만드는 정보다.
   */
  unsupported: { id: string; reason: string }[]
  /**
   * 서버가 준 마킹 목록의 사본. **시간순(오름차순)이다** — 화면이 최신순으로 그릴 뿐이다.
   * 삭제할 때 쓰는 인덱스가 서버의 인덱스와 같아야 하므로 순서를 여기서 바꾸지 않는다.
   */
  marks: MarkView[]
  markDraft: string
}

/** 대기 구간을 덮는 전체 화면 오버레이. 하나의 컴포넌트가 이것만 받는다. */
export interface Loading {
  label: string
  /** 지금 도는 실제 명령. 사람이 "무엇을 기다리는지" 를 알 수 있어야 한다. */
  command: string
}

export type Confirm =
  | { kind: 'delete-run'; runId: string; runName: string }
  | { kind: 'clear-runs'; count: number }
  | { kind: 'close-running-tab'; tabKey: string }

export interface CliLogEntry {
  /** HH:MM:SS */
  at: string
  command: string
}

export interface AppState {
  /** 서버가 알려 준 환경. **화면은 이것을 표시만 하고 정하지 않는다** (특히 `outDir`). */
  env: { version: string; adbPath: string | null; outDir: string }
  tabs: Tab[]
  activeTabKey: string
  devices: DeviceView[]
  /** 기기별 앱 목록. 기기를 바꿀 때마다 다시 받지 않기 위해 serial 로 캐시한다. */
  appsBySerial: Record<string, AppView[]>
  /**
   * **고른 앱**의 버전. `serial|package` 를 키로 캐시한다.
   * 목록에는 버전이 없다 — 앱마다 기기에 따로 물어야 나오는 값이라 82개를 한꺼번에 읽지 않는다.
   */
  appVersions: Record<string, string | null>
  runs: RunView[]
  /** 방금 만들어져 아직 열어 보지 않은 기록 id. `NEW` 배지가 붙는다. */
  freshRunIds: string[]
  doctor: DoctorCheckView[] | null
  drawerOpen: boolean
  cliOpen: boolean
  cliLog: CliLogEntry[]
  loading: Loading | null
  confirm: Confirm | null
  /** 인라인 이름 변경 중인 기록 id 와 초안. */
  editingRunId: string | null
  editDraft: string
  /** 마지막으로 실패한 요청의 메시지. 화면 상단에 그대로 띄운다. */
  error: string | null
  /** 경과 시간 표시용 현재 시각. 측정 중 탭이 있을 때만 갱신된다. */
  now: number
}

export const CLI_LOG_LIMIT = 40

export function newTab(key: string, name = ''): Tab {
  return {
    key,
    name,
    serial: null,
    packageName: null,
    launch: true,
    force: true,
    offline: false,
    appQuery: '',
    phase: 'setup',
    startedAt: null,
    sessionId: null,
    unsupported: [],
    marks: [],
    markDraft: '',
  }
}

export function initialState(
  env: AppState['env'] = { version: '0.1.0', adbPath: null, outDir: 'runs' },
): AppState {
  const first = newTab('t1')
  return {
    env,
    tabs: [first],
    activeTabKey: first.key,
    devices: [],
    appsBySerial: {},
    appVersions: {},
    runs: [],
    freshRunIds: [],
    doctor: null,
    drawerOpen: true,
    cliOpen: false,
    cliLog: [],
    loading: null,
    confirm: null,
    editingRunId: null,
    editDraft: '',
    error: null,
    now: 0,
  }
}
