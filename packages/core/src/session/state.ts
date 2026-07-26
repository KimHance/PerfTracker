import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
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
  /**
   * `am start -W` 직후 `pidof` 가 알려 준 앱 프로세스의 pid. `--launch` 없이 시작했거나
   * `pidof` 가 답하지 못했으면 null.
   *
   * optional 인 것은 이 필드가 없던 시절의 `session.json` 을 그대로 읽기 위해서다 —
   * 필드 추가는 형식 버전을 올릴 이유가 아니다 (옛 run 디렉토리는 여전히 version 1 이다).
   */
  appPid?: number | null
  /**
   * 측정 창이 열려 있는 동안 차단된 adb 호출 수.
   * 창은 프로세스 메모리 안에 있고 `start` 와 `stop` 은 서로 다른 프로세스이므로,
   * 세션 전체의 위반 횟수는 여기(포인터 파일)에 누적해야 한다.
   */
  adbCommandsDuringSession?: number
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
 * 측정 창 위반 하나를 포인터에 기록한다.
 *
 * 동기 fs 를 쓰는 것은 의도적이다 — 이 함수는 `MeasurementWindowViolationError` 를 던지기
 * 직전에 불리고, 그 예외가 프로세스를 끝내는 것이 정상 흐름이다. await 를 걸 자리가 없다.
 * 포인터가 이미 사라졌으면 기록할 곳이 없지만 위반 자체는 예외로 이미 차단됐다.
 */
export function recordAdbViolation(serial: string, home: string = perfTrackerHome()): void {
  const file = activePointerPath(serial, home)
  try {
    const session = JSON.parse(readFileSync(file, 'utf8')) as ActiveSession
    session.adbCommandsDuringSession = (session.adbCommandsDuringSession ?? 0) + 1
    writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  } catch {
    // 기록에 실패해도 차단 자체는 이미 일어났다.
  }
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
