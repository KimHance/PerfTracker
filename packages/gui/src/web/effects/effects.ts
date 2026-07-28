import type { StartRequest } from '../../contract/api.js'
import type { ApiClient } from '../api/client.js'
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
 *
 * `command` 는 **읽기 요청**에만 화면이 안다 (인자가 serial 하나뿐이라 틀릴 여지가 없다).
 * 실제로 뭔가를 실행하는 start/stop 은 서버가 자기가 한 일을 응답에 실어 보내므로
 * `commandFrom` 으로 그것을 받아 로그에 남긴다 — 화면이 조립하지 않는다.
 */
async function withLoading<T>(
  deps: EffectDeps,
  label: string,
  command: string,
  run: () => Promise<T>,
  commandFrom?: (result: T) => string,
): Promise<T | null> {
  if (commandFrom === undefined) log(deps, command)
  deps.dispatch({ type: 'loading/began', loading: { label, command } })
  try {
    const result = await run()
    if (commandFrom !== undefined) log(deps, commandFrom(result))
    deps.dispatch({ type: 'loading/ended' })
    return result
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
    return null
  }
}

// ─── 조회 ──────────────────────────────────────────────────────────────────

/**
 * 첫 화면. 오버레이 없이 조용히 채운다 — 아직 사람이 기다리고 있는 동작이 아니다.
 *
 * **진행 중인 세션도 함께 묻는다.** 이것이 없으면 브라우저를 새로고침한 순간 측정 중이던
 * 세션이 화면에서 사라지고, 기기는 "다른 탭에서 측정 중" 으로 잠긴 채 그 탭이 존재하지 않는
 * 막다른 길이 된다 (터미널로만 탈출 가능했다).
 */
export async function bootstrap(deps: EffectDeps): Promise<void> {
  try {
    const [env, devices, runs, sessions] = await Promise.all([
      deps.api.env(),
      deps.api.devices(),
      deps.api.runs(),
      deps.api.sessions(),
    ])
    deps.dispatch({ type: 'env/loaded', env })
    deps.dispatch({ type: 'devices/loaded', devices })
    deps.dispatch({ type: 'runs/loaded', runs: runs.runs, incompleteCount: runs.incompleteCount })
    deps.dispatch({ type: 'sessions/loaded', sessions })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * 측정 중일 때 주기적으로 부른다. **기기에 접촉하지 않는다** — 서버가 활성 세션 포인터
 * 파일만 읽으므로 측정에 영향이 없다.
 *
 * 이걸로 세 가지가 한 번에 맞춰진다:
 *   - `perftracker mark` 로 터미널에서 남긴 마킹이 화면에 나타난다
 *   - 터미널에서 `stop` 으로 끝낸 세션의 탭이 접힌다
 *   - 다른 창에서 연 세션이 나타난다
 *
 * 실패는 조용히 넘긴다 — 주기 작업이라 오류 배너를 띄우면 잠깐의 끊김에 화면이 시끄러워진다.
 */
export async function syncSessions(deps: EffectDeps): Promise<void> {
  try {
    deps.dispatch({ type: 'sessions/loaded', sessions: await deps.api.sessions() })
  } catch {
    // 다음 주기에 다시 시도한다.
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

/**
 * 앱을 고르면 그 앱 **하나의** 버전을 읽는다.
 *
 * 오버레이를 띄우지 않는다 — 고르는 동작은 즉시 반응해야 하고, 버전은 늦게 도착해도 되는
 * 부가 정보다. 실패해도 조용히 넘긴다: 버전을 못 읽은 것이 측정을 막을 이유가 없고,
 * 화면은 그때 `-` 를 그린다 (모르는 것을 모른다고 쓰는 자리다).
 */
export async function selectApp(deps: EffectDeps, tabKey: string, serial: string, packageName: string): Promise<void> {
  deps.dispatch({ type: 'tab/patched', key: tabKey, patch: { packageName } })
  try {
    const detail = await deps.api.appDetail(serial, packageName)
    deps.dispatch({ type: 'appVersion/loaded', serial, packageName, versionName: detail.versionName })
  } catch {
    deps.dispatch({ type: 'appVersion/loaded', serial, packageName, versionName: null })
  }
}

// ─── 세션 ──────────────────────────────────────────────────────────────────

export async function startSession(deps: EffectDeps, tab: Tab, outDir: string): Promise<void> {
  if (tab.serial === null || tab.packageName === null) return

  const req: StartRequest = {
    serial: tab.serial,
    packageName: tab.packageName,
    name: tab.name.trim() === '' ? null : tab.name.trim(),
    launch: tab.launch,
    force: tab.force,
  }

  const session = await withLoading(
    deps,
    '세션을 시작하고 트레이스를 켜고 있습니다',
    // 오버레이에는 "무엇을 기다리는지" 만 띄운다. 실제로 실행된 줄은 응답이 알려 준다.
    `perftracker start --app "${req.packageName}" -d ${req.serial} -o ${outDir}`,
    () => deps.api.start(req),
    (s) => s.command,
  )
  if (!session) return

  deps.dispatch({
    type: 'session/started',
    tabKey: tab.key,
    sessionId: session.id,
    name: session.name,
    // 서버가 보내 주는데 화면이 버리던 값이다. 측정 중 화면에 그대로 띄운다.
    unsupported: session.unsupported,
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

  const result = await withLoading(
    deps,
    '트레이스를 회수하고 result.json 을 만들고 있습니다',
    `perftracker stop -d ${tab.serial}`,
    () => deps.api.stop(tab.serial!, { offline: tab.offline }),
    (r) => r.command,
  )

  deps.dispatch({ type: 'session/stopped', tabKey: tab.key, run: result?.run ?? null })
  const devices = await deps.api.devices().catch(() => null)
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

/** 측정 중인 탭을 닫는다 — 기록을 남기지 않고 기기의 Perfetto 세션만 정리한다. */
export async function abortSession(deps: EffectDeps, tab: Tab): Promise<void> {
  if (tab.serial !== null) {
    await withLoading(
      deps,
      '세션을 정리하고 있습니다',
      `perftracker stop -d ${tab.serial}   # 기록을 만들지 않고 버림`,
      () => deps.api.abort(tab.serial!),
    )
  }
  deps.dispatch({ type: 'tab/closed', key: tab.key })
  const devices = await deps.api.devices().catch(() => null)
  if (devices) deps.dispatch({ type: 'devices/loaded', devices })
}

// ─── 마킹 ──────────────────────────────────────────────────────────────────

/**
 * 마킹 하나를 남긴다.
 *
 * **기기에 나가는 명령은 없다.** 서버는 활성 세션 포인터(호스트의 파일)만 고친다 —
 * core 의 `appendMark` 가 `AdbClient` 를 아예 받지 않는 것이 그 보증이다.
 *
 * 왜 브라우저에 들고 있지 않는가: 같은 세션에 `perftracker mark` 로 남긴 마킹과 어긋난다.
 * 정본은 한 곳(포인터 파일)이고 화면은 그 사본을 그린다.
 *
 * 경과는 **서버가 계산한다.** 브라우저 시계로 계산하면 CLI 로 남긴 마킹과 기준이 달라진다.
 */
export async function addMark(deps: EffectDeps, tab: Tab, label: string): Promise<void> {
  const trimmed = label.trim()
  if (trimmed === '' || tab.serial === null) return

  try {
    const marks = await deps.api.addMark(tab.serial, trimmed)
    deps.dispatch({ type: 'marks/loaded', tabKey: tab.key, marks })
    // **경과는 서버가 저장한 값**을 찍는다. 화면의 시계로 찍으면 파일에 들어간 값과 다른
    // 숫자가 로그에 남는다 (같은 사건을 두 번 다르게 적는 셈이다).
    const saved = marks[marks.length - 1]
    if (saved !== undefined) log(deps, `perftracker mark "${saved.label}" @ ${formatElapsed(saved.offsetMs)}`)
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}

/** 마킹 하나를 지운다. 인덱스는 서버가 준 목록의 인덱스다. */
export async function removeMark(deps: EffectDeps, tab: Tab, index: number): Promise<void> {
  if (tab.serial === null) return
  try {
    const marks = await deps.api.removeMark(tab.serial, index)
    deps.dispatch({ type: 'marks/loaded', tabKey: tab.key, marks })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
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
  try {
    const r = await deps.api.clearRuns()
    // 서버가 실제로 지운 내역을 찍는다 — 화면이 "기록 N건" 이라고 지어내지 않는다.
    const what = [r.records > 0 ? `기록 ${r.records}건` : '', r.incomplete > 0 ? `미완성 ${r.incomplete}건` : '']
      .filter(Boolean)
      .join(' + ')
    log(deps, `perftracker runs rm --all --yes   # ${what || '지울 것 없음'}`)
    deps.dispatch({ type: 'runs/cleared' })
  } catch (e) {
    deps.dispatch({ type: 'error/raised', message: e instanceof Error ? e.message : String(e) })
  }
}
