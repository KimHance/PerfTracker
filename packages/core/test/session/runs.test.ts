import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteRun, listRuns, renameRun } from '../../src/session/runs.js'

/**
 * 기록 읽기는 **core 의 일이다.** CLI 의 `runs` 명령과 GUI 가 둘 다 부른다 —
 * 한동안 GUI 안에만 있어서 "GUI 로는 지울 수 있는데 CLI 로는 못 지우는" 비대칭이 있었다.
 */

let out: string

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'perftracker-runs-core-'))
})

async function write(dir: string, extra: Record<string, unknown>): Promise<void> {
  const runDir = join(out, dir)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    join(runDir, 'session.json'),
    JSON.stringify({ version: 1, serial: 'S1', packageName: 'com.x', ...extra }),
    'utf8',
  )
}

/** 끝난 세션 — `stop` 이 `endedAt` 을 쓴 상태. */
const done = (dir: string, id: string, at: string, endedAt = at): Promise<void> =>
  write(dir, { id, name: id, startedAt: at, endedAt })

describe('목록', () => {
  it('한 번도 재지 않았으면 0건이다 (오류가 아니다)', async () => {
    expect(await listRuns(join(out, '없는곳'))).toEqual([])
  })

  it('항상 최신순이다', async () => {
    await done('a', 'aaa', '2026-07-27T10:00:00')
    await done('b', 'bbb', '2026-07-27T12:00:00')
    await done('c', 'ccc', '2026-07-27T11:00:00')

    expect((await listRuns(out)).map((r) => r.id)).toEqual(['bbb', 'ccc', 'aaa'])
  })

  it('아직 끝나지 않은 세션은 기록이 아니다', async () => {
    /**
     * `start` 가 run 디렉토리를 먼저 만들기 때문에, 그냥 훑으면 **지금 돌고 있는 세션**이
     * `길이 0ms · 경고 0` 인 완료된 기록처럼 목록에 뜬다. 그 0 들은 "재 봤더니 없었다" 가
     * 아니라 "아직 안 끝났다" 이고, 그것이 이 저장소가 금지하는 거짓 청정 신호다.
     */
    await write('running', { id: 'run1', name: 'run1', startedAt: '2026-07-27T10:00:00' })
    await done('done', 'done1', '2026-07-27T09:00:00')

    expect((await listRuns(out)).map((r) => r.id)).toEqual(['done1'])
  })

  it('정지는 됐는데 산출이 실패한 run 은 감추지 않는다', async () => {
    // 목록에서 사라지면 사용자가 extract 를 돌릴 대상을 찾지 못한다.
    await done('a', 'aaa', '2026-07-27T10:00:00', '2026-07-27T10:00:30')
    const [run] = await listRuns(out)

    expect(run!.durationMs).toBe(30_000)
    expect(run!.markCount).toBe(0)
  })

  it('상대 경로로 줘도 절대 경로 runDir 을 낸다', async () => {
    /**
     * CLI 는 `-o runs` 처럼 상대 경로를 넘기는데 `startSession` 은 `runDir` 을 절대 경로로
     * 돌려준다. 문자열로 비교하면 정지 직후 방금 만든 기록을 못 찾는다 (실기기에서 잡았다).
     */
    await done('a', 'aaa', '2026-07-27T10:00:00')

    const runs = await listRuns(relative(process.cwd(), out))

    expect(runs).toHaveLength(1)
    expect(isAbsolute(runs[0]!.runDir)).toBe(true)
  })

  it('run 디렉토리가 아닌 것은 건너뛴다', async () => {
    await mkdir(join(out, '그냥폴더'), { recursive: true })
    await done('a', 'aaa', '2026-07-27T10:00:00')

    expect(await listRuns(out)).toHaveLength(1)
  })
})

describe('이름 변경', () => {
  it('디렉토리 경로는 그대로 둔다', async () => {
    // 경로가 바뀌면 이미 그 경로를 적어 둔 메모와 CLI 로그가 전부 죽는다.
    await done('20260727_100000_옛이름_aaa', 'aaa', '2026-07-27T10:00:00')
    const before = (await listRuns(out))[0]!

    const renamed = await renameRun(out, 'aaa', '새 이름')

    expect(renamed!.name).toBe('새 이름')
    expect(renamed!.runDir).toBe(before.runDir)
    expect((await listRuns(out))[0]!.name).toBe('새 이름')
  })

  it('없는 기록이면 null 이다', async () => {
    expect(await renameRun(out, '없음', 'x')).toBeNull()
  })
})

describe('삭제', () => {
  it('디렉토리째 지운다', async () => {
    await done('a', 'aaa', '2026-07-27T10:00:00')

    expect(await deleteRun(out, 'aaa')).toBe(true)
    expect(await listRuns(out)).toEqual([])
  })

  it('없는 기록이면 지웠다고 하지 않는다', async () => {
    expect(await deleteRun(out, '없음')).toBe(false)
  })
})
