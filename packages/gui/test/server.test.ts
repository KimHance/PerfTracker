import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative as relativePath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiErrorBody, EnvView, RunsView } from '../src/contract/api.js'
import { listRuns, renameRun } from '@perftracker/core'
import { startGuiServer, type GuiServer } from '../src/server/index.js'

/**
 * 서버는 실제로 띄운다 — 라우팅·정적 서빙·오류 형식은 함수를 직접 불러서는 확인되지 않는다.
 * 기기를 요구하는 경로(devices / start / stop)는 여기서 부르지 않는다: 그것은
 * `packages/cli/test/on-device/` 의 몫이고, 유닛에서 기기를 흉내 내면 흉내를 검증하게 된다.
 */

let server: GuiServer
let out: string

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'perftracker-runs-'))
  server = await startGuiServer({ outDir: out, version: '9.9.9' })
})

afterEach(async () => {
  await server.close()
})

/** 현재 작업 디렉토리 기준의 상대 경로. CLI 가 `-o runs` 로 넘기는 것과 같은 모양이다. */
function relativeTo(absolute: string): string {
  return relativePath(process.cwd(), absolute)
}

/** 끝난 run — `stop` 이 `endedAt` 을 쓴 상태. */
async function makeRun(dir: string, id: string, at: string, name = id): Promise<void> {
  await writeSession(dir, { id, name, startedAt: at, endedAt: at })
}

/** 아직 끝나지 않은 run — `start` 가 디렉토리만 만든 상태. */
async function makeRunningRun(dir: string, id: string, at: string): Promise<void> {
  await writeSession(dir, { id, name: id, startedAt: at })
}

async function writeSession(dir: string, extra: Record<string, unknown>): Promise<void> {
  const runDir = join(out, dir)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    join(runDir, 'session.json'),
    JSON.stringify({ version: 1, serial: 'S1', packageName: 'com.x', ...extra }),
    'utf8',
  )
}

describe('환경', () => {
  it('버전을 그대로 낸다', async () => {
    const res = await fetch(`${server.url}/api/env`)

    expect(res.status).toBe(200)
    expect(((await res.json()) as EnvView).version).toBe('9.9.9')
  })
})

describe('기록', () => {
  it('한 번도 재지 않았으면 0건이다 (오류가 아니다)', async () => {
    const res = await fetch(`${server.url}/api/runs`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [], incompleteCount: 0, activeCount: 0 })
  })

  it('항상 최신순으로 낸다', async () => {
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')
    await makeRun('b', 'bbb', '2026-07-27T12:00:00')
    await makeRun('c', 'ccc', '2026-07-27T11:00:00')

    const { runs } = (await (await fetch(`${server.url}/api/runs`)).json()) as RunsView

    expect(runs.map((r) => r.id)).toEqual(['bbb', 'ccc', 'aaa'])
  })

  it('정지는 됐는데 산출이 실패한 run 은 감추지 않는다', async () => {
    // 목록에서 사라지면 사용자가 extract 를 돌릴 대상을 찾지 못한다.
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')

    const { runs } = (await (await fetch(`${server.url}/api/runs`)).json()) as RunsView

    expect(runs).toHaveLength(1)
    expect(runs[0]!.markCount).toBe(0)
  })

  it('아직 끝나지 않은 세션은 기록이 아니다', async () => {
    /**
     * `start` 가 run 디렉토리를 먼저 만들기 때문에, 그냥 훑으면 **지금 돌고 있는 세션**이
     * `길이 0ms · 경고 0` 인 완료된 기록처럼 목록에 뜬다 (실기기에서 실제로 그랬다).
     * 그 0 들은 "재 봤더니 없었다" 가 아니라 "아직 안 끝났다" 이고, 그것을 0 으로 적는 것이
     * 이 저장소가 금지하는 거짓 청정 신호다.
     */
    await makeRunningRun('running', 'run1', '2026-07-27T10:00:00')
    await makeRun('done', 'done1', '2026-07-27T09:00:00')

    const { runs } = (await (await fetch(`${server.url}/api/runs`)).json()) as RunsView

    expect(runs.map((r) => r.id)).toEqual(['done1'])
  })

  it('이름을 바꿔도 디렉토리 경로는 그대로다', async () => {
    // 경로가 바뀌면 이미 그 경로를 적어 둔 메모와 CLI 로그가 전부 죽는다.
    await makeRun('20260727_100000_옛이름_aaa', 'aaa', '2026-07-27T10:00:00', '옛 이름')
    const before = (await listRuns(out))[0]!

    const res = await fetch(`${server.url}/api/runs/aaa`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '새 이름' }),
    })

    expect(res.status).toBe(200)
    const after = (await listRuns(out))[0]!
    expect(after.name).toBe('새 이름')
    expect(after.runDir).toBe(before.runDir)
  })

  it('없는 기록을 지우려 하면 조용히 성공하지 않는다', async () => {
    const res = await fetch(`${server.url}/api/runs/없음`, { method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(((await res.json()) as ApiErrorBody).message).toContain('찾지 못했습니다')
  })

  it('삭제는 디렉토리째 지운다', async () => {
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')

    expect((await fetch(`${server.url}/api/runs/aaa`, { method: 'DELETE' })).status).toBe(204)
    expect(await listRuns(out)).toEqual([])
  })

  it('전체 지우기는 기록과 미완성을 함께 지우고 내역을 돌려준다', async () => {
    /**
     * **내역을 돌려주는 것이 계약이다.** 예전에는 라우트가 결과를 버리고 204(내용 없음)를
     * 냈고, 화면이 `records` 를 읽다가 `Cannot read properties of undefined` 로 터졌다
     * (실측). 무엇을 지웠는지는 화면이 사람에게 말해야 할 내용이다.
     */
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')
    await makeRun('b', 'bbb', '2026-07-27T11:00:00')
    await makeRunningRun('c', 'ccc', '2026-07-27T12:00:00')

    const res = await fetch(`${server.url}/api/runs`, { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ records: 2, incomplete: 1, skippedActive: 0 })
    expect(await listRuns(out)).toEqual([])
  })

  it('목록이 미완성 폴더 수를 함께 낸다', async () => {
    // 다이얼로그가 "기록 N건" 이라고 하면서 N+M 개를 지우면 그 문장이 거짓이 된다.
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')
    await makeRunningRun('b', 'bbb', '2026-07-27T11:00:00')

    const view = (await (await fetch(`${server.url}/api/runs`)).json()) as RunsView

    expect(view.runs).toHaveLength(1)
    expect(view.incompleteCount).toBe(1)
  })

  it('상대 경로로 준 outDir 도 절대 경로 runDir 과 맞는다', async () => {
    /**
     * 실기기에서 잡은 결함이다: CLI 는 `-o runs` 처럼 **상대 경로**를 넘기는데 core 의
     * `startSession` 은 `runDir` 을 **절대 경로**로 돌려준다. 문자열로 비교하면 정지 직후
     * 방금 만든 기록을 목록에서 못 찾고, 측정은 성공했는데 화면에는 실패로 보인다.
     */
    await makeRun('a', 'aaa', '2026-07-27T10:00:00')
    const relative = relativeTo(out)

    const runs = await listRuns(relative)

    expect(runs).toHaveLength(1)
    expect(isAbsolute(runs[0]!.runDir)).toBe(true)
  })

  it('이름 변경 대상이 없으면 null 이다', async () => {
    expect(await renameRun(out, '없음', 'x')).toBeNull()
  })
})

describe('실패 형식', () => {
  it('모르는 경로는 계약대로 message 를 낸다', async () => {
    const res = await fetch(`${server.url}/api/없는것`)

    expect(res.status).toBe(404)
    expect(typeof ((await res.json()) as ApiErrorBody).message).toBe('string')
  })

  it('메서드가 다르면 처리하지 않는다', async () => {
    expect((await fetch(`${server.url}/api/env`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('정적 서빙', () => {
  it('웹 루트 밖의 파일은 내주지 않는다', async () => {
    /**
     * 이 서버는 사용자의 홈에서 돌기 때문에 "무엇을 내주지 않는가" 가 중요하다.
     *
     * `../` 를 URL 에 넣는 고전적인 시도는 여기까지 오지 못한다 — `new URL()` 이 세그먼트를
     * 먼저 정규화해서 서버는 `/etc/passwd` 같은 **평평한** 경로만 본다. 그래서 실제로 확인할
     * 것은 그 평평한 경로가 웹 루트 밖으로 나가지 않는가다: 저장소 루트의 `package.json` 은
     * `dist-web/` 안에 없으므로 절대 나와서는 안 된다.
     */
    const res = await fetch(`${server.url}/package.json`)
    const text = await res.text()

    expect(text).not.toContain('perftracker-monorepo')
  })

  it('화면이 빌드되지 않았으면 그렇게 말한다', async () => {
    // dist-web 이 있으면 index.html 이 돌아오고, 없으면 404 + 안내다. 어느 쪽이든
    // "빈 페이지" 는 아니다 — 사용자가 원인을 알 수 있어야 한다.
    const res = await fetch(`${server.url}/`)
    const text = await res.text()

    expect(res.status === 200 || text.includes('빌드')).toBe(true)
  })
})

describe('바인딩', () => {
  it('127.0.0.1 에만 붙는다', () => {
    // 이 서버는 붙어 있는 기기에 adb 를 보내고 파일을 지울 수 있다.
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})
