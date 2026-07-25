import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { perfTrackerHome } from './paths.js'

export interface ActiveSession {
  version: 1
  id: string
  name: string
  serial: string
  packageName: string
  runDir: string
  perfettoKey: string
  remoteTracePath: string
  startedAt: string
  configuredDurationMs: number
  options: { launch: boolean; video: boolean }
  startup: { totalTimeMs: number | null; launchState: string | null } | null
}

export function newSessionId(rng: () => Buffer = () => randomBytes(3)): string {
  return rng().toString('hex')
}

/** 기기 하나당 활성 세션 하나. 서로 다른 기기끼리는 병렬 세션이 가능하다. */
export function activePointerPath(serial: string, home: string = perfTrackerHome()): string {
  return join(home, 'active', `${serial}.json`)
}

export async function writeActiveSession(
  session: ActiveSession,
  home: string = perfTrackerHome(),
): Promise<void> {
  const file = activePointerPath(session.serial, home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

export async function readActiveSession(
  serial: string,
  home: string = perfTrackerHome(),
): Promise<ActiveSession | null> {
  try {
    return JSON.parse(await readFile(activePointerPath(serial, home), 'utf8')) as ActiveSession
  } catch {
    return null
  }
}

export async function clearActiveSession(serial: string, home: string = perfTrackerHome()): Promise<void> {
  await rm(activePointerPath(serial, home), { force: true })
}

/**
 * 기기에 전혀 접촉하지 않고 `~/.perftracker/active/` 를 그대로 연다.
 * 디렉토리가 없거나 비어 있으면 빈 배열이다. 포인터는 버려도 되는 데이터라는 원칙대로,
 * 읽을 수 없거나 JSON 이 깨진 파일은 조용히 건너뛴다.
 */
export async function listActiveSessions(home: string = perfTrackerHome()): Promise<ActiveSession[]> {
  const dir = join(home, 'active')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const sessions: ActiveSession[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      sessions.push(JSON.parse(await readFile(join(dir, entry), 'utf8')) as ActiveSession)
    } catch {
      // 깨진 포인터는 버려도 되는 데이터 — 조용히 건너뛴다.
    }
  }
  return sessions.sort((a, b) => a.serial.localeCompare(b.serial))
}

/** run 디렉토리 안의 session.json 이 정본이다. 활성 포인터는 그 사본에 불과하다. */
export async function writeRunSession(
  runDir: string,
  session: ActiveSession,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'session.json'), `${JSON.stringify({ ...session, ...extra }, null, 2)}\n`, 'utf8')
}
