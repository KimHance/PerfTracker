import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearRuns, deleteRun, listRunDirs, listRuns, renameRun } from '../../src/session/runs.js'
import { writeActiveSession } from '../../src/session/state.js'

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

/**
 * 기록 목록의 진단 태그 (DM-11 · 드로어 메타 줄이 읽는 자리). 진단 세션 기록에만 `diagnose: true`
 * 이고 평소 기록에는 키가 없다 (plan D12) — `runs --json` 의 평소 행이 진단 모드 이전과 같다.
 */
describe('진단 태그', () => {
  it('runs 진단 태그 — 진단 기록에만 diagnose: true · 평소 기록엔 키가 없다', async () => {
    await write('d', {
      id: 'ddd',
      name: 'ddd',
      startedAt: '2026-10-08T10:00:00',
      endedAt: '2026-10-08T10:00:30',
      options: { launch: true, diagnose: true },
    })
    await write('n', {
      id: 'nnn',
      name: 'nnn',
      startedAt: '2026-10-08T09:00:00',
      endedAt: '2026-10-08T09:00:30',
      options: { launch: true },
    })

    const [diag, normal] = await listRuns(out)
    expect(diag!.diagnose).toBe(true)
    expect(Object.keys(normal!)).not.toContain('diagnose')
  })

  /**
   * 갈래가 둘이라 경우도 둘이다 (코드 검수 #3). 예전 시험은 session.json 갈래만 있어서
   * result.json 쪽 읽기를 지워도 그린이었다 — 이름이 말하는 "result.json 이 정본" 을 못 지켰다.
   */
  it('runs 진단 태그 — result.json 이 있으면 그것이 정본이고, 진단 키가 없으면 session.json 을 본다', async () => {
    const result = (id: string, options: Record<string, unknown>) =>
      JSON.stringify({ session: { id, started_at: '2026-10-08T10:00:00', ended_at: '2026-10-08T10:00:30', options } })

    // result.json 에만 진단 키 — session.json 은 모른다 (산출이 그 키를 더한 뒤의 run).
    await write('r', { id: 'rrr', name: 'rrr', startedAt: '2026-10-08T10:00:00', endedAt: '2026-10-08T10:00:30', options: { launch: true } })
    await writeFile(join(out, 'r', 'result.json'), result('rrr', { launch: true, diagnose: true }), 'utf8')
    // result.json 에 진단 키가 없음 — session.json 이 말한다.
    await write('s', { id: 'sss', name: 'sss', startedAt: '2026-10-08T09:00:00', endedAt: '2026-10-08T09:00:30', options: { launch: true, diagnose: true } })
    await writeFile(join(out, 's', 'result.json'), result('sss', { launch: true }), 'utf8')
    // 둘 다 없음 — 평소 기록.
    await write('n', { id: 'nnn', name: 'nnn', startedAt: '2026-10-08T08:00:00', endedAt: '2026-10-08T08:00:30', options: { launch: true } })
    await writeFile(join(out, 'n', 'result.json'), result('nnn', { launch: true }), 'utf8')

    const byId = new Map((await listRuns(out)).map((r) => [r.id, r]))
    expect(byId.get('rrr')!.diagnose).toBe(true)
    expect(byId.get('sss')!.diagnose).toBe(true)
    expect(Object.keys(byId.get('nnn')!)).not.toContain('diagnose')
  })
})

/**
 * 기록 목록의 바꾼 기록 요약 (baseline-profile BP-6 · plan B33) — `start --compile` 기록에만 `compile` 이고 평소
 * 기록에는 키가 없다 (진단 태그와 같은 이유). `result.json` 이 정본, 산출이 실패한 run 은 `session.json` 이 말한다.
 */
describe('BP-6 runs 바꾼 기록', () => {
  const BASE = '/data/app/~~x==/com.x-y==/base.apk'
  const dex = (status: string, over: Record<string, unknown> = {}) => ({
    path: BASE,
    secondary_dex: false,
    public_dex: false,
    abi: 'arm64',
    status,
    reason: 'cmdline',
    location: null,
    primary_abi: true,
    ...over,
  })
  const compile = {
    value: 'speed',
    command: "cmd package compile -m speed -f 'com.x'",
    elapsed_ms: 67_500,
    compile_state_before: [dex('speed-profile'), dex('verify', { path: '/data/user/0/com.x/a.jar', secondary_dex: true })],
    compile_state_before_reason_code: null,
    compile_state_before_reason: null,
  }
  const at = { startedAt: '2026-10-11T10:00:00', endedAt: '2026-10-11T10:00:30' }
  const result = (id: string, extra: Record<string, unknown> = {}, after: unknown = [dex('speed')]) =>
    JSON.stringify({
      session: { id, started_at: at.startedAt, ended_at: at.endedAt, ...extra },
      target_app: { package: 'com.x', compile_state_start: after },
    })

  it('BP-6 --json 은 compile 세션에만 — result.json 의 바꾼 기록 · 시작 상태로 base 줄 전 → 후', async () => {
    await write('c', { id: 'ccc', name: 'ccc', ...at })
    await writeFile(join(out, 'c', 'result.json'), result('ccc', { compile }), 'utf8')
    await write('n', { id: 'nnn', name: 'nnn', ...at })
    await writeFile(join(out, 'n', 'result.json'), result('nnn'), 'utf8')

    const byId = new Map((await listRuns(out)).map((r) => [r.id, r]))
    expect(byId.get('ccc')!.compile).toEqual({
      value: 'speed',
      baseStatusBefore: 'speed-profile',
      baseStatusAfter: 'speed',
      elapsedMs: 67_500,
    })
    expect(Object.keys(byId.get('nnn')!)).not.toContain('compile')
  })

  it('BP-6 --json 은 compile 세션에만 — 산출이 실패한 run 은 session.json 의 기록 · 뒤는 null (추측 0)', async () => {
    await write('s', { id: 'sss', name: 'sss', ...at, compile })
    const [run] = await listRuns(out)
    expect(run!.compile).toEqual({ value: 'speed', baseStatusBefore: 'speed-profile', baseStatusAfter: null, elapsedMs: 67_500 })
  })

  it('BP-6 --json 은 compile 세션에만 — 상태를 못 읽었거나 base 줄을 하나로 못 고르면 null', async () => {
    const ambiguous = [dex('speed', { primary_abi: false }), dex('verify', { abi: 'arm', primary_abi: false })]
    await write('u', { id: 'uuu', name: 'uuu', ...at })
    await writeFile(
      join(out, 'u', 'result.json'),
      result('uuu', { compile: { ...compile, compile_state_before: null } }, ambiguous),
      'utf8',
    )
    const [run] = await listRuns(out)
    expect(run!.compile).toEqual({ value: 'speed', baseStatusBefore: null, baseStatusAfter: null, elapsedMs: 67_500 })
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

    expect((await deleteRun(out, 'aaa')).deleted).toBe(true)
    expect(await listRuns(out)).toEqual([])
  })

  it('없는 기록이면 지웠다고 하지 않는다', async () => {
    expect(await deleteRun(out, '없음')).toEqual({ deleted: false, reason: 'not_found' })
  })

  it('기록이 아닌 폴더도 디렉토리 이름으로 지울 수 있다', async () => {
    /**
     * `start` 가 죽어 `session.json` 조차 없는 폴더는 id 가 없다. 그래도 지울 수 있어야 한다 —
     * 예전에는 목록에 없으니 삭제 대상도 못 됐고, 사람이 `rm -rf` 를 직접 쳐야 했다.
     */
    await mkdir(join(out, '깨진폴더'), { recursive: true })
    await writeFile(join(out, '깨진폴더', 'capture.json'), '{}', 'utf8')

    expect((await deleteRun(out, '깨진폴더')).deleted).toBe(true)
    expect(await listRunDirs(out)).toEqual([])
  })
})

describe('run 폴더 판별', () => {
  it('이 도구가 만든 흔적이 있는 폴더만 센다', async () => {
    // 이름이 아니라 내용물로 가른다 — `-o` 로 엉뚱한 곳을 가리켰을 때 남의 폴더를 지우지 않는다.
    await done('진짜', 'aaa', '2026-07-27T10:00:00')
    await mkdir(join(out, '남의폴더'), { recursive: true })
    await writeFile(join(out, '남의폴더', 'memo.txt'), 'hi', 'utf8')

    const dirs = await listRunDirs(out)

    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.runDir.endsWith('진짜')).toBe(true)
  })

  it('session.json 이 없어도 run 산출물이 있으면 센다', async () => {
    await mkdir(join(out, '깨진'), { recursive: true })
    await writeFile(join(out, '깨진', 'trace.perfetto-trace'), 'x', 'utf8')

    const dirs = await listRunDirs(out)

    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.summary).toBeNull()
  })
})

describe('측정 중인 세션 보호', () => {
  /**
   * 진행 중인 세션의 폴더는 `stop` 이 트레이스를 회수해 쓸 자리다. 지우면 돌고 있는 측정을
   * 조용히 못 쓰게 만든다 — "전체 지우기" 가 그걸 하면 안 된다.
   */
  async function withActive(): Promise<{ home: string; runDir: string; id: string }> {
    const home = await mkdtemp(join(tmpdir(), 'perftracker-home-'))
    const runDir = join(out, '도는중')
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'session.json'), JSON.stringify({ version: 1, id: 'live1' }), 'utf8')
    await writeActiveSession(
      {
        version: 1,
        id: 'live1',
        name: '도는 중',
        serial: 'S1',
        packageName: 'com.x',
        runDir,
        perfettoKey: 'k',
        remoteTracePath: '/x',
        startedAt: '2026-07-28T10:00:00.000Z',
        configuredDurationMs: 600_000,
        options: { launch: false },
        startup: null,
      },
      home,
    )
    return { home, runDir, id: 'live1' }
  }

  it('전체 지우기가 측정 중인 폴더를 남긴다', async () => {
    const { home } = await withActive()
    await done('끝난것', 'aaa', '2026-07-27T10:00:00')

    const r = await clearRuns(out, home)

    expect(r).toMatchObject({ records: 1, skippedActive: 1 })
    expect((await listRunDirs(out, home)).map((e) => e.active)).toEqual([true])
  })

  it('id 로 지목해도 거절하고, 그 이유를 말한다', async () => {
    // "찾지 못했습니다" 로 답하면 멀쩡한 id 를 든 사람이 엉뚱한 곳을 뒤진다.
    const { home, id } = await withActive()

    expect(await deleteRun(out, id, home)).toEqual({ deleted: false, reason: 'active' })
  })
})

describe('전체 지우기', () => {
  it('기록과 미완성을 함께 지우고 내역을 낸다', async () => {
    await done('끝난것', 'aaa', '2026-07-27T10:00:00')
    await write('안끝난것', { id: 'bbb', name: 'bbb', startedAt: '2026-07-27T11:00:00' })
    await mkdir(join(out, '깨진것'), { recursive: true })
    await writeFile(join(out, '깨진것', 'capture.json'), '{}', 'utf8')

    const r = await clearRuns(out)

    expect(r).toEqual({ removed: 3, records: 1, incomplete: 2, skippedActive: 0 })
    expect(await listRunDirs(out)).toEqual([])
  })
})
