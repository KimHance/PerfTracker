import type { StartRequest } from '../../contract/api.js'
import type { ApiClient } from '../api/client.js'
import { markCommand, startCommand, stopCommand } from '../format/command.js'
import { formatClock, formatElapsed } from '../format/time.js'
import type { Action } from '../state/actions.js'
import type { Tab } from '../state/model.js'

/**
 * **기기에 닿는 모든 흐름이 여기 모인다.** 컴포넌트는 이 함수들만 부르고, 이 함수들만
 * `ApiClient` 를 안다.
 *
 * 왜 한 곳에 모으는가: "무엇이 언제 기기를 만지는가" 를 파일 하나만 읽고 답할 수 있어야
 * core 의 규칙 1(측정 창 안에서 기기 접촉 0회)이 화면 쪽에서도 지켜지는지 검사할 수 있다.
 * 컴포넌트가 저마다 fetch 를 부르면 그 검사가 불가능해진다.
 *
 * 규칙: 대기가 있는 흐름은 **반드시** `withLoading` 을 지난다. 지연은 고정값이 아니라
 * 응답이 올 때까지이고, 실패하면 오버레이를 걷고 오류를 올린다.
 */

export type Dispatch = (action: Action) => void

export interface EffectDeps {
  api: ApiClient
  dispatch: Dispatch
  /** 테스트에서 시간을 고정하기 위해 주입한다. */
  now?: () => Date
}

function log(deps: EffectDeps, command: string): void {
  deps.dispatch({ type: 'cli/logged', at: formatClock((deps.now ?? (() => new Date()))()), command })
}

/**
 * 대기 구간을 오버레이로 덮는다.
 * 실패는 삼키지 않는다 — 오류를 올리고 `null` 을 돌려 호출한 쪽이 후속 동작을 멈추게 한다.
 */
async function withLoading<T>(
  deps: EffectDeps,
  label: string,
  command: string,
  run: () => Promise<T>,
): Promise<T | null> {
  log(deps, command)
  deps.dispatch({ type: 'loading/began', loading: { label, command } })
  try {
    const result = await run()
    deps.dispatch({ type: 'loading/ended' })
    return result
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
    return null
  }
}

// ─── 조회 ──────────────────────────────────────────────────────────────────

/** 첫 화면. 오버레이 없이 조용히 채운다 — 아직 사람이 기다리고 있는 동작이 아니다. */
export async function bootstrap(deps: EffectDeps): Promise<void> {
  try {
    const [env, devices, runs] = await Promise.all([deps.api.env(), deps.api.devices(), deps.api.runs()])
    deps.dispatch({ type: 'env/loaded', env })
    deps.dispatch({ type: 'devices/loaded', devices })
    deps.dispatch({ type: 'runs/loaded', runs })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}

export async function refreshDevices(deps: EffectDeps): Promise<void> {
  const devices = await withLoading(deps, '연결된 기기를 조회하고 있습니다', 'perftracker devices', () =>
    deps.api.devices(),
  )
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

export async function runDoctor(deps: EffectDeps, serial: string | null): Promise<void> {
  const checks = await withLoading(
    deps,
    '환경과 기기를 점검하고 있습니다',
    serial === null ? 'perftracker doctor' : `perftracker doctor -d ${serial}`,
    () => deps.api.doctor(serial),
  )
  if (checks) deps.dispatch({ type: 'doctor/loaded', checks })
}

/**
 * 기기를 고르면 그 기기의 앱 목록을 받는다.
 * 이미 받아 둔 기기면 다시 부르지 않는다 — 목록 조회는 설치된 앱 수만큼 시간이 걸리고,
 * 탭을 오갈 때마다 다시 부를 이유가 없다.
 */
export async function selectDevice(
  deps: EffectDeps,
  tabKey: string,
  serial: string,
  alreadyLoaded: boolean,
): Promise<void> {
  deps.dispatch({ type: 'tab/patched', key: tabKey, patch: { serial, packageName: null, appQuery: '' } })
  if (alreadyLoaded) return

  const apps = await withLoading(deps, '설치된 앱을 읽고 있습니다', `perftracker apps -d ${serial}`, () =>
    deps.api.apps(serial),
  )
  if (apps) deps.dispatch({ type: 'apps/loaded', serial, apps })
}

// ─── 세션 ──────────────────────────────────────────────────────────────────

export async function startSession(deps: EffectDeps, tab: Tab): Promise<void> {
  if (tab.serial === null || tab.packageName === null) return

  const req: StartRequest = {
    serial: tab.serial,
    packageName: tab.packageName,
    name: tab.name.trim() === '' ? null : tab.name.trim(),
    launch: tab.launch,
    force: tab.force,
    outDir: tab.outDir,
  }

  const session = await withLoading(
    deps,
    '세션을 시작하고 트레이스를 켜고 있습니다',
    startCommand(tab),
    () => deps.api.start(req),
  )
  if (!session) return

  deps.dispatch({
    type: 'session/started',
    tabKey: tab.key,
    sessionId: session.id,
    name: session.name,
    // 경과 시간은 **서버가 준 시작 시각**에서 센다. 브라우저 시계를 쓰면 두 탭이 서로 다른
    // 기준으로 세고, 새로 고치면 경과가 0 으로 돌아간다.
    startedAt: Date.parse(session.startedAt),
  })
  // 기기 목록의 `measuring` 을 갱신해 다른 탭에서 이 기기를 못 고르게 한다.
  const devices = await deps.api.devices().catch(() => null)
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

export async function stopSession(deps: EffectDeps, tab: Tab): Promise<void> {
  if (tab.serial === null) return

  const run = await withLoading(
    deps,
    '트레이스를 회수하고 result.json 을 만들고 있습니다',
    stopCommand(tab),
    () =>
      deps.api.stop(tab.serial!, {
        offline: tab.offline,
        // 마킹은 측정 내내 브라우저와 서버 메모리에만 있었다. 여기서 처음 파일로 나간다 —
        // 측정 중에 기기로 나간 것은 아무것도 없다.
        marks: tab.marks.map((m) => ({ offsetMs: m.offsetMs, label: m.label })),
      }),
  )

  deps.dispatch({ type: 'session/stopped', tabKey: tab.key, run })
  const devices = await deps.api.devices().catch(() => null)
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

/** 측정 중인 탭을 닫는다 — 기록을 남기지 않고 기기의 Perfetto 세션만 정리한다. */
export async function abortSession(deps: EffectDeps, tab: Tab): Promise<void> {
  if (tab.serial !== null) {
    await withLoading(deps, '세션을 정리하고 있습니다', `perftracker stop -d ${tab.serial} (기록 없이 버림)`, () =>
      deps.api.abort(tab.serial!),
    )
  }
  deps.dispatch({ type: 'tab/closed', key: tab.key })
  const devices = await deps.api.devices().catch(() => null)
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

// ─── 마킹 ──────────────────────────────────────────────────────────────────

/**
 * 마킹은 **기기에 나가지 않는다.** 브라우저 상태에 넣고 CLI 로그에 사람이 남긴 사건으로
 * 적을 뿐이다. 정지할 때 한 번에 서버로 보낸다.
 */
export function addMark(deps: EffectDeps, tab: Tab, label: string, now: number): void {
  const trimmed = label.trim()
  if (trimmed === '' || tab.startedAt === null) return

  const offsetMs = Math.max(0, now - tab.startedAt)
  deps.dispatch({
    type: 'mark/added',
    tabKey: tab.key,
    key: `${tab.key}-${offsetMs}-${tab.marks.length}`,
    label: trimmed,
    offsetMs,
  })
  log(deps, markCommand(trimmed, formatElapsed(offsetMs)))
}

// ─── 기록 ──────────────────────────────────────────────────────────────────

export async function renameRun(deps: EffectDeps, runId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  // 빈 이름은 원래 이름을 지킨다 — 이름 없는 기록은 목록에서 서로 구분되지 않는다.
  if (trimmed === '') {
    deps.dispatch({ type: 'run/editCancelled' })
    return
  }
  try {
    const run = await deps.api.renameRun(runId, trimmed)
    deps.dispatch({ type: 'run/renamed', runId, name: run.name })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}

export async function deleteRun(deps: EffectDeps, runId: string, runName: string): Promise<void> {
  log(deps, `rm -rf runs/*_${runId}  # "${runName}"`)
  try {
    await deps.api.deleteRun(runId)
    deps.dispatch({ type: 'run/removed', runId })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}

export async function clearRuns(deps: EffectDeps): Promise<void> {
  log(deps, 'rm -rf runs/*')
  try {
    await deps.api.clearRuns()
    deps.dispatch({ type: 'runs/cleared' })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}
