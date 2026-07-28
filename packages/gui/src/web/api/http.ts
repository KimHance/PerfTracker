import {
  API,
  type ActiveSessionView,
  type ApiErrorBody,
  type AppDetailView,
  type AppView,
  type DeviceView,
  type DoctorCheckView,
  type EnvView,
  type MarkView,
  type RunView,
  type StartRequest,
  type StartedSessionView,
  type StopRequest,
  type StopResult,
} from '../../contract/api.js'
import { ApiError, type ApiClient } from './client.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
  })

  if (!response.ok) {
    // 서버는 실패를 ApiErrorBody 로만 낸다. 그렇지 않으면 서버가 아니라 프록시/정적 서버가
    // 답한 것이므로 상태 코드를 그대로 보여 준다 — 추측한 문장을 지어내지 않는다.
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(body?.message ?? `요청이 실패했습니다 (HTTP ${response.status})`, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 실제 GUI 서버를 부르는 구현. */
export function createHttpClient(): ApiClient {
  return {
    env: () => request<EnvView>(API.env),
    doctor: (serial) =>
      request<DoctorCheckView[]>(serial === null ? API.doctor : `${API.doctor}?device=${encodeURIComponent(serial)}`),
    devices: () => request<DeviceView[]>(API.devices),
    sessions: () => request<ActiveSessionView[]>(API.sessions),
    apps: (serial) => request<AppView[]>(API.apps(serial)),
    appDetail: (serial, pkg) => request<AppDetailView>(API.appDetail(serial, pkg)),
    start: (req: StartRequest) =>
      request<StartedSessionView>(API.start, { method: 'POST', body: JSON.stringify(req) }),
    marks: (serial) => request<MarkView[]>(API.marks(serial)),
    addMark: (serial, label) =>
      request<MarkView[]>(API.marks(serial), { method: 'POST', body: JSON.stringify({ label }) }),
    removeMark: (serial, index) => request<MarkView[]>(API.mark(serial, index), { method: 'DELETE' }),
    stop: (serial, req: StopRequest) =>
      request<StopResult>(API.stop(serial), { method: 'POST', body: JSON.stringify(req) }),
    abort: (serial) => request<void>(API.abort(serial), { method: 'DELETE' }),
    runs: () => request<RunView[]>(API.runs),
    renameRun: (id, name) =>
      request<RunView>(API.run(id), { method: 'PATCH', body: JSON.stringify({ name }) }),
    deleteRun: (id) => request<void>(API.run(id), { method: 'DELETE' }),
    clearRuns: () => request<void>(API.runs, { method: 'DELETE' }),
  }
}
