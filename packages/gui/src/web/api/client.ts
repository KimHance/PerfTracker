import type {
  ActiveSessionView,
  AppDetailView,
  AppView,
  DeviceView,
  DoctorCheckView,
  EnvView,
  MarkView,
  RunView,
  StartRequest,
  StartedSessionView,
  StopRequest,
  StopResult,
} from '../../contract/api.js'

/**
 * 웹이 기기에 닿는 **유일한** 통로.
 *
 * 컴포넌트는 fetch 를 부르지 않는다. 어디서든 서버를 부를 수 있으면 "지금 무엇이
 * 기기를 만지고 있는가" 를 아무도 답할 수 없게 되고, core 가 지키는 규칙 1(측정 창 안에서
 * 기기 접촉 0회)을 화면 쪽에서 조용히 깨게 된다.
 *
 * 구현은 둘이다: `http.ts` (실제 서버), `mock.ts` (서버 없이 화면만 돌릴 때).
 * 둘 다 이 인터페이스만 만족하면 되고, 화면은 어느 쪽인지 모른다.
 */
export interface ApiClient {
  env(): Promise<EnvView>
  doctor(serial: string | null): Promise<DoctorCheckView[]>
  devices(): Promise<DeviceView[]>
  /** 지금 돌고 있는 세션 전부. 기기에 접촉하지 않으므로 측정 중에도 부를 수 있다. */
  sessions(): Promise<ActiveSessionView[]>
  apps(serial: string): Promise<AppView[]>
  /** 고른 앱 하나의 버전. 목록 전체에는 돌리지 않는다 (계약의 AppDetailView 주석 참조). */
  appDetail(serial: string, packageName: string): Promise<AppDetailView>
  start(req: StartRequest): Promise<StartedSessionView>
  /** 측정 중 마킹. 서버 파일이 정본이라 매번 전체 목록을 돌려받는다. */
  marks(serial: string): Promise<MarkView[]>
  addMark(serial: string, label: string): Promise<MarkView[]>
  removeMark(serial: string, index: number): Promise<MarkView[]>
  stop(serial: string, req: StopRequest): Promise<StopResult>
  /** 측정 중인 세션을 기록 없이 버린다 (측정 중 탭 닫기). */
  abort(serial: string): Promise<void>
  runs(): Promise<RunView[]>
  renameRun(id: string, name: string): Promise<RunView>
  deleteRun(id: string): Promise<void>
  clearRuns(): Promise<void>
}

/** 서버가 낸 실패. `message` 는 이미 한국어 문장이라 화면에 그대로 올린다. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
