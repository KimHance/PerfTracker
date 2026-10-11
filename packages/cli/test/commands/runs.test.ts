import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listRuns } from '@perftracker/core'
import { displayWidth, padDisplay, runRunsList, runRunsRemove, runRunsRename } from '../../src/commands/runs.js'
import { DIAGNOSE_CLI_COPY } from '../../src/copy/diagnose.js'
import { buildProgram } from '../../src/program.js'

let out: string

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'perftracker-cli-runs-'))
})

async function done(dir: string, id: string, name: string, at: string): Promise<void> {
  const runDir = join(out, dir)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    join(runDir, 'session.json'),
    JSON.stringify({ version: 1, id, name, serial: 'S1', packageName: 'com.x', startedAt: at, endedAt: at }),
    'utf8',
  )
}

describe('표시 폭', () => {
  it('한글은 두 칸으로 센다', () => {
    // padEnd 는 글자 수로 세기 때문에 이것을 모르면 한글 이름이 섞인 목록의 열이 전부 밀린다.
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('클린업')).toBe(6)
    expect(displayWidth('동시-A11')).toBe(8) // 동시=4 + '-A11'=4
  })

  it('서로 다른 이름이 같은 칸에서 끝난다', () => {
    expect(displayWidth(padDisplay('클린업 검증', 20))).toBe(20)
    expect(displayWidth(padDisplay('동시-A11', 20))).toBe(20)
  })

  it('넘치는 이름은 자르지 않는다', () => {
    // 잘라서 이름을 망가뜨리느니 줄이 밀리는 편이 낫다 — 이름은 사람이 지은 것이다.
    expect(padDisplay('아주아주긴이름입니다정말로', 4)).toBe('아주아주긴이름입니다정말로')
  })
})

describe('목록', () => {
  it('0건은 오류가 아니라 안내다', async () => {
    const text = await runRunsList({ out })

    expect(text).toContain('기록이 없습니다')
    expect(text).toContain(out)
  })

  it('id 와 이름과 건수를 낸다', async () => {
    await done('a', 'eb6d24', '클린업 검증', '2026-07-27T18:05:39')

    const text = await runRunsList({ out })

    expect(text).toContain('eb6d24')
    expect(text).toContain('클린업 검증')
    expect(text).toContain('1건')
  })
})

describe('이름 변경', () => {
  it('바꾼 이름과 경로를 알려 준다', async () => {
    await done('a', 'aaa', '옛 이름', '2026-07-27T10:00:00')

    const text = await runRunsRename('aaa', '새 이름', { out })

    expect(text).toContain('새 이름')
    expect((await listRuns(out))[0]!.name).toBe('새 이름')
  })

  it('없는 기록이면 어디서 못 찾았는지 말한다', async () => {
    await expect(runRunsRename('없음', 'x', { out })).rejects.toThrow(out)
  })
})

describe('삭제', () => {
  it('id 를 적었으면 묻지 않고 지운다', async () => {
    // id 를 직접 적은 것이 그 자체로 의사 표시다.
    await done('a', 'aaa', 'A', '2026-07-27T10:00:00')

    await runRunsRemove('aaa', { out, all: false, yes: false })

    expect(await listRuns(out)).toEqual([])
  })

  it('--all 은 --yes 없이는 거부한다', async () => {
    /**
     * 한 번의 오타로 전부 잃는 명령이다. 되묻지 않고 **거부**하는 이유는 CI 때문이다 —
     * 입력을 기다리면 빌드가 타임아웃까지 매달린다.
     */
    await done('a', 'aaa', 'A', '2026-07-27T10:00:00')
    await done('b', 'bbb', 'B', '2026-07-27T11:00:00')

    await expect(runRunsRemove(undefined, { out, all: true, yes: false })).rejects.toThrow(/2건[\s\S]*--yes/)
    // 거부했으면 하나도 지워지지 않아야 한다.
    expect(await listRuns(out)).toHaveLength(2)
  })

  it('--all --yes 는 전부 지운다', async () => {
    await done('a', 'aaa', 'A', '2026-07-27T10:00:00')
    await done('b', 'bbb', 'B', '2026-07-27T11:00:00')

    const text = await runRunsRemove(undefined, { out, all: true, yes: true })

    expect(text).toContain('2건')
    expect(await listRuns(out)).toEqual([])
  })

  it('지울 것이 없으면 --yes 없이도 조용히 끝난다', async () => {
    expect(await runRunsRemove(undefined, { out, all: true, yes: false })).toContain('지울 것이 없습니다')
  })

  it('id 도 --all 도 없으면 무엇을 해야 하는지 말한다', async () => {
    await expect(runRunsRemove(undefined, { out, all: false, yes: false })).rejects.toThrow(/id|--all/)
  })
})

/** 끝난 기록 하나 — `session.json` 만 (산출 전). 진단 세션이면 core 가 쓰는 `options.diagnose` 를 싣는다. */
async function stored(
  dir: string,
  fields: { id: string; name: string; at: string; diagnose?: true; marks?: number },
): Promise<void> {
  const runDir = join(out, dir)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    join(runDir, 'session.json'),
    JSON.stringify({
      version: 1,
      id: fields.id,
      name: fields.name,
      serial: 'S1',
      packageName: 'com.google.android.youtube',
      startedAt: fields.at,
      endedAt: fields.at,
      options: fields.diagnose === true ? { launch: true, diagnose: true } : { launch: true },
      marks: Array.from({ length: fields.marks ?? 0 }, (_, i) => ({ offsetMs: i * 1000, label: `m${i}` })),
    }),
    'utf8',
  )
}

describe('DM-11 runs 태그 · --json', () => {
  it('DM-11 runs 태그 · --json — 진단 기록 행 꼬리 맨 끝에 진단 · 평소 기록엔 없다', async () => {
    await stored('a', { id: 'a1b2c3', name: '유튜브 진단', at: '2026-10-08T00:29:11', diagnose: true })
    await stored('b', { id: '9f8e7d', name: '유튜브 평소', at: '2026-10-08T00:25:00' })
    await stored('c', { id: 'b7c8d9', name: '스크롤 진단', at: '2026-10-07T23:10:00', diagnose: true, marks: 4 })

    const rows = (await runRunsList({ out })).split('\n')
    const row = (id: string): string => rows.find((r) => r.startsWith(id)) ?? ''

    expect(row('a1b2c3').endsWith(`경고 0 · ${DIAGNOSE_CLI_COPY.runsTag}`)).toBe(true)
    expect(row('9f8e7d').endsWith('경고 0')).toBe(true)
    expect(row('9f8e7d')).not.toContain(DIAGNOSE_CLI_COPY.runsTag)
    // 기존 꼬리 뒤에 붙는다 — 기존 꼬리의 순서 · 문구는 그대로 (디자인 시안 cli 블록 7).
    expect(row('b7c8d9').endsWith(`경고 0 · 마킹 4 · ${DIAGNOSE_CLI_COPY.runsTag}`)).toBe(true)
  })

  /**
   * 80칸 기준 (plan D20 · 디자인 재검토 #5): `경고 N` 만 있는 행 + 진단. 이름 20칸 · 모델 12칸을
   * 꽉 채운 행이 77칸이다. 기존 꼬리(`미지원` · `마킹`)로 이미 넘치는 행은 기준이 아니다.
   */
  it('DM-11 runs 태그 · --json — 경고 N 만 있는 행에 진단을 붙여도 80칸 안', async () => {
    await stored('a', { id: 'd4e5f6', name: '가나다라마바사아자차', at: '2026-10-08T00:41:02', diagnose: true })

    const row = (await runRunsList({ out })).split('\n')[0]!

    expect(row.endsWith(`경고 0 · ${DIAGNOSE_CLI_COPY.runsTag}`)).toBe(true)
    expect(displayWidth(row)).toBe(77)
  })

  it('DM-11 runs 태그 · --json — runs --json 은 진단 기록에만 diagnose: true · 평소 기록엔 키가 없다', async () => {
    await stored('a', { id: 'a1b2c3', name: '유튜브 진단', at: '2026-10-08T00:29:11', diagnose: true })
    await stored('b', { id: '9f8e7d', name: '유튜브 평소', at: '2026-10-08T00:25:00' })

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let printed: Record<string, unknown>[]
    try {
      await buildProgram().parseAsync(['--json', 'runs', '-o', out], { from: 'user' })
      printed = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    } finally {
      log.mockRestore()
    }

    const byId = new Map(printed.map((r) => [r['id'], r]))
    expect(byId.get('a1b2c3')?.['diagnose']).toBe(true)
    expect(Object.keys(byId.get('9f8e7d') ?? {})).not.toContain('diagnose')
    expect(byId.size).toBe(2)
  })
})
