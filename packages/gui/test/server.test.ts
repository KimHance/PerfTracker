import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative as relativePath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveSessionView,
  ApiErrorBody,
  EnvView,
  ReportDocument,
  RunsView,
  StartRequest,
} from '../src/contract/api.js'
import { diagnoseNotice, listRuns, renameRun } from '@perftracker/core'
import { startOptions } from '../src/server/api.js'
import { startGuiServer, type GuiServer } from '../src/server/index.js'
import { toDiagnoseView, toStartedSessionView } from '../src/server/view.js'

/**
 * 서버는 실제로 띄운다 — 라우팅·정적 서빙·오류 형식은 함수를 직접 불러서는 확인되지 않는다.
 * 기기를 요구하는 경로(devices / start / stop)는 여기서 부르지 않는다: 그것은
 * `packages/cli/test/on-device/` 의 몫이고, 유닛에서 기기를 흉내 내면 흉내를 검증하게 된다.
 */

let server: GuiServer
let out: string

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'perftracker-runs-'))
  server = await startGuiServer({ outDir: out })
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
  it('버전은 gui 의 package.json 값이다 — 부르는 쪽이 넘기지 않는다', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const res = await fetch(`${server.url}/api/env`)

    expect(res.status).toBe(200)
    expect(((await res.json()) as EnvView).version).toBe(pkg.version)
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

/**
 * **진단 세션은 진단일 때만 칸이 생긴다.** 평소 세션 · 기록의 뷰는 진단 모드 이전과 키가 같다 —
 * core 가 `session.json` · `result.json` 에 진단 키를 진단 세션에만 싣는 것(plan D12)과 같은 원칙이다.
 * 진단 세션을 여는 경로(`start`)는 기기가 필요해 여기서 부르지 않고, 요청 → core 옵션을
 * 순수 함수(`startOptions`)로 본다.
 */
describe('진단 세션', () => {
  /** 이 칸들이 생기기 전의 뷰 모양. 평소 세션 · 기록은 이것과 키까지 같아야 한다. */
  const RUN_VIEW_KEYS = [
    'appLabel', 'appVersion', 'at', 'durationMs', 'id', 'launch', 'markCount', 'model', 'name',
    'packageName', 'runDir', 'serial', 'unsupportedCount', 'warningCount',
  ]
  const SESSION_VIEW_KEYS = [
    'id', 'launch', 'marks', 'name', 'packageName', 'runDir', 'serial', 'startedAt', 'unsupported',
  ]

  const req: StartRequest = {
    serial: 'S1',
    packageName: 'com.google.android.youtube',
    name: null,
    launch: true,
    force: false,
  }
  const now = new Date('2026-10-08T03:00:00.000Z')

  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'perftracker-home-'))
    vi.stubEnv('PERFTRACKER_HOME', home)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** 활성 세션 포인터 — `start` 가 `~/.perftracker/active/<serial>.json` 에 쓰는 것과 같은 모양. */
  async function writePointer(serial: string, extra: Record<string, unknown>): Promise<void> {
    await mkdir(join(home, 'active'), { recursive: true })
    await writeFile(
      join(home, 'active', `${serial}.json`),
      JSON.stringify({
        version: 1,
        id: `id-${serial}`,
        name: `세션 ${serial}`,
        serial,
        packageName: 'com.google.android.youtube',
        runDir: join(out, serial),
        perfettoKey: 'k',
        remoteTracePath: '/data/misc/perfetto-traces/x',
        startedAt: '2026-10-08T03:00:00.000Z',
        configuredDurationMs: 1_800_000,
        options: { launch: true },
        startup: null,
        marks: [],
        ...extra,
      }),
      'utf8',
    )
  }

  /** 끝난 run 하나 — `session.json` + `result.json`. */
  async function writeFinishedRun(dir: string, id: string, result: Record<string, unknown>): Promise<void> {
    await writeSession(dir, { id, name: id, startedAt: '2026-10-08T03:00:00', endedAt: '2026-10-08T03:00:16' })
    await writeFile(join(out, dir, 'result.json'), JSON.stringify(result), 'utf8')
  }

  it('DM-2 진단 토글 → 시작 요청 — 켜면 core 에 diagnose: true 가 간다', () => {
    expect(startOptions({ ...req, diagnose: true }, 'runs', now)).toEqual({
      launch: true,
      outDir: 'runs',
      force: false,
      now,
      diagnose: true,
    })
  })

  it('DM-2 진단 토글 → 시작 요청 — 끄면 core 로 가는 옵션이 이 칸이 없던 때와 키까지 같다', () => {
    const opts = startOptions(req, 'runs', now)

    expect(opts).toEqual({ launch: true, outDir: 'runs', force: false, now })
    expect(Object.keys(opts)).not.toContain('diagnose')
    expect(startOptions({ ...req, name: '홈 스크롤' }, 'runs', now)).toEqual({
      name: '홈 스크롤',
      launch: true,
      outDir: 'runs',
      force: false,
      now,
    })
  })

  it('DM-2 진단 토글 → 시작 요청 — 요청 본문의 true 만 믿는다 (false · 문자열은 평소 세션)', () => {
    // 본문은 브라우저가 보낸 JSON 이다 — 타입은 `true` 하나지만 서버는 그것을 믿을 수 없다.
    for (const stray of [false, 'true', 1, null]) {
      const opts = startOptions({ ...req, diagnose: stray as never }, 'runs', now)
      expect(Object.keys(opts)).not.toContain('diagnose')
    }
  })

  it('DM-6 진단 기록에만 diagnose — 평소 기록의 뷰는 키가 그대로다', async () => {
    await writeFinishedRun('diag', 'diag1', { session: { id: 'diag1', options: { launch: true, diagnose: true } } })
    await writeFinishedRun('plain', 'plain1', { session: { id: 'plain1', options: { launch: true } } })

    const { runs } = (await (await fetch(`${server.url}/api/runs`)).json()) as RunsView
    const diag = runs.find((r) => r.id === 'diag1')!
    const plain = runs.find((r) => r.id === 'plain1')!

    expect(diag.diagnose).toBe(true)
    expect(Object.keys(diag).sort()).toEqual([...RUN_VIEW_KEYS, 'diagnose'].sort())
    expect(Object.keys(plain).sort()).toEqual(RUN_VIEW_KEYS)
  })

  it('DM-6 진단 세션에만 diagnose — 평소 세션의 뷰는 키가 그대로고 core 의 범위 칸을 흘리지 않는다', async () => {
    await writePointer('DIAG', {
      configuredDurationMs: 600_000,
      options: { launch: true, diagnose: true },
      diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: ['com.google.android.youtube'], notice: null },
    })
    await writePointer('PLAIN', {})

    const sessions = (await (await fetch(`${server.url}/api/sessions`)).json()) as ActiveSessionView[]
    const diag = sessions.find((s) => s.serial === 'DIAG')!
    const plain = sessions.find((s) => s.serial === 'PLAIN')!

    // 화면이 쓰는 것은 진단 여부와 고지뿐이다 — core 의 `atraceCategories` 를 그대로 싣지 않는다 (규칙 4).
    expect(diag.diagnose).toEqual({ notice: null })
    expect(Object.keys(diag).sort()).toEqual([...SESSION_VIEW_KEYS, 'diagnose'].sort())
    expect(Object.keys(plain).sort()).toEqual(SESSION_VIEW_KEYS)
  })

  it('DM-10 running 고지 필드 — 모름 칸이면 core 의 고지 줄 그대로, 열리면 null', async () => {
    const notice = diagnoseNotice(30, false)
    expect(notice).not.toBeNull()
    await writePointer('SDK30', {
      options: { launch: true, diagnose: true },
      diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: ['com.x'], notice },
    })
    await writePointer('SDK36', {
      options: { launch: true, diagnose: true },
      diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: ['com.x'], notice: diagnoseNotice(36, false) },
    })

    const sessions = (await (await fetch(`${server.url}/api/sessions`)).json()) as ActiveSessionView[]

    expect(sessions.find((s) => s.serial === 'SDK30')!.diagnose).toEqual({ notice })
    expect(sessions.find((s) => s.serial === 'SDK36')!.diagnose).toEqual({ notice: null })
  })

  it('DM-10 running 고지 필드 — 진단 여부는 options.diagnose 가 정한다', () => {
    const block = { atraceCategories: [], atraceApps: [], notice: '앱 slice 열림 모름 — sdk 30 · debuggable 모름' }

    expect(toDiagnoseView({ options: { launch: false, diagnose: true }, diagnose: block })).toEqual({
      notice: block.notice,
    })
    expect(toDiagnoseView({ options: { launch: true } })).toBeUndefined()
    // 정본은 `options.diagnose` 다 (core 의 `listRuns` · `extract` 와 같은 기준) — 블록만 있다고 진단이 아니다.
    expect(toDiagnoseView({ options: { launch: true }, diagnose: block })).toBeUndefined()
  })

  it('DM-10 running 고지 필드 — 시작 응답도 진단 세션에만 고지 칸을 싣고, 평소 응답은 키가 그대로다', async () => {
    // 시작 응답과 세션 목록이 같은 번역을 지난다 — 둘이 다르면 새로고침 전후로 표시가 바뀐다.
    // 기기가 필요한 `start` 대신 core 가 돌려준 세션(포인터와 같은 모양)을 그대로 넣는다.
    const notice = diagnoseNotice(30, null)
    await writePointer('DIAG', {
      options: { launch: true, diagnose: true },
      diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: ['com.x'], notice },
    })
    await writePointer('PLAIN', {})
    const [diag, plain] = await Promise.all(
      ['DIAG', 'PLAIN'].map(async (serial) => JSON.parse(await readFile(join(home, 'active', `${serial}.json`), 'utf8'))),
    )

    expect(toStartedSessionView(diag, 'DIAG', 'perftracker start --diagnose …').diagnose).toEqual({ notice })
    expect(Object.keys(toStartedSessionView(plain, 'PLAIN', 'perftracker start …')).sort()).toEqual(
      ['command', 'id', 'name', 'runDir', 'serial', 'startedAt', 'unsupported'].sort(),
    )
  })

  it('DM-6 보고서는 진단 블록을 그대로 싣는다 — 평소 보고서엔 없다', async () => {
    // 보고서의 입력은 `result.json` 그대로다 (계약의 `ReportDocument`). 진단 블록이 서버를
    // 지나며 하나라도 바뀌면 보고서와 파일이 다른 숫자를 말한다.
    const diagnose = {
      atrace_categories: ['am', 'wm', 'view'],
      atrace_apps: ['com.google.android.youtube'],
      status: 'partial',
      reason_code: 'process_name_stale_in_trace',
      reason: '이름 낡음',
      app_slices_open: null,
      app_slices_open_reason_code: 'app_slices_open_unknown',
      app_slices_open_reason: 'sdk 30 · debuggable 아님 · profileable 읽을 출처 없음',
      trace_slices: 131_610,
      target_process_slices: null,
      ftrace_overrun_events: 0,
      trace_bytes: 12_614_058,
      target_process_slice_names: [
        { name: 'Choreographer#doFrame *', main_thread: { count: 3, sum_ms: 12.5, max_ms: 6.25 }, other_threads: null, async_tracks: null },
      ],
    }
    const diagResult = { schema_version: '1.2.0', session: { id: 'diag1', options: { launch: true, diagnose: true } }, diagnose }
    const plainResult = { schema_version: '1.2.0', session: { id: 'plain1', options: { launch: true } } }
    await writeFinishedRun('diag', 'diag1', diagResult)
    await writeFinishedRun('plain', 'plain1', plainResult)

    const diag = (await (await fetch(`${server.url}/api/runs/diag1/report`)).json()) as ReportDocument
    const plain = (await (await fetch(`${server.url}/api/runs/plain1/report`)).json()) as ReportDocument

    expect(diag).toEqual(diagResult)
    expect(plain).toEqual(plainResult)
    expect(Object.keys(plain)).not.toContain('diagnose')
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
