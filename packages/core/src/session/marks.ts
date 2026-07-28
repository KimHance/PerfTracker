import { SessionStateError } from '../errors.js'
import { type ActiveSession, listActiveSessions, readActiveSession, writeActiveSession } from './state.js'

/**
 * 측정 중 사람이 남기는 마킹.
 *
 * **저장소는 활성 세션 포인터(`~/.perftracker/active/{serial}.json`) 하나다.** CLI 의
 * `mark` 명령과 GUI 가 같은 자리에 쓰고, `stop` 이 그것을 run 디렉토리의 `session.json` 으로
 * 옮기면 `extract` 가 `result.json` 의 `session.marks[]` 로 낸다.
 *
 * **여기서 기기에 나가는 명령은 하나도 없다.** 마킹은 호스트의 파일 작업일 뿐이라
 * 측정 창 안에서 불려도 규칙 1 을 깨지 않는다 — 그것이 마킹이 가능한 이유이기도 하다.
 * `AdbClient` 를 인자로 받지 않는 것은 실수가 아니라 이 함수가 지키는 계약이다.
 */

export interface SessionMark {
  /** 세션 시작으로부터의 경과(ms). 절대 시각이 아닌 것은 시계열과 같은 축에 놓기 위해서다. */
  offsetMs: number
  label: string
}

/**
 * 어느 세션에 남길 것인가.
 *
 * 셋 다 비어 있으면 **활성 세션이 정확히 하나일 때만** 성공한다. 둘 이상인데 아무것도
 * 고르지 않았으면 묻는다 — 마킹이 엉뚱한 세션에 붙는 것은 조용히 틀린 데이터를 만드는 일이고,
 * 그 세션의 result.json 을 열어 보기 전에는 아무도 눈치채지 못한다.
 */
export interface MarkTarget {
  /** 세션 고유값(`session.id`). 같은 기기에서 여러 번 잰 기록과도 헷갈리지 않는 유일한 값이다. */
  sessionId?: string | undefined
  serial?: string | undefined
  home?: string | undefined
}

export async function resolveMarkSession(target: MarkTarget): Promise<ActiveSession> {
  if (target.sessionId !== undefined && target.sessionId !== '') {
    const sessions = await listActiveSessions(target.home)
    const found = sessions.filter((s) => s.id === target.sessionId)
    if (found.length === 1) return found[0]!
    if (found.length === 0) {
      throw new SessionStateError(
        `세션 ${target.sessionId} 을(를) 찾지 못했습니다.\n` +
          `perftracker status 로 진행 중인 세션을 확인하세요.`,
      )
    }
    // 세션 id 는 6자리 hex 라 이론상 충돌할 수 있다. 충돌을 조용히 고르지 않는다.
    throw new SessionStateError(
      `세션 ${target.sessionId} 이(가) 여러 기기에서 발견됐습니다: ${found.map((s) => s.serial).join(', ')}\n` +
        `-d 로 기기를 지정하세요.`,
    )
  }

  if (target.serial !== undefined && target.serial !== '') {
    const session = await readActiveSession(target.serial, target.home)
    if (session === null) {
      throw new SessionStateError(`기기 ${target.serial} 에 진행 중인 세션이 없습니다.`)
    }
    return session
  }

  const sessions = await listActiveSessions(target.home)
  if (sessions.length === 1) return sessions[0]!
  if (sessions.length === 0) {
    throw new SessionStateError(
      '진행 중인 세션이 없습니다. 마킹은 측정 중에만 남길 수 있습니다.\n' +
        'perftracker start 로 먼저 세션을 여세요.',
    )
  }
  throw new SessionStateError(
    `진행 중인 세션이 ${sessions.length}개입니다. 어디에 남길지 지정하세요:\n` +
      sessions.map((s) => `  --session ${s.id}   (${s.serial}  ${s.name})`).join('\n'),
  )
}

/**
 * 마킹 하나를 세션에 붙인다. 경과는 **저장된 `startedAt` 기준**으로 여기서 계산한다 —
 * 부르는 쪽이 계산해 넘기면 CLI 와 GUI 가 서로 다른 기준(브라우저 시계 등)을 쓰게 된다.
 */
export async function appendMark(
  session: ActiveSession,
  label: string,
  now: Date,
  home?: string,
): Promise<{ mark: SessionMark; total: number }> {
  const trimmed = label.trim()
  if (trimmed === '') throw new SessionStateError('마킹 이름이 비어 있습니다.')

  const offsetMs = Math.max(0, now.getTime() - Date.parse(session.startedAt))
  const mark: SessionMark = { offsetMs, label: trimmed }

  // 포인터를 다시 읽는다 — 그 사이 다른 프로세스(GUI 서버, 다른 터미널)가 마킹을 붙였을 수
  // 있고, 인자로 받은 사본을 그대로 쓰면 그것을 덮어쓴다.
  const current = (await readActiveSession(session.serial, home)) ?? session
  const marks = [...(current.marks ?? []), mark]
  await writeActiveSession({ ...current, marks }, home)
  return { mark, total: marks.length }
}

/** 마킹 하나를 지운다. 지운 것을 돌려주고, 범위 밖이면 null 이다. */
export async function removeMark(
  serial: string,
  index: number,
  home?: string,
): Promise<SessionMark | null> {
  const current = await readActiveSession(serial, home)
  if (current === null) return null

  const marks = [...(current.marks ?? [])]
  const [removed] = marks.splice(index, 1)
  if (removed === undefined) return null

  await writeActiveSession({ ...current, marks }, home)
  return removed
}

/** 시간순으로 정렬한 사본. 저장 순서와 무관하게 읽는 쪽은 항상 시간순을 본다. */
export function sortedMarks(session: ActiveSession): SessionMark[] {
  return [...(session.marks ?? [])].sort((a, b) => a.offsetMs - b.offsetMs)
}
