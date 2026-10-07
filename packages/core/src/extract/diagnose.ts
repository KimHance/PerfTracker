import { stat } from 'node:fs/promises'
import { type AppProcessCandidate, appProcessSql, resolveAppProcess, staleNameReason } from '../collectors/appProcess.js'
import { round } from '../collectors/num.js'
import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import { type MetricReason, renderReason } from '../schema/reasons.js'
import type { DiagnoseBlock, MetricStatus, SliceBranchStats, SliceNameRow } from '../schema/result.js'
import { appSliceOpen } from '../session/diagnose.js'

/**
 * 진단 세션의 `result.json` 블록 (기능 문서 diagnostic-mode DM-7 · DM-9).
 *
 * **트레이스를 다시 읽기만 한다** — 기기에 접촉하지 않고, 원본 말고 다른 파일을 만들지 않는다.
 * 그래서 `perftracker extract` 가 같은 원본으로 몇 번을 돌려도 같은 블록이 나온다 (DM-8):
 * 쿼리가 내는 행의 순서에 기대지 않고(여기서 정렬한다), 길이는 ns 정수로 더한 뒤 한 번만 ms 로 바꾼다.
 *
 * 쿼리는 셋이다 — 트레이스 전체(`DIAGNOSE_TOTALS_SQL`) · 대상 앱 프로세스 특정(`appProcessSql` —
 * cpu · memory · log 와 **같은 규칙 · 같은 쿼리**) · 그 프로세스의 (원문 이름 × 갈래) 집계.
 * 이름 접기 · 합치기 · 정렬은 SQL 이 아니라 아래 순수 함수가 한다 — SQLite 에는 정규식 치환이 없다.
 */

/**
 * frametimeline 의 slice — 평소 config 에도 있는 `android.surfaceflinger.frametimeline` 이 대상 앱의
 * 프로세스 트랙에 남기는 Actual · Expected Timeline. atrace 가 아니라서 어디에도 세지 않는다 (DM-7).
 * 트랙 종류 문자열이 아니라 이 두 표의 id 로 거르는 이유: 표 이름이 기능 문서의 정의 그대로이고,
 * 트랙 분류 이름은 trace_processor 판마다 바뀔 수 있다.
 */
const NOT_FRAMETIMELINE =
  's.id not in (select id from actual_frame_timeline_slice) ' +
  'and s.id not in (select id from expected_frame_timeline_slice)'

/**
 * 커널 ftrace 링버퍼에서 잃은 이벤트의 stats 이름 — CPU 마다 하나씩 있는 `*_delta`(트레이스 구간의
 * 증가분)를 더한다. `_begin` · `_end` 는 같은 카운터의 시작 · 끝 값이라 더하면 세 번 센다 (실현성 재검토 #5).
 *
 * **손실 카운터 셋을 다 센다** — overrun(덮어써서) · commit_overrun(쓰는 중에 겹쳐서) ·
 * dropped_events(덮어쓰기를 끈 링버퍼가 꽉 차서). 하나라도 빼면 그쪽으로 잃은 slice 가 있어도 0 을 낸다.
 */
export const FTRACE_LOSS_STATS = [
  'ftrace_cpu_overrun_delta',
  'ftrace_cpu_commit_overrun_delta',
  'ftrace_cpu_dropped_events_delta',
] as const

/**
 * 트레이스 전체에서 한 번에 읽는 넷.
 *
 * - `ftrace_overrun_events` 는 **`sum`** 이다 — SQLite 의 `sum` 은 행이 없으면 NULL 이고 `total` 은
 *   0.0 이다. ftrace 가 안 돈 원본(실측 B0)에는 이 통계가 한 행도 없고, 그것은 "잃은 것 0" 이 아니라
 *   "모른다" 다. `total` · `coalesce(…, 0)` 로 바꾸면 거짓 청정이 된다.
 * - `ftrace_cpu_stats` 는 CPU 마다 붙는 `ftrace_cpu_*` 통계의 행 수 — ftrace 가 원본에 남았는지의 증거다.
 *   전역 `ftrace_*` 통계(`ftrace_setup_errors` 등)는 ftrace 가 안 돈 원본에도 0 으로 있어 증거가 못 된다.
 * - `ftrace_setup_errors` 는 traced_probes 가 ftrace(atrace 포함)를 켜다 낸 오류 수. 없으면 null.
 */
export const DIAGNOSE_TOTALS_SQL =
  "select json_object('trace_slices', (select count(*) from slice s " +
  'where (s.track_id in (select id from thread_track) or s.track_id in (select id from process_track)) ' +
  `and ${NOT_FRAMETIMELINE}), ` +
  "'ftrace_overrun_events', (select sum(value) from stats " +
  `where name in (${FTRACE_LOSS_STATS.map((n) => `'${n}'`).join(', ')})), ` +
  "'ftrace_cpu_stats', (select count(*) from stats where name glob 'ftrace_cpu_*'), " +
  "'ftrace_setup_errors', (select value from stats where name = 'ftrace_setup_errors')) as j"

export interface DiagnoseTotalsRow {
  trace_slices: number
  ftrace_overrun_events: number | null
  ftrace_cpu_stats: number
  ftrace_setup_errors: number | null
}

/** 갈래 셋 — 메인 스레드(tid = pid) · 그 밖 스레드 · 프로세스 트랙(비동기). */
export type SliceBranch = 'main' | 'other' | 'async'

/** (원문 이름 × 갈래) 하나. `finished` 는 끝난 slice 수, 길이는 끝난 것만의 ns. */
export interface SliceGroupRow {
  name: string
  branch: SliceBranch
  count: number
  finished: number
  sum_ns: number
  max_ns: number | null
}

/**
 * 대상 앱 프로세스의 slice 를 (원문 이름 × 갈래) 로 센다. `upid` · `pid` 는 숫자라 인터폴레이션이
 * 안전하다 (`appProcessSql` 의 pid 와 같다).
 *
 * 끝나지 않은 slice 는 trace_processor 가 `dur = -1` 로 둔다 — 횟수에는 넣고 합 · 최대에서는 뺀다.
 * 이름이 없는 slice 는 빈 문자열로 센다 (`null` 을 키로 쓰면 json 에서 행이 갈라진다).
 */
export function diagnoseSlicesSql(upid: number, pid: number): string {
  const u = Math.trunc(upid)
  const p = Math.trunc(pid)
  return (
    "select json_group_array(json_object('name', name, 'branch', branch, 'count', n, " +
    "'finished', f, 'sum_ns', sd, 'max_ns', md)) as j from (" +
    "select coalesce(s.name, '') as name, " +
    `case when tt.id is null then 'async' when t.tid = ${p} then 'main' else 'other' end as branch, ` +
    'count(*) as n, sum(s.dur >= 0) as f, ' +
    'sum(case when s.dur >= 0 then s.dur else 0 end) as sd, ' +
    'max(case when s.dur >= 0 then s.dur end) as md ' +
    'from slice s ' +
    'left join thread_track tt on tt.id = s.track_id ' +
    'left join thread t on t.utid = tt.utid ' +
    'left join process_track pt on pt.id = s.track_id ' +
    `where (t.upid = ${u} or pt.upid = ${u}) and ${NOT_FRAMETIMELINE} ` +
    'group by 1, 2)'
  )
}

/**
 * **이름 접기** (plan D16). 숫자가 하나라도 든 영문 · 숫자 토큰(연속한 `[A-Za-z0-9]`)을 `*` 하나로 바꾼다.
 *
 * 숫자 · `0x…` 16진 · `@a1b2c3` 해시 · `tk-trace-id: 1001yo7d2xmcq` 같은 base36 토큰이 한 규칙으로
 * 접힌다. 숫자가 없는 토큰은 단어와 가를 수 없어 그대로 둔다 — 실측(SM-S901N · YouTube 15초)에서
 * `tk-trace-id` 1,317개 중 2개가 그렇게 남았다. 접은 뒤 4,921 → 1,082행 · 7,036 → 920행.
 *
 * 이름 길이는 자르지 않는다 (435자 이름이 실재한다 — 원문 그대로 grep 되게).
 */
export function foldSliceName(name: string): string {
  return name.replace(/[A-Za-z0-9]*[0-9][A-Za-z0-9]*/g, '*')
}

/** 이름의 UTF-16 코드 단위 순 — 호스트 로캘과 무관하다 (결정 7). `localeCompare` 를 쓰지 않는다. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

interface BranchAcc {
  count: number
  finished: number
  sumNs: number
  maxNs: number | null
}

export interface SliceTable {
  rows: SliceNameRow[]
  /** 대상 앱 프로세스 slice 수 = 표의 횟수 합. */
  slices: number
  /** 그중 끝나지 않은 것. */
  unfinished: number
  /** 접기 전 고유 이름 수. */
  namesUnfolded: number
}

function toCell(acc: BranchAcc | undefined): SliceBranchStats | null {
  // 그 갈래에 그 이름의 slice 가 없으면 칸이 null 이다 — 최대 ms 를 0 으로 지어내지 않는다 (D18).
  if (acc === undefined || acc.count === 0) return null
  // 끝난 slice 가 없으면 길이를 모른다 — 합을 0 이라고 하지 않는다.
  const known = acc.finished > 0
  return {
    count: acc.count,
    sum_ms: known ? round(acc.sumNs / 1e6, 3) : null,
    max_ms: known && acc.maxNs !== null ? round(acc.maxNs / 1e6, 3) : null,
  }
}

/**
 * (원문 이름 × 갈래) 행 → 접은 이름별 표. **행을 자르지 않고**, 처음 순서는 이름의 코드 단위 순이다.
 * 입력 행의 순서와 무관하게 같은 표가 나온다 (DM-8).
 */
export function buildSliceTable(groups: SliceGroupRow[]): SliceTable {
  const byName = new Map<string, Partial<Record<SliceBranch, BranchAcc>>>()
  const unfolded = new Set<string>()
  let slices = 0
  let finished = 0

  for (const g of groups) {
    unfolded.add(g.name)
    slices += g.count
    finished += g.finished
    const key = foldSliceName(g.name)
    const row = byName.get(key) ?? {}
    const acc = (row[g.branch] ??= { count: 0, finished: 0, sumNs: 0, maxNs: null })
    acc.count += g.count
    acc.finished += g.finished
    acc.sumNs += g.sum_ns
    if (g.max_ns !== null) acc.maxNs = acc.maxNs === null ? g.max_ns : Math.max(acc.maxNs, g.max_ns)
    byName.set(key, row)
  }

  const rows = [...byName.keys()].sort(compareCodeUnits).map((name) => {
    const row = byName.get(name)!
    return {
      name,
      main_thread: toCell(row.main),
      other_threads: toCell(row.other),
      async_tracks: toCell(row.async),
    }
  })

  return { rows, slices, unfinished: slices - finished, namesUnfolded: unfolded.size }
}

export interface DiagnoseExtractInput {
  /** 원본을 읽는 trace_processor. 원본이 없으면 null. */
  tp: TraceProcessor | null
  /** 원본 파일의 절대 경로 — 크기를 잰다. 원본이 없으면 null. */
  tracePath: string | null
  packageName: string
  appPid: number | null
  /** `capture.json` 의 `env` — 열림 판정의 sdk 와 linux.ftrace 등록 여부. */
  env: { sdkInt: number; dataSources: string[] }
  /** `target_app.debuggable` 그대로. 없던 시절의 매니페스트면 undefined. */
  debuggable: boolean | null | undefined
  /** session.json 이 기록한 실제 범위. 없으면 null — 상수에서 다시 만들지 않는다. */
  scope: { atraceCategories: string[]; atraceApps: string[] } | null
}

/** 트레이스에서 읽는 칸 — 못 읽으면 전부 null 이다. */
interface TraceCells {
  trace_slices: number | null
  target_process_slices: number | null
  target_process_slices_unfinished: number | null
  ftrace_overrun_events: number | null
  target_process_slice_names_unfolded: number | null
  target_process_slice_names: SliceNameRow[] | null
}

const NO_TRACE_CELLS: TraceCells = {
  trace_slices: null,
  target_process_slices: null,
  target_process_slices_unfinished: null,
  ftrace_overrun_events: null,
  target_process_slice_names_unfolded: null,
  target_process_slice_names: null,
}

const FTRACE_SOURCE = 'linux.ftrace'

async function fileBytes(path: string | null): Promise<number | null> {
  if (path === null) return null
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

/**
 * 트레이스에서 읽는 칸과 그 상태. **어떤 실패도 예외로 새어 나가지 않는다** — 블록 하나가 터져
 * result.json 전체를 못 내면 안 된다 (메트릭의 `runCollector` 와 같은 규율).
 */
async function readTraceCells(
  input: DiagnoseExtractInput,
): Promise<{ status: MetricStatus; reason: MetricReason | null; cells: TraceCells }> {
  // 기기에 linux.ftrace 가 없으면 atrace 가 돌 수 없었다 — 트레이스의 0개는 "재 봤더니 없었다" 가
  // 아니다. perfetto 는 등록되지 않은 데이터소스를 조용히 무시하므로 세션은 열렸을 것이다.
  if (!input.env.dataSources.includes(FTRACE_SOURCE)) {
    return {
      status: 'unsupported',
      reason: { code: 'data_source_not_registered', detail: { data_source: FTRACE_SOURCE } },
      cells: NO_TRACE_CELLS,
    }
  }
  if (input.tp === null) return { status: 'failed', reason: { code: 'trace_missing' }, cells: NO_TRACE_CELLS }

  try {
    const totals = await input.tp.queryJson<DiagnoseTotalsRow>(DIAGNOSE_TOTALS_SQL)
    const ftraceOverrun = totals.ftrace_overrun_events ?? null

    const setupErrors = totals.ftrace_setup_errors ?? null

    // ftrace 가 원본에 안 남았으면(CPU 통계 0행) slice 의 0개는 "재 봤더니 없었다" 가 아니다 (plan D35)
    // — slice 칸을 전부 모름으로 둔다. 잃은 이벤트 수도 통계가 없으니 null 이다.
    if (totals.ftrace_cpu_stats === 0) {
      return {
        status: 'partial',
        reason: {
          code: 'ftrace_not_recorded',
          detail: { cause: 'no_ftrace_stats', ftrace_cpu_stats: 0, setup_errors: setupErrors },
        },
        cells: { ...NO_TRACE_CELLS, ftrace_overrun_events: ftraceOverrun },
      }
    }

    // 켜기 오류는 있는데 ftrace 는 돌았다 — **잰 값을 지우지 않는다** (plan D37). `ftrace_setup_errors` 는
    // atrace 실패만 세지 않는다: gfx · input 카테고리를 켠 실측 원본(research B2 · B3)은 오류 28 에
    // slice 33만–38만이 실렸다. 어느 이벤트 · 카테고리의 오류인지 원본이 말하지 않으므로 일부가 빠졌을
    // 수 있다는 사실만 status 로 남긴다 (process_name_stale_in_trace 처럼 값 있는 partial).
    const setupReason: MetricReason | null =
      setupErrors !== null && setupErrors > 0
        ? {
            code: 'ftrace_not_recorded',
            detail: { cause: 'ftrace_setup_errors', ftrace_cpu_stats: totals.ftrace_cpu_stats, setup_errors: setupErrors },
          }
        : null

    const candidates = await input.tp.queryJson<AppProcessCandidate[]>(
      appProcessSql(input.packageName, input.appPid),
    )
    const resolved = resolveAppProcess(candidates, input.packageName, input.appPid)
    const traceWide = {
      trace_slices: totals.trace_slices,
      ftrace_overrun_events: ftraceOverrun,
    }

    // 프로세스를 못 찾으면 대상 앱 몫 칸은 전부 null 이다 — 표를 0행으로 내면 "slice 가 없었다" 가 된다.
    if (resolved === null) {
      return {
        status: 'partial',
        reason: { code: 'process_not_in_trace', detail: { package: input.packageName } },
        cells: { ...NO_TRACE_CELLS, ...traceWide },
      }
    }

    const groups = await input.tp.queryJson<SliceGroupRow[]>(
      diagnoseSlicesSql(resolved.candidate.upid, resolved.candidate.pid),
    )
    const table = buildSliceTable(groups)
    // 블록 reason_code 는 하나다. 켜기 오류(일부 slice 가 빠졌을 수 있음)를 낡은 이름(값은 온전)보다
    // 앞세운다 — 수를 믿어도 되는지가 프로세스를 어떻게 찾았는지보다 먼저다. 프로세스를 못 찾은 경우는
    // 위에서 이미 process_not_in_trace 다 (그 칸들이 null 인 이유가 그것이므로).
    const reason = setupReason ?? staleNameReason(resolved, input.packageName)
    return {
      status: reason !== null ? 'partial' : 'collected',
      reason,
      cells: {
        ...traceWide,
        target_process_slices: table.slices,
        target_process_slices_unfinished: table.unfinished,
        target_process_slice_names_unfolded: table.namesUnfolded,
        target_process_slice_names: table.rows,
      },
    }
  } catch (e) {
    return {
      status: 'failed',
      reason: { code: 'query_failed', detail: { message: (e as Error).message } },
      cells: NO_TRACE_CELLS,
    }
  }
}

/**
 * 진단 블록 하나. 진단 세션(`session.options.diagnose === true`)일 때만 부른다 — 평소 세션에는
 * 블록이 없다 (plan D12).
 *
 * **앱 slice 열림은 트레이스와 따로 간다.** sdk · debuggable 로 정해지는 조건이라(판정 출처는
 * `appSliceOpen` 하나 — doctor · start 와 같다) 원본이 없어도 값이 있고, 그 칸이 null 이어도
 * 블록 `status` 는 트레이스에서 읽은 칸의 상태다 (plan D18).
 */
export async function extractDiagnose(input: DiagnoseExtractInput): Promise<DiagnoseBlock> {
  const verdict = appSliceOpen(input.env.sdkInt, input.debuggable)
  const openReason: MetricReason | null =
    verdict.open === true
      ? null
      : { code: 'app_slices_open_unknown', detail: { sdk_int: input.env.sdkInt, debuggable: verdict.debuggable } }

  const { status, reason, cells } = await readTraceCells(input)

  return {
    atrace_categories: input.scope?.atraceCategories ?? null,
    atrace_apps: input.scope?.atraceApps ?? null,
    status,
    reason_code: reason?.code ?? null,
    reason: renderReason(reason),
    app_slices_open: verdict.open,
    app_slices_open_reason_code: openReason?.code ?? null,
    app_slices_open_reason: renderReason(openReason),
    trace_slices: cells.trace_slices,
    target_process_slices: cells.target_process_slices,
    target_process_slices_unfinished: cells.target_process_slices_unfinished,
    ftrace_overrun_events: cells.ftrace_overrun_events,
    trace_bytes: await fileBytes(input.tracePath),
    target_process_slice_names_unfolded: cells.target_process_slice_names_unfolded,
    target_process_slice_names: cells.target_process_slice_names,
  }
}
