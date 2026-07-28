import type {
  AppView,
  DeviceView,
  DoctorCheckView,
  EnvView,
  RunView,
  StartRequest,
  StartedSessionView,
  StopRequest,
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
  apps(serial: string): Promise<AppView[]>
  start(req: StartRequest): Promise<StartedSessionView>
  stop(serial: string, req: StopRequest): Promise<RunView>
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
