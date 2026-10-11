import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { baseDexLine } from '../app/dexopt.js'
import type { DexoptLine, SessionCompile } from '../schema/result.js'
import { listActiveSessions } from './state.js'

/**
 * `start --compile` 세션의 바꾼 기록 요약 (기능 문서 baseline-profile BP-6 · plan B33) — 바꾼 값 · base.apk 줄
 * (`[primary-abi]` 줄 · `baseDexLine`)의 바꾸기 전 → 뒤 `status` · 걸린 ms. `runs --json` 의 `compile` 과
 * cli `start` · `status` 의 `Compile` 줄이 이 하나에서 나온다. **base 줄을 하나로 못 고르거나 상태를 못 읽었으면
 * null** 이다 — 추측하지 않고 빈 문자열로 채우지 않는다. 판정하지 않는다: 문자열을 그대로 옮긴다.
 */
export interface CompileSummary {
  value: SessionCompile['value']
  baseStatusBefore: string | null
  baseStatusAfter: string | null
  elapsedMs: number
}

/** 바꾼 기록 + 바꾼 뒤 상태(= `target_app.compile_state_start`) → 요약. */
export function summarizeCompile(
  compile: Pick<SessionCompile, 'value' | 'elapsed_ms' | 'compile_state_before'>,
  after: readonly DexoptLine[] | null | undefined,
): CompileSummary {
  return {
    value: compile.value,
    baseStatusBefore: baseDexLine(compile.compile_state_before)?.status ?? null,
    baseStatusAfter: baseDexLine(after)?.status ?? null,
    elapsedMs: compile.elapsed_ms,
  }
}

/**
 * 끝난 세션 하나. `result.json` 이 있으면 그것이 정본이고, 없으면 `session.json` 으로
 * 채운다 — 그 경우 못 잰 지표 수·경고 수는 **셀 수 없으므로 0 이다** (파일이 없다).
 */
export interface RunSummary {
  id: string
  name: string
  runDir: string
  serial: string
  model: string | null
  packageName: string
  appLabel: string
  appVersion: string | null
  /** 세션 시작 시각(ISO). */
  startedAt: string
  durationMs: number
  launch: boolean
  unsupportedCount: number
  warningCount: number
  markCount: number
  /**
   * **진단 세션 기록에만 있고 값은 언제나 true** 다 (plan D12) — `runs --json` 과 기록 드로어가
   * 이것으로 진단 태그를 단다. 평소 기록에는 키가 없다: `false` 를 실으면 평소 기록의 JSON 이
   * 진단 모드 이전과 달라진다. 없음 = 평소 또는 옛 기록 = 둘 다 진단 아님.
   */
  diagnose?: true
  /**
   * **`start --compile` 기록에만 있다** (BP-6 · plan B33) — 진단 태그와 같은 이유로 평소 기록에는 키가 없다.
   * 바꾼 기록은 `result.json` 의 `session.compile` 이 정본이고, 산출이 실패한 run 은 `session.json` 이 말한다.
   * 바꾼 뒤 상태는 `result.json` 의 `target_app.compile_state_start` 에서만 읽는다 — 그 파일이 없는 run 은
   * `baseStatusAfter: null` (capture.json 을 따로 열지 않는다).
   */
  compile?: CompileSummary
}

/**
 * `runs/` 디렉토리를 읽어 기록 목록을 만든다. **기기에 접촉하지 않는다** — 기록은 이미
 * 호스트에 있는 파일이고, 그것을 보려고 기기를 깨울 이유가 없다.
 *
 * **core 에 있는 이유:** CLI 의 `runs` 명령과 GUI 가 둘 다 쓴다. 한동안 GUI 안에만 있었고
 * 그래서 "GUI 로는 지울 수 있는데 CLI 로는 못 지우는" 비대칭이 생겼다 — 그 상태를 두면
 * GUI 가 조금씩 자기만의 로직을 갖게 된다. 같은 파일을 읽는 `extract/run.ts` 의 이웃이다.
 *
 * 정본은 `result.json` 이다. 그것이 없으면(정지는 됐는데 산출이 실패한 run) `session.json`
 * 만으로 최소한을 채우고 **`result.json` 이 없다는 사실을 지운 척하지 않는다** —
 * 그런 run 은 `durationMs: 0` 이 아니라 세션 정보에서 계산한 값을 쓰고, 경고 수는 0 이 아니라
 * 셀 수 없으므로 0 으로 둔 것이 아님을 이름(`warningCount`)이 아니라 이 주석이 말한다.
 */

interface StoredSessionFile {
  id?: string
  name?: string
  serial?: string
  packageName?: string
  startedAt?: string
  endedAt?: string
  runDir?: string
  options?: { launch?: boolean; diagnose?: boolean }
  marks?: unknown[]
  compile?: SessionCompile
}

interface ResultFile {
  session?: {
    id?: string
    name?: string
    started_at?: string
    ended_at?: string | null
    duration_ms?: number | null
    options?: { launch?: boolean; diagnose?: boolean }
    marks?: unknown[]
    compile?: SessionCompile
  }
  device?: { serial?: string; static?: { model?: string } }
  target_app?: {
    package?: string
    label?: string
    version_name?: string | null
    compile_state_start?: DexoptLine[] | null
  }
  metrics?: Record<string, { status?: string } | undefined>
  warnings?: unknown[]
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** 못 잰 지표 수. `status` 가 `unsupported` / `skipped` 인 것만 센다. */
function countUnsupported(metrics: ResultFile['metrics']): number {
  if (metrics === undefined) return 0
  return Object.values(metrics).filter((m) => m?.status === 'unsupported' || m?.status === 'skipped').length
}

export async function listRuns(dir: string): Promise<RunSummary[]> {
  // **절대 경로로 맞춘다.** `-o runs` 처럼 상대 경로로 들어오는데 core 는 `runDir` 을 절대
  // 경로로 돌려준다 — 그대로 두면 정지 직후 방금 만든 기록을 목록에서 못 찾는다 (실측).
  const outDir = resolve(dir)
  let entries: string[]
  try {
    entries = await readdir(outDir)
  } catch {
    // 아직 한 번도 재지 않았으면 디렉토리가 없다. 그것은 오류가 아니라 기록 0건이다.
    return []
  }

  const runs: RunSummary[] = []
  for (const entry of entries) {
    const dir = join(outDir, entry)
    const session = await readJson<StoredSessionFile>(join(dir, 'session.json'))
    if (session === null) continue // run 디렉토리가 아니다

    const result = await readJson<ResultFile>(join(dir, 'result.json'))
    const startedAt = result?.session?.started_at ?? session.startedAt ?? null
    if (startedAt === null) continue

    /**
     * **끝나지 않은 세션은 기록이 아니다.**
     *
     * `start` 가 run 디렉토리를 먼저 만들기 때문에, 그냥 훑으면 **지금 돌고 있는 세션**이
     * `길이 0ms · 경고 0 · 미지원 0` 인 완료된 기록처럼 목록에 뜬다 (실측). 그 0 들은
     * "재 봤더니 없었다" 가 아니라 "아직 안 끝났다" 이고, 그것을 0 으로 적는 것이 정확히
     * 이 저장소가 금지하는 거짓 청정 신호다.
     *
     * 기준은 `endedAt` 이다. `stop` 이 그것을 쓰므로:
     *   - `endedAt` 있음, `result.json` 없음 → 정지는 됐고 산출만 실패. **보여준다**
     *     (사용자가 `extract` 를 돌릴 대상을 찾아야 한다)
     *   - `endedAt` 없음 → 진행 중이거나 `--force` 로 버려진 것. 기록이 아니다
     *     (진행 중인 세션은 측정 중 화면이 이미 보여 주고 있다)
     */
    const endedAt = result?.session?.ended_at ?? session.endedAt ?? null
    if (endedAt === null) continue

    const durationMs =
      result?.session?.duration_ms ?? Date.parse(endedAt) - Date.parse(startedAt)
    const compile = result?.session?.compile ?? session.compile

    runs.push({
      id: result?.session?.id ?? session.id ?? entry,
      name: result?.session?.name ?? session.name ?? entry,
      runDir: dir,
      serial: result?.device?.serial ?? session.serial ?? '',
      model: result?.device?.static?.model ?? null,
      packageName: result?.target_app?.package ?? session.packageName ?? '',
      appLabel: result?.target_app?.label ?? result?.target_app?.package ?? session.packageName ?? '',
      appVersion: result?.target_app?.version_name ?? null,
      startedAt,
      durationMs: Math.max(0, durationMs),
      launch: result?.session?.options?.launch ?? session.options?.launch ?? false,
      unsupportedCount: countUnsupported(result?.metrics),
      warningCount: result?.warnings?.length ?? 0,
      markCount: (result?.session?.marks ?? session.marks ?? []).length,
      // result.json 이 정본이고, 산출이 실패한 run 은 session.json 이 말한다 (`launch` 와 같다).
      ...((result?.session?.options?.diagnose ?? session.options?.diagnose) === true
        ? { diagnose: true as const }
        : {}),
      ...(compile !== undefined
        ? { compile: summarizeCompile(compile, result?.target_app?.compile_state_start ?? null) }
        : {}),
    })
  }

  // 항상 최신순. 화면이 다시 정렬하지 않아도 되게 서버가 정한다.
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * `runs/` 안의 **디렉토리 하나**. 기록이 아닌 것까지 포함한다.
 *
 * `listRuns` 는 "기록" 만 낸다 — 끝난 세션이다. 그런데 지우려면 그것만으로 부족하다:
 * `start` 가 디렉토리를 만든 직후 죽었거나 `--force` 로 밀린 폴더는 목록에 없으니
 * **삭제 대상도 되지 못했고**, 결국 사람이 `rm -rf` 를 직접 쳐야 했다 (실측: `runs rm --all`
 * 이 4개 중 2개만 지웠다).
 */
export interface RunEntry {
  runDir: string
  /**
   * 세션 고유값. `session.json` 이 있으면 거기서 읽는다 — **기록이 아니어도** 읽는다.
   *
   * 요약(`summary`)에만 id 를 두면 진행 중인 세션을 id 로 지목할 수 없다. 그때
   * "측정 중이라 못 지웁니다" 가 아니라 "찾지 못했습니다" 가 나와서, 사람이 멀쩡한 id 를
   * 들고 엉뚱한 곳을 뒤지게 된다 (실측).
   */
  id: string | null
  /** 기록으로 셀 수 있으면 요약. 아니면 null. */
  summary: RunSummary | null
  /**
   * **지금 측정 중인 세션의 폴더인가.** 활성 세션 포인터의 `runDir` 과 같으면 true.
   *
   * 이 구분이 없으면 "전체 지우기" 가 **돌고 있는 세션의 디렉토리를 지운다** — 트레이스가
   * 아직 회수되지 않았고 `stop` 이 그 자리에 쓰려던 참인데 바닥이 사라진다.
   */
  active: boolean
}

/** 이 디렉토리를 이 도구가 만들었다고 볼 근거. 하나라도 있으면 run 디렉토리다. */
const RUN_ARTIFACTS = ['session.json', 'capture.json', 'result.json', 'trace.perfetto-trace', 'raw'] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * `runs/` 안에서 **이 도구가 만든 디렉토리** 전부. 기록이 아닌 것도 낸다.
 *
 * 판별을 디렉토리 **이름**이 아니라 **내용물**로 하는 이유: 이름은 사람이 바꿀 수 있지만
 * `capture.json` · `trace.perfetto-trace` 같은 파일은 이 도구만 만든다. `-o` 로 엉뚱한
 * 디렉토리를 가리켰을 때 무관한 폴더를 지우지 않으려면 근거가 그쪽이어야 한다.
 */
export async function listRunDirs(dir: string, home?: string): Promise<RunEntry[]> {
  const outDir = resolve(dir)
  let entries: string[]
  try {
    entries = await readdir(outDir)
  } catch {
    return []
  }

  const summaries = new Map((await listRuns(outDir)).map((r) => [r.runDir, r]))
  const activeDirs = new Set((await listActiveSessions(home)).map((s) => resolve(s.runDir)))

  const out: RunEntry[] = []
  for (const entry of entries) {
    const runDir = join(outDir, entry)
    const marks = await Promise.all(RUN_ARTIFACTS.map((f) => exists(join(runDir, f))))
    if (!marks.some(Boolean)) continue // 이 도구가 만든 것이 아니다

    const session = await readJson<StoredSessionFile>(join(runDir, 'session.json'))
    out.push({
      runDir,
      id: session?.id ?? null,
      summary: summaries.get(runDir) ?? null,
      active: activeDirs.has(runDir),
    })
  }
  return out.sort((a, b) => b.runDir.localeCompare(a.runDir))
}

export async function findRun(outDir: string, id: string): Promise<RunSummary | null> {
  return (await listRuns(outDir)).find((r) => r.id === id) ?? null
}

/**
 * 이름만 바꾼다. **디렉토리 이름은 건드리지 않는다** — 경로가 바뀌면 이미 그 경로를 적어 둔
 * 사람의 메모와 CLI 로그가 전부 죽는다. 이름은 `session.json` 과 `result.json` 안의 값이다.
 */
export async function renameRun(outDir: string, id: string, name: string): Promise<RunSummary | null> {
  const run = await findRun(outDir, id)
  if (run === null) return null

  const sessionPath = join(run.runDir, 'session.json')
  const session = await readJson<StoredSessionFile>(sessionPath)
  if (session !== null) {
    await writeFile(sessionPath, `${JSON.stringify({ ...session, name }, null, 2)}\n`, 'utf8')
  }

  const resultPath = join(run.runDir, 'result.json')
  const result = await readJson<ResultFile>(resultPath)
  if (result?.session !== undefined) {
    const next = { ...result, session: { ...result.session, name } }
    await writeFile(resultPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }

  return { ...run, name }
}

/** 삭제가 거절된 이유. 조용히 안 지우는 것과 지운 것을 구분한다. */
export type DeleteRefusal = 'not_found' | 'active'

/**
 * 하나 지운다. **`id` 는 기록의 id 이거나 디렉토리 이름**이다 —
 * `session.json` 이 없어 id 자체가 없는 폴더도 지울 수 있어야 한다.
 *
 * 측정 중인 세션의 폴더는 **거절한다.** 그 자리는 `stop` 이 트레이스를 회수해 쓸 곳이고,
 * 지우면 진행 중인 측정을 조용히 못 쓰게 만든다.
 */
export async function deleteRun(
  outDir: string,
  id: string,
  home?: string,
): Promise<{ deleted: true; runDir: string } | { deleted: false; reason: DeleteRefusal }> {
  const entries = await listRunDirs(outDir, home)
  // id 는 세 가지로 지목할 수 있다: 기록 id · 진행 중인 세션의 id · 디렉토리 이름.
  // 마지막 하나가 있어야 `session.json` 조차 없는 폴더도 지울 수 있다.
  const target = entries.find(
    (e) => e.summary?.id === id || e.id === id || e.runDir.split('/').pop() === id,
  )
  if (target === undefined) return { deleted: false, reason: 'not_found' }
  if (target.active) return { deleted: false, reason: 'active' }

  await rm(target.runDir, { recursive: true, force: true })
  return { deleted: true, runDir: target.runDir }
}

/**
 * **이 디렉토리의 run 산출물을 전부 지운다** — 기록뿐 아니라 정지되지 않은 것,
 * `session.json` 이 없는 것까지. "전체 지우기" 가 전체를 못 지우면 그것은 전체가 아니다.
 *
 * 측정 중인 세션의 폴더만 남긴다. 그 사실을 반환값으로 알려 부르는 쪽이 사람에게 말할 수 있게 한다.
 */
export async function clearRuns(
  outDir: string,
  home?: string,
): Promise<{ removed: number; records: number; incomplete: number; skippedActive: number }> {
  const entries = await listRunDirs(outDir, home)
  let records = 0
  let incomplete = 0
  let skippedActive = 0

  for (const entry of entries) {
    if (entry.active) {
      skippedActive += 1
      continue
    }
    if (entry.summary !== null) records += 1
    else incomplete += 1
    await rm(entry.runDir, { recursive: true, force: true })
  }
  return { removed: records + incomplete, records, incomplete, skippedActive }
}
