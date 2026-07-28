import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
  options?: { launch?: boolean }
  marks?: unknown[]
}

interface ResultFile {
  session?: {
    id?: string
    name?: string
    started_at?: string
    ended_at?: string | null
    duration_ms?: number | null
    options?: { launch?: boolean }
    marks?: unknown[]
  }
  device?: { serial?: string; static?: { model?: string } }
  target_app?: { package?: string; label?: string; version_name?: string | null }
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
    })
  }

  // 항상 최신순. 화면이 다시 정렬하지 않아도 되게 서버가 정한다.
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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

export async function deleteRun(outDir: string, id: string): Promise<boolean> {
  const run = await findRun(outDir, id)
  if (run === null) return false
  await rm(run.runDir, { recursive: true, force: true })
  return true
}

export async function clearRuns(outDir: string): Promise<number> {
  const runs = await listRuns(outDir)
  for (const run of runs) await rm(run.runDir, { recursive: true, force: true })
  return runs.length
}
