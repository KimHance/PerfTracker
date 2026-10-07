import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type ActiveSession,
  appSliceOpen,
  compareCodeUnits,
  createAdbContext,
  type DiagnoseBlock,
  ensureTraceProcessor,
  extractRun,
  readActiveSession,
  type Result,
  TraceProcessor,
} from '@perftracker/core'
// 보고서 행 모델은 gui exports(`.` = 서버 진입점) 밖이다 — 상대 경로로 읽는다 (cli → gui · 규칙 4 안).
import { MANIFEST, type SliceTableBlock } from '../../../gui/src/web/report/manifest.js'
import { buildSliceTable, type SliceTableVm } from '../../../gui/src/web/report/slices.js'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'
import { DIAGNOSE_CLI_COPY } from '../../src/copy/diagnose.js'
import { type DeviceCapability, deviceCapabilities, DEVICE_OPTS, DEVICE_TARGET_APP } from './target.js'

/**
 * **진단 세션을 실기기에서 한 바퀴** (기능 문서 diagnostic-mode DM-16 · DM-5).
 *
 * `start --launch --diagnose` → 스와이프 4회 → `stop` 을 실제로 돌리고, 그 `result.json` · 원본 ·
 * 보고서 행 모델 · 끝난 뒤의 기기 속성을 본다. 같은 조건의 평소 세션 1회도 돌려 진단 관련 키가 없는지 본다.
 *
 * **스와이프는 perftracker 를 거치지 않는다.** 기능 문서 결정 2 가 허용한 시나리오 입력이고, 사람이
 * 다른 터미널에서 `adb shell input swipe` 를 치는 것과 같다 — 그래서 `AdbClient` 가 아니라 adb 를
 * 직접 부른다. `AdbClient` 로 보내면 측정 창 래치가 막는다 (규칙 1 — 막는 것이 옳다).
 * `adb_commands_during_session` 은 도구가 창 안에서 낸 명령 수라 이 입력과 무관하게 0 이어야 한다.
 *
 * **못 재는 기기에서 실패시키지 않는다** (cli/AGENTS.md). 기기가 갈리는 자리는 core 의 판정을 그대로 쓴다:
 * `linux.ftrace` 등록 여부(`deviceCapabilities`) · 앱 slice 열림(`appSliceOpen`) · frametimeline(`frame` 지원).
 * `RV Scroll`(androidx RecyclerView 가 남기는 **앱** slice)은 앱 slice 가 열리고 대상 앱이 YouTube 일 때만
 * 본다 — 그 행이 있어야 하는 것은 기능 문서 DM-16 의 앱(YouTube · 결정 2)에 대한 사실이다.
 */

/** 기능 문서 DM-16 · 결정 2 의 앱. */
const DM16_APP = 'com.google.android.youtube'

/** 스와이프 사이 간격 — 스크롤이 멈춘 뒤 다음 입력이 가도록. */
const SWIPE_GAP_MS = 1_500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface SessionRun {
  active: ActiveSession
  startOutput: string
  result: Result
  /** stop 이 쓴 `result.json` 원문 — DM-8 바이트 대조용. */
  resultText: string
  sessionJson: Record<string, unknown>
}

interface AfterStop {
  enableflags: string
  appNumber: string
  /** `perfetto --query` 의 TRACING SESSIONS 행. */
  sessions: string[]
  remoteTracePresent: boolean
}

/** `wm size` 에서 화면 크기 — Override 가 있으면 그것 (입력 좌표는 지금 화면 기준). */
function screenSize(wm: string): { w: number; h: number } {
  const m = /Override size:\s*(\d+)x(\d+)/.exec(wm) ?? /Physical size:\s*(\d+)x(\d+)/.exec(wm)
  if (m === null) throw new Error(`wm size 를 읽지 못했다: ${wm}`)
  return { w: Number(m[1]), h: Number(m[2]) }
}

/** `perfetto --query` 의 마지막 절(TRACING SESSIONS) 머리 `===` 줄 뒤의 비지 않은 줄. */
function tracingSessions(query: string): string[] {
  const lines = query.split('\n')
  const at = lines.findIndex((l) => l.trim() === 'TRACING SESSIONS:')
  if (at < 0) throw new Error('perfetto --query 에 TRACING SESSIONS 절이 없다')
  const rule = lines.findIndex((l, i) => i > at && l.trim().startsWith('==='))
  if (rule < 0) throw new Error('perfetto --query 의 TRACING SESSIONS 머리를 못 찾았다')
  const rows: string[] = []
  for (const l of lines.slice(rule + 1)) {
    if (l.trim().length === 0 || l.trim().endsWith(':')) break
    rows.push(l.trim())
  }
  return rows
}

/**
 * 세션 하나 — start → (앱이 그릴 틈) → 스와이프 4회 → stop. 스와이프는 adb 를 직접 부른다 (위 머리말).
 * 화면 크기는 start **전에** 읽는다 — 창이 열린 뒤에는 도구가 기기에 묻지 않는다.
 */
async function runSession(diagnose: boolean, out: string): Promise<SessionRun> {
  const ctx = await createContext(DEVICE_OPTS)
  const { w, h } = screenSize(await ctx.adb.tryShell('wm size'))
  const swipe = ['-s', ctx.serial, 'shell', 'input', 'swipe',
    String(Math.round(w / 2)), String(Math.round(h * 0.73)),
    String(Math.round(w / 2)), String(Math.round(h * 0.3)), '300']

  const startOutput = await runStart(ctx, {
    app: DEVICE_TARGET_APP,
    name: diagnose ? 'dm16' : 'dm16-normal',
    launch: true,
    out,
    force: true,
    ...(diagnose ? { diagnose: true } : {}),
  })
  const active = await readActiveSession(ctx.serial)
  expect(active, '세션 포인터가 없다').not.toBeNull()

  await sleep(2_000)
  for (let i = 0; i < 4; i++) {
    execFileSync(ctx.adb.adbPath, swipe, { stdio: 'ignore' })
    await sleep(SWIPE_GAP_MS)
  }
  await sleep(1_000)

  const stopOutput = await runStop(await createContext(DEVICE_OPTS), { offline: false })
  expect(stopOutput).toContain(`${active!.runDir}/result.json`)
  expect(await readActiveSession(ctx.serial)).toBeNull()

  const resultText = readFileSync(join(active!.runDir, 'result.json'), 'utf8')
  return {
    active: active!,
    startOutput,
    result: JSON.parse(resultText) as Result,
    resultText,
    sessionJson: JSON.parse(readFileSync(join(active!.runDir, 'session.json'), 'utf8')) as Record<string, unknown>,
  }
}

/** stop 이 끝난 뒤(창 밖) — DM-5 의 기준 넷. `app_0` 은 기준이 아니다 (결정 12). */
async function readAfterStop(remoteTracePath: string): Promise<AfterStop> {
  const ctx = await createAdbContext(DEVICE_OPTS)
  return {
    enableflags: (await ctx.adb.tryShell('getprop debug.atrace.tags.enableflags')).trim(),
    appNumber: (await ctx.adb.tryShell('getprop debug.atrace.app_number')).trim(),
    sessions: tracingSessions(await ctx.adb.tryShell('perfetto --query')),
    remoteTracePresent:
      (await ctx.adb.tryShell(`[ -e ${remoteTracePath} ] && echo __present__ || echo __absent__`)).trim() ===
      '__present__',
  }
}

/** 원본에 실린 TraceConfig (perfetto 가 다시 쓴 textproto). uuid 줄은 세션마다 달라 뺀다. */
async function embeddedConfig(tp: TraceProcessor): Promise<string> {
  const row = await tp.queryJson<{ cfg: string | null }>(
    "select json_object('cfg', (select str_value from metadata where name = 'trace_config_pbtxt')) as j",
  )
  expect(row.cfg, '원본에 trace_config_pbtxt 가 없다').not.toBeNull()
  return row
    .cfg!.split('\n')
    .filter((l) => !/^\s*trace_uuid_(msb|lsb):/.test(l))
    .join('\n')
}

/** 객체 트리 어디든 이름에 `diagnos` 가 든 키 — 평소 세션이면 0 이어야 한다. */
function diagnoseKeys(o: unknown, path = ''): string[] {
  if (o === null || typeof o !== 'object') return []
  const out: string[] = []
  for (const [k, v] of Object.entries(o)) {
    if (/diagnos/i.test(k)) out.push(path + k)
    out.push(...diagnoseKeys(v, `${path}${k}.`))
  }
  return out
}

const SLICE_CARD = MANIFEST.find((b) => b.kind === 'slicetable') as SliceTableBlock

describe('DM-16 실기기 — 진단 세션 (start --launch --diagnose → 스와이프 4회 → stop)', () => {
  let caps: DeviceCapability
  let diag: SessionRun
  let after: AfterStop
  let tp: TraceProcessor
  const out = mkdtempSync(join(tmpdir(), 'pt-dm16-'))

  beforeAll(async () => {
    caps = await deviceCapabilities()
    diag = await runSession(true, out)
    // stop 바로 뒤에 읽는다 — 평소 세션을 돌리기 전에.
    after = await readAfterStop(diag.active.remoteTracePath)
    tp = new TraceProcessor(await ensureTraceProcessor(), join(diag.active.runDir, 'trace.perfetto-trace'))
  }, 240_000)

  it('DM-16 진단 세션 result.json — 진단 여부 true · 창 안 adb 0 · 버퍼 넘침 없음 · 손실 칸 · 블록 상태 · 앱 slice 열림', () => {
    const r = diag.result
    // start 가 사람에게 진단 세션임을 말했다 (DM-11 — 실제 기기 세션에서).
    expect(diag.startOutput).toContain(DIAGNOSE_CLI_COPY.labelLine)

    expect(r.session.options.diagnose).toBe(true)
    expect(r.measurement_overhead.adb_commands_during_session).toBe(0)
    expect(r.measurement_overhead.trace_buffer_overrun).toBe(false)

    const d = r.diagnose!
    expect(d, '진단 세션인데 diagnose 블록이 없다').toBeDefined()
    expect(d.atrace_categories).toEqual(['am', 'wm', 'view'])
    expect(d.atrace_apps).toEqual([DEVICE_TARGET_APP])

    // 앱 slice 열림은 core 판정 그대로 — 이 기기 sdk 와 대상 앱 debuggable 로 정해진다.
    const verdict = appSliceOpen(r.device.static.sdk_int, r.target_app.debuggable)
    if (verdict.open === true) {
      expect(d.app_slices_open).toBe(true)
      expect(d.app_slices_open_reason_code).toBeNull()
    } else {
      expect(d.app_slices_open).toBeNull()
      expect(d.app_slices_open_reason_code).toBe('app_slices_open_unknown')
    }

    if (!caps.dataSources.includes('linux.ftrace')) {
      // 이 기기는 atrace 를 못 싣는다 — 0 이 아니라 모른다고 말해야 한다.
      expect(d.status).toBe('unsupported')
      expect(d.reason_code).toBe('data_source_not_registered')
      expect(d.trace_slices).toBeNull()
      expect(d.target_process_slice_names).toBeNull()
      return
    }

    // 블록 collected, 또는 앱이 `<pre-initialized>` · `zygote64` 로 남은 회면 낡은 이름 partial.
    expect(d.status, `diagnose: ${d.reason ?? ''}`).toMatch(/^(collected|partial)$/)
    if (d.status === 'partial') expect(d.reason_code).toBe('process_name_stale_in_trace')
    else expect(d.reason_code).toBeNull()

    // 커널 ftrace 손실 칸은 재 봤어야 한다 — null 이면 통계가 원본에 없다는 뜻이다.
    expect(d.ftrace_overrun_events).not.toBeNull()
    expect(d.trace_bytes).toBeGreaterThan(0)
  })

  it('DM-16 slice 표 — bindApplication · Choreographer#doFrame · RV Scroll 행 · 행 수 ≤ 접기 전 이름 수 · count 합 = 대상 앱 slice 수 · 코드 단위 순', () => {
    const d = diag.result.diagnose!
    if (!caps.dataSources.includes('linux.ftrace')) {
      expect(d.status).toBe('unsupported')
      return
    }
    const rows = d.target_process_slice_names!
    expect(rows, '대상 앱 표가 null — 프로세스를 못 찾았다').not.toBeNull()

    const names = rows.map((x) => x.name)
    // am(ActivityThread) · view(Choreographer) 는 프레임워크 slice — 앱 slice 열림과 무관하게 실린다.
    // bindApplication 은 진단 --launch 가 atrace 켜짐을 기다린 뒤 앱을 띄워야 잡힌다 (결정 11).
    expect(names.some((n) => n.startsWith('bindApplication')), 'bindApplication 행이 없다').toBe(true)
    expect(names.some((n) => n.startsWith('Choreographer#doFrame')), 'Choreographer#doFrame 행이 없다').toBe(true)
    if (d.app_slices_open === true && DEVICE_TARGET_APP === DM16_APP) {
      expect(names, 'RV Scroll 행이 없다 — 스와이프가 피드를 굴렸나').toContain('RV Scroll')
    }

    expect(d.target_process_slice_names_unfolded!).toBeGreaterThanOrEqual(rows.length)
    let sum = 0
    for (const row of rows) {
      for (const g of [row.main_thread, row.other_threads, row.async_tracks]) sum += g?.count ?? 0
    }
    expect(sum).toBe(d.target_process_slices)
    // 처음 순서는 이름의 코드 단위 순 (호스트 로캘 무관 · 결정 7).
    expect(names).toEqual([...names].sort(compareCodeUnits))
  })

  it('DM-16 frametimeline 제외 — 같은 원본을 trace_processor 로 다시 세면 대상 앱 slice 수 · 비동기 갈래 · 접기 전 이름 수가 블록과 같다', async () => {
    const d = diag.result.diagnose!
    if (!caps.dataSources.includes('linux.ftrace')) {
      expect(d.status).toBe('unsupported')
      return
    }
    const pid = diag.result.target_app.pid
    expect(pid, '--launch 세션인데 pid 가 없다').not.toBeNull()

    /**
     * 블록의 쿼리(`diagnoseSlicesSql`)를 부르지 않고 따로 센다 — 같은 SQL 로 세면 같은 실수를 같이 한다.
     * 대상 앱 = 캡처한 pid 의 프로세스 하나. frametimeline(Actual · Expected Timeline)은 대상 앱의
     * 프로세스 트랙에 실리므로, 그것을 뺀 수와 넣은 수를 같이 내 "뺐다" 가 실제로 일어났는지 본다.
     */
    const x = await tp.queryJson<{
      upids: number
      all: number
      ftl: number
      atrace: number
      unfinished: number
      async_atrace: number
      names_atrace: number
      names_all: number
    }>(
      `with u as (select upid from process where pid = ${pid}), ` +
        'tr as (select tt.id from thread_track tt join thread t using (utid) where t.upid in (select upid from u) ' +
        'union all select pt.id from process_track pt where pt.upid in (select upid from u)), ' +
        'ftl as (select id from actual_frame_timeline_slice where upid in (select upid from u) ' +
        'union all select id from expected_frame_timeline_slice where upid in (select upid from u)) ' +
        "select json_object('upids', (select count(*) from u), " +
        "'all', (select count(*) from slice where track_id in tr), " +
        "'ftl', (select count(*) from ftl), " +
        "'atrace', (select count(*) from slice where track_id in tr and id not in ftl), " +
        "'unfinished', (select count(*) from slice where track_id in tr and id not in ftl and dur < 0), " +
        "'async_atrace', (select count(*) from slice where id not in ftl and track_id in " +
        '(select id from process_track where upid in (select upid from u))), ' +
        "'names_atrace', (select count(distinct coalesce(name, '')) from slice where track_id in tr and id not in ftl), " +
        "'names_all', (select count(distinct coalesce(name, '')) from slice where track_id in tr)) as j",
    )
    expect(x.upids, `pid ${pid} 의 프로세스가 원본에 하나가 아니다`).toBe(1)

    if (caps.supported.has('frame')) {
      // 대상 앱의 frametimeline 이 원본에 있다 — 그래야 아래 "같다" 가 "뺐다" 의 증거가 된다.
      expect(x.ftl, '대상 앱 frametimeline slice 가 원본에 0개').toBeGreaterThan(0)
      expect(x.names_all).toBeGreaterThan(x.names_atrace)
    }
    expect(x.all).toBe(x.atrace + x.ftl)

    expect(d.target_process_slices).toBe(x.atrace)
    expect(d.target_process_slices_unfinished).toBe(x.unfinished)
    expect(d.target_process_slice_names_unfolded).toBe(x.names_atrace)
    const asyncCount = d.target_process_slice_names!.reduce((a, row) => a + (row.async_tracks?.count ?? 0), 0)
    expect(asyncCount).toBe(x.async_atrace)
    // 프레임 토큰(숫자뿐인 이름)은 접으면 `*` 하나가 된다 — 그런 행이 없다.
    expect(d.target_process_slice_names!.map((r) => r.name)).not.toContain('*')
  })

  it('DM-16 보고서 행 모델의 행 수 = 블록 표 행 수', () => {
    const d = diag.result.diagnose!
    const vm = buildSliceTable(SLICE_CARD, diag.result)
    if (d.target_process_slice_names === null) {
      expect(vm.none).toBe(true)
      return
    }
    expect(vm.none).not.toBe(true)
    expect((vm as SliceTableVm).rows).toHaveLength(d.target_process_slice_names.length)
  })

  it('DM-8 같은 원본으로 extract 하면 진단 블록이 바이트까지 같다', async () => {
    const again = await extractRun(diag.active.runDir, {})
    const written = (JSON.parse(diag.resultText) as { diagnose: DiagnoseBlock }).diagnose
    expect(JSON.stringify(again.diagnose)).toBe(JSON.stringify(written))
  })

  it('DM-5 stop 뒤 기기 원상 — enableflags 0 · app_number 빈 값 · perfetto 세션 0 · 그 세션의 원격 파일 0', () => {
    expect(after.enableflags).toBe('0')
    expect(after.appNumber).toBe('')
    expect(after.sessions, `남은 perfetto 세션: ${after.sessions.join(' | ')}`).toEqual([])
    expect(after.remoteTracePresent, `${diag.active.remoteTracePath} 가 남았다`).toBe(false)
    // `debug.atrace.app_0` 은 단언하지 않는다 — perfetto 가 마지막 패키지를 남기는 것이 관측 사실이고
    // 도구는 atrace 속성을 고치지 않는다 (기능 문서 결정 12).
  })

  describe('같은 조건의 평소 세션', () => {
    let normal: SessionRun

    beforeAll(async () => {
      normal = await runSession(false, out)
    }, 240_000)

    it('DM-16 평소 세션 — result.json · session.json 에 진단 관련 키 0 · 최대 30분', () => {
      expect(diagnoseKeys(normal.result), 'result.json').toEqual([])
      expect(diagnoseKeys(normal.sessionJson), 'session.json').toEqual([])
      expect(normal.result.session.options).toEqual({ launch: true })
      expect(normal.sessionJson['configuredDurationMs']).toBe(1_800_000)
      expect(normal.startOutput).not.toContain('Diagnose')
      expect(normal.result.measurement_overhead.adb_commands_during_session).toBe(0)
    })

    it('DM-3 기기로 나간 config — 평소는 atrace 0 · 진단은 같은 config 에 atrace 넷 · 최대 시간만 다르다', async () => {
      const normalTp = new TraceProcessor(
        await ensureTraceProcessor(),
        join(normal.active.runDir, 'trace.perfetto-trace'),
      )
      const n = await embeddedConfig(normalTp)
      const d = await embeddedConfig(tp)
      expect(n).not.toMatch(/atrace/)
      expect(n).toMatch(/^duration_ms: 1800000$/m)
      expect(d).toMatch(/^duration_ms: 600000$/m)

      const atraceLines = d.split('\n').filter((l) => /^\s*atrace_/.test(l)).map((l) => l.trim())
      expect(atraceLines).toEqual([
        'atrace_categories: "am"',
        'atrace_categories: "wm"',
        'atrace_categories: "view"',
        `atrace_apps: "${DEVICE_TARGET_APP}"`,
      ])
      const dWithoutAtrace = d
        .split('\n')
        .filter((l) => !/^\s*atrace_/.test(l))
        .join('\n')
        .replace(/^duration_ms: 600000$/m, 'duration_ms: 1800000')
      expect(dWithoutAtrace).toBe(n)
    })
  })
})
