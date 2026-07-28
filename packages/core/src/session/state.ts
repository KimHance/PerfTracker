import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AmStartResult } from '../collectors/types.js'
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
  options: { launch: boolean }
  startup: AmStartResult | null
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
  /**
   * **이 기기에서 잴 수 없는 지표와 그 이유.** 세션은 정상적으로 열렸고, 다만 일부 지표가
   * 이 기기에서 나오지 않는다는 사실이다.
   *
   * 왜 시작 시점에 알려야 하는가: 예전에는 이것을 `stop` 뒤 `result.json` 을 열어야 알 수
   * 있었다. 사람이 30초 동안 앱을 조작하고 나서야 "프레임이 안 잡혔다" 를 아는 것은
   * **측정을 한 번 더 하게 만드는 정보**이고, 그것은 시작 전에 알 수 있었던 사실이다
   * (실측: SM-A405S / Android 11 에서 frame·network 둘 다 원리적으로 불가).
   *
   * 값이 하나도 없으면 빈 배열이다 — 이 필드가 없던 시절의 `session.json` 과 구분된다.
   */
  unsupported?: { id: string; reason: string }[]
  /**
   * 측정 중 사람이 남긴 마킹. **`stop` 이 이것을 `session.json` 에 쓰고 `extract` 가 읽는다.**
   *
   * 왜 세션 포인터가 아니라 여기(run 디렉토리의 session.json)에 실리는가: 마킹은 측정 창이
   * 닫힌 뒤에야 도착한다 (측정 중에는 GUI 가 브라우저 안에만 들고 있다 — 규칙 1).
   * CLI 세션은 마킹을 남길 경로가 없어 항상 비어 있다.
   */
  marks?: { offsetMs: number; label: string }[]
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
