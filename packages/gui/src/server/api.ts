import { rm } from 'node:fs/promises'
import {
  appendMark,
  createAdbContext,
  createBaseAdb,
  clearRuns,
  deleteRun,
  extractRun,
  getAppDetail,
  listRuns,
  listDeviceSummaries,
  loadLabeledApps,
  PerfTrackerError,
  listActiveSessions,
  readActiveSession,
  removeMark,
  renameRun,
  resolveTargetApp,
  runDoctor,
  SessionStateError,
  sortedMarks,
  startSession,
  stopSession,
  beginStart,
} from '@perftracker/core'
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
} from '../contract/api.js'
import { abortCommandLine, startCommandLine, stopCommandLine } from './command.js'
import { toAppView, toDeviceView, toDoctorView, toMetricViews, toRunView } from './view.js'

/**
 * GUI 서버가 하는 일 전부. **CLI 의 로직을 다시 쓰지 않고 core 를 그대로 부른다** —
 * 판정이 두 곳에 있으면 CLI 와 GUI 가 서로 다른 답을 내는 날이 온다.
 *
 * 규칙 1 은 여기서도 그대로다: 측정 중인 기기에는 아무것도 보내지 않는다.
 * `listDeviceSummaries` 가 진행 중인 기기의 스펙 조회를 건너뛰고, 마킹은 호스트의 파일만
 * 고친다 (`@perftracker/core` 의 `session/marks.ts`).
 */

export interface GuiOptions {
  /** `--adb` 로 넘어온 경로. 없으면 core 의 탐색 사슬이 찾는다. */
  adb?: string | undefined
  /** 결과를 저장할 디렉토리. CLI 의 `-o` 와 같은 뜻이다. */
  outDir: string
  version: string
}

export class GuiApi {
  constructor(private readonly opts: GuiOptions) {}

  env(): EnvView {
    try {
      const { located } = createBaseAdb({ adb: this.opts.adb })
      return { version: this.opts.version, adbPath: located.path, outDir: this.opts.outDir }
    } catch {
      // adb 를 못 찾은 것은 화면이 알아야 할 사실이다. 서버가 죽을 이유는 아니다.
      return { version: this.opts.version, adbPath: null, outDir: this.opts.outDir }
    }
  }

  /**
   * 진행 중인 세션 전부. **기기에 접촉하지 않는다** — 활성 세션 포인터 파일만 읽는다.
   * 그래서 측정 중에 몇 초마다 불러도 규칙 1 을 깨지 않는다.
   *
   * GUI 가 연 세션과 CLI 가 연 세션을 구분하지 않는다. 같은 파일이 정본이기 때문이다.
   */
  async sessions(): Promise<ActiveSessionView[]> {
    return (await listActiveSessions()).map((s) => ({
      id: s.id,
      name: s.name,
      serial: s.serial,
      packageName: s.packageName,
      runDir: s.runDir,
      startedAt: s.startedAt,
      launch: s.options.launch,
      marks: sortedMarks(s).map((m) => ({ offsetMs: m.offsetMs, label: m.label })),
      unsupported: s.unsupported ?? [],
    }))
  }

  async doctor(serial: string | null): Promise<DoctorCheckView[]> {
    return toDoctorView(await runDoctor({ adb: this.opts.adb, ...(serial !== null ? { device: serial } : {}) }))
  }

  /**
   * 기기 목록 + 기기별 지표 판정.
   *
   * 지표 판정을 얻으려면 기기마다 `doctor` 를 한 번씩 돌려야 한다 — 비싸 보이지만 이것이
   * **판정의 출처를 하나로 유지하는 값**이다. 화면이 SDK 표를 들고 스스로 판단하면 그 표가
   * core 와 어긋나는 날 "된다고 했는데 안 되는" 상태가 생긴다.
   *
   * 측정 중인 기기는 건너뛴다: `doctor` 자체가 진행 중이면 프로브를 안 하고, 그 결과
   * 지표 항목이 하나도 없어 `metrics` 는 빈 배열이 된다 — "전부 가능" 이 아니라 "모른다" 다.
   */
  async devices(): Promise<DeviceView[]> {
    const summaries = await listDeviceSummaries({ adb: this.opts.adb })
    const views: DeviceView[] = []
    for (const summary of summaries) {
      const checks =
        summary.state === 'device' && !summary.measurementInProgress
          ? await runDoctor({ adb: this.opts.adb, device: summary.serial })
          : []
      views.push(toDeviceView(summary, toMetricViews(checks)))
    }
    return views
  }

  async apps(serial: string): Promise<AppView[]> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    return (await loadLabeledApps(ctx)).map(toAppView)
  }

  /**
   * 고른 앱 하나의 버전. **목록 전체에는 절대 돌리지 않는다** — core 의 `getAppDetail` 이
   * 주석으로 그렇게 못 박고 있고, 설치된 앱 수만큼 adb 왕복이 생긴다.
   */
  async appDetail(serial: string, packageName: string): Promise<AppDetailView> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const detail = await getAppDetail(ctx.adb, packageName)
    return { packageName, versionName: detail.versionName }
  }

  async start(req: StartRequest): Promise<StartedSessionView> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: req.serial })
    await beginStart(ctx, { force: req.force })

    const app = await resolveTargetApp(ctx, req.packageName)
    const now = new Date()
    const session = await startSession(ctx, app, {
      ...(req.name !== null ? { name: req.name } : {}),
      launch: req.launch,
      // 저장 위치는 서버만 정한다 — 브라우저가 보내던 값을 없앤 이유는 계약의 주석에 있다.
      outDir: this.opts.outDir,
      force: req.force,
      now,
    })

    return {
      id: session.id,
      name: session.name,
      serial: req.serial,
      runDir: session.runDir,
      startedAt: session.startedAt,
      unsupported: session.unsupported ?? [],
      command: startCommandLine(req, this.opts.outDir),
    }
  }

  /** 측정 중 마킹 하나. **기기에 나가는 명령이 없다** — 포인터 파일만 고친다. */
  async addMark(serial: string, label: string): Promise<MarkView[]> {
    const session = await readActiveSession(serial)
    if (session === null) throw new SessionStateError(`기기 ${serial} 에 진행 중인 세션이 없습니다.`)
    await appendMark(session, label, new Date())
    return this.marks(serial)
  }

  async removeMark(serial: string, index: number): Promise<MarkView[]> {
    await removeMark(serial, index)
    return this.marks(serial)
  }

  async marks(serial: string): Promise<MarkView[]> {
    const session = await readActiveSession(serial)
    if (session === null) return []
    return sortedMarks(session).map((m) => ({ offsetMs: m.offsetMs, label: m.label }))
  }

  /**
   * 정지 → 회수 → 산출. CLI 의 `stop` 과 **같은 순서, 같은 실패 처리**다.
   * 원본을 회수한 뒤 산출이 실패하면 run 디렉토리를 알려 준다 — 원본은 이미 안전하다.
   */
  async stop(serial: string, req: StopRequest): Promise<StopResult> {
    const session = await readActiveSession(serial)
    if (session === null) throw new SessionStateError(`기기 ${serial} 에 실행 중인 세션이 없습니다.`)

    // 마킹은 이미 포인터에 쌓여 있다 (`addMark` 가 그때그때 썼다). stopSession 이 포인터를
    // 그대로 run 디렉토리의 session.json 으로 옮기므로 여기서 따로 할 일이 없다.
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const { runDir } = await stopSession(ctx, session, new Date())

    try {
      await extractRun(runDir, { offline: req.offline })
    } catch (e) {
      throw new SessionStateError(
        `원본은 회수했지만 result.json 산출에 실패했습니다.\n` +
          `  run 디렉토리  ${runDir}\n` +
          `perftracker extract ${runDir} 로 언제든 다시 산출할 수 있습니다.\n\n` +
          `원인: ${(e as Error).message}`,
      )
    }

    const run = (await listRuns(this.opts.outDir)).find((r) => r.runDir === runDir)
    if (run === undefined) {
      throw new SessionStateError(`기록을 만들었지만 목록에서 찾지 못했습니다: ${runDir}`)
    }
    return { run: toRunView(run), command: stopCommandLine(serial, req.offline) }
  }

  /**
   * 측정 중인 세션을 기록 없이 버린다.
   * `stop` 을 부르되 산출하지 않고 run 디렉토리를 지운다 — **기기의 Perfetto 세션을 반드시
   * 정리해야** 다음 측정이 남은 세션에 걸리지 않는다.
   */
  async abort(serial: string): Promise<void> {
    const session = await readActiveSession(serial)
    if (session === null) return

    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const { runDir } = await stopSession(ctx, session, new Date())
    await rm(runDir, { recursive: true, force: true })
  }

  async runs(): Promise<RunView[]> {
    return (await listRuns(this.opts.outDir)).map(toRunView)
  }

  /** 측정 중인 세션을 버릴 때 화면이 찍을 줄. 실행한 쪽이 적는다. */
  abortCommand(serial: string): string {
    return abortCommandLine(serial)
  }

  async renameRun(id: string, name: string): Promise<RunView> {
    const run = await renameRun(this.opts.outDir, id, name)
    if (run === null) throw new SessionStateError(`기록 ${id} 을(를) 찾지 못했습니다.`)
    return toRunView(run)
  }

  async deleteRun(id: string): Promise<void> {
    if (!(await deleteRun(this.opts.outDir, id))) {
      throw new SessionStateError(`기록 ${id} 을(를) 찾지 못했습니다.`)
    }
  }

  async clearRuns(): Promise<void> {
    await clearRuns(this.opts.outDir)
  }
}

/** 화면에 그대로 올릴 한국어 문장으로 바꾼다. core 의 오류는 이미 그런 문장이다. */
export function toErrorMessage(e: unknown): string {
  if (e instanceof PerfTrackerError) return e.message
  return e instanceof Error ? e.message : String(e)
}
