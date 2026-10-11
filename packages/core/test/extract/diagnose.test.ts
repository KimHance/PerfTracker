import { accessSync, constants, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appProcessSql } from '../../src/collectors/appProcess.js'
import { DIAGNOSE_COPY, fillCopy } from '../../src/copy/diagnose.js'
import {
  buildArtCells,
  buildSliceTable,
  compareCodeUnits,
  DIAGNOSE_TOTALS_SQL,
  type DiagnoseExtractInput,
  diagnoseSlicesSql,
  type DiagnoseTotalsRow,
  extractDiagnose,
  FTRACE_LOSS_STATS,
  foldSliceName,
  parseCompileStateSlice,
  type SliceGroupRow,
} from '../../src/extract/diagnose.js'
import { renderReason } from '../../src/schema/reasons.js'
import { DiagnoseBlockSchema } from '../../src/schema/result.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { artifactFor, cachedBinaryPath } from '../../src/perfetto/traceProcessor/locate.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const BIN = '/bin/trace_processor_shell'
const TRACE = '/tmp/diag.pftrace'
const PKG = 'com.google.android.youtube'
const APP_PID = 10046
const UPID = 914

const g = (
  name: string,
  branch: SliceGroupRow['branch'],
  count: number,
  finished: number,
  sumNs: number,
  maxNs: number | null,
): SliceGroupRow => ({ name, branch, count, finished, sum_ns: sumNs, max_ns: maxNs })

/** SQL 원문 → 응답 JSON. 등록되지 않은 쿼리는 실패한다 (FakeProcessRunner 가 code 127). */
function tpWith(responses: [string, unknown][]): TraceProcessor {
  const runner = new FakeProcessRunner()
  for (const [sql, value] of responses) runner.on(`query ${TRACE} ${sql}`, { stdout: `"j"\n"${JSON.stringify(value)}"\n` })
  return new TraceProcessor(BIN, TRACE, runner)
}

const GROUPS: SliceGroupRow[] = [
  g('Choreographer#doFrame 136993', 'main', 1, 1, 7_000_000, 7_000_000),
  g('Choreographer#doFrame 136994', 'main', 1, 1, 5_500_000, 5_500_000),
  g('RV Scroll', 'main', 3, 3, 3_000_000, 1_200_000),
  g('bindApplication', 'main', 1, 1, 67_307_000, 67_307_000),
]

/** ftrace 가 돈 원본의 전체 수 — CPU 8개 × ftrace_cpu_* 통계 · 켜기 오류 0. */
const TOTALS: DiagnoseTotalsRow = { trace_slices: 75_800, ftrace_overrun_events: 0, ftrace_cpu_stats: 96, ftrace_setup_errors: 0 }
const totals = (over: Partial<DiagnoseTotalsRow>): [string, unknown] => [DIAGNOSE_TOTALS_SQL, { ...TOTALS, ...over }]

const HAPPY: [string, unknown][] = [
  [DIAGNOSE_TOTALS_SQL, TOTALS],
  [appProcessSql(PKG, APP_PID), [{ upid: UPID, pid: APP_PID, name: PKG }]],
  [diagnoseSlicesSql(UPID, APP_PID), GROUPS],
]

function input(over: Partial<DiagnoseExtractInput> = {}): DiagnoseExtractInput {
  return {
    tp: tpWith(HAPPY),
    tracePath: null,
    packageName: PKG,
    appPid: APP_PID,
    env: { sdkInt: 36, dataSources: ['linux.process_stats', 'linux.sys_stats', 'linux.ftrace'] },
    debuggable: false,
    scope: { atraceCategories: ['am', 'wm', 'view', 'dalvik'], atraceApps: [PKG] },
    ...over,
  }
}

/** dalvik 을 켜기 전(baseline-profile 이전) 진단 run 의 session.json 기록. */
const OLD_SCOPE = { atraceCategories: ['am', 'wm', 'view'], atraceApps: [PKG] }

/**
 * SM-S901N · YouTube 21.40.161 15초 원본(research raw-baseline B-Y-r1 · pid 5153)의 컴파일 상태 slice 원문
 * 그대로 — trace_processor 로 뽑은 이름 6개(그중 `location=none …` 은 3번 열림). 경로의 해시 토큰도 원문.
 */
const LOC_YT =
  'location=/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/com.google.android.youtube-_ZCw5JfQvaAuZ5khXQX0GQ==/oat/arm64/base.odex ' +
  'status=up-to-date filter=speed-profile reason=profile-utilization'
const LOC_NONE = 'location=none status=no-dex-code filter=unknown reason=unknown'
const LOC_PCAM =
  'location=/data/user/0/com.google.android.youtube/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/oat/arm64/pcam.vdex ' +
  'status=up-to-date filter=verify reason=vdex'
const LOC_DM_LOCATION =
  'primary.vdex mapped directly in memory from /data/app/~~KFTcLZ17DG7tQsePOLxgjg==/com.google.android.gms-tENA57oADSe_UrvITgDqpQ==/split_DynamiteLoader_installtime.dm'
const LOC_DM = `location=${LOC_DM_LOCATION} status=up-to-date filter=verify reason=vdex-dm`
const LOC_WEBVIEW =
  'location=/data/app/~~MjuOuRHiVEevnTwW46TUwg==/com.google.android.webview-td0bFyTvF7EmulJitVzgDw==/oat/arm64/base.odex ' +
  'status=up-to-date filter=speed-profile reason=install-dm'

describe('DM-7 접기 규칙', () => {
  it('DM-7 접기 규칙 — 숫자가 든 영문 · 숫자 토큰만 * 하나로 접고, 숫자 없는 토큰과 나머지 글자는 원문 그대로', () => {
    const cases: [string, string][] = [
      ['Choreographer#doFrame 136993', 'Choreographer#doFrame *'],
      ['tk-trace-id: 1001yo7d2xmcq', 'tk-trace-id: *'],
      ['VRI[Shell$HomeActivity]@a1b2c3', 'VRI[Shell$HomeActivity]@*'],
      ['Texture upload(0x7f3a) 12', 'Texture upload(*) *'],
      ['Choreographer#doFrame - resynced to 136994 in 2.5ms', 'Choreographer#doFrame - resynced to * in *.*'],
      ['MountState.mount treeid=13 rematerializationCount=0', 'MountState.mount treeid=* rematerializationCount=*'],
      // 숫자가 없는 토큰은 단어와 가를 수 없다 — 접지 않는다.
      ['tk-trace-id: rlcyp', 'tk-trace-id: rlcyp'],
      ['RV Scroll', 'RV Scroll'],
      ['<missing root>:BS.getBrowseData', '<missing root>:BS.getBrowseData'],
      ['한글 slice 이름', '한글 slice 이름'],
      ['', ''],
    ]
    for (const [raw, folded] of cases) expect(foldSliceName(raw), raw).toBe(folded)
  })

  it('DM-7 접기 규칙 — 숫자만 다른 이름은 한 행으로 합쳐지고, 접기 전 이름 수는 원문으로 센다', () => {
    const table = buildSliceTable([
      g('Choreographer#doFrame 1', 'main', 2, 2, 10_000_000, 6_000_000),
      g('Choreographer#doFrame 2', 'main', 3, 3, 9_000_000, 7_000_000),
      g('Choreographer#doFrame 3', 'other', 1, 1, 1_000_000, 1_000_000),
      g('RV Scroll', 'main', 1, 1, 500_000, 500_000),
    ])

    expect(table.rows.map((r) => r.name)).toEqual(['Choreographer#doFrame *', 'RV Scroll'])
    expect(table.rows[0]!.main_thread).toEqual({ count: 5, sum_ms: 19, max_ms: 7 })
    expect(table.rows[0]!.other_threads).toEqual({ count: 1, sum_ms: 1, max_ms: 1 })
    expect(table.namesUnfolded).toBe(4)
    expect(table.slices).toBe(7)
  })
})

describe('DM-7 클래스 디스크립터 접기', () => {
  it('DM-7 클래스 디스크립터 접기 — 이름 전체가 L…; (공백 없음)이면 L*; 하나, 아니면 결정 22 규칙 그대로', () => {
    const cases: [string, string][] = [
      // dalvik 이 남기는 난독화 디스크립터 — 숫자가 없어 결정 22 로는 안 접힌다.
      ['Lfvb;', 'L*;'],
      ['Lcom/google/android/libraries/youtube/Foo;', 'L*;'],
      ['Lcom/google/Foo$1;', 'L*;'],
      ['L;', 'L*;'],
      // 공백이 들면 디스크립터가 아니다 — 숫자 토큰 규칙만.
      ['Lock contention on thread list lock (owner tid: 12804)', 'Lock contention on thread list lock (owner tid: *)'],
      ['L foo;', 'L foo;'],
      // `L` 로 시작하지 않거나 `;` 로 끝나지 않으면 그대로 결정 22.
      ['Lfvb', 'Lfvb'],
      ['lfvb;', 'lfvb;'],
      ['VerifyClass Lfvb;', 'VerifyClass Lfvb;'],
      ['JIT compiling void Lfvb;.a(int) (kind=Baseline) from base.apk', 'JIT compiling void Lfvb;.a(int) (kind=Baseline) from base.apk'],
      ['Layout2;', 'L*;'],
      ['Layout 2', 'Layout *'],
    ]
    for (const [raw, folded] of cases) expect(foldSliceName(raw), raw).toBe(folded)
  })

  it('DM-7 클래스 디스크립터 접기 — 디스크립터 여럿이 한 행으로 합쳐지고, 접기 전 이름 수는 원문으로 센다', () => {
    const table = buildSliceTable([
      g('Lfvb;', 'main', 3, 3, 3_000, 1_000),
      g('Lcom/a/B;', 'main', 1, 1, 2_000, 2_000),
      g('Lcom/a/B;', 'other', 2, 2, 4_000, 3_000),
      g('Lzz;', 'other', 1, 0, 0, null),
      g('RV Scroll', 'main', 1, 1, 500_000, 500_000),
    ])
    expect(table.rows.map((r) => r.name)).toEqual(['L*;', 'RV Scroll'])
    expect(table.rows[0]!.main_thread).toEqual({ count: 4, sum_ms: 0.005, max_ms: 0.002 })
    expect(table.rows[0]!.other_threads).toEqual({ count: 3, sum_ms: 0.004, max_ms: 0.003 })
    expect(table.namesUnfolded).toBe(4)
    expect(table.slices).toBe(8)
    expect(table.unfinished).toBe(1)
  })
})

describe('BP-7 컴파일 상태 slice 파싱', () => {
  it('BP-7 컴파일 상태 slice 파싱 — 네 칸으로 갈리고, 공백 든 location 은 마지막 status= · filter= · reason= 자리로 갈린다', () => {
    expect(parseCompileStateSlice(LOC_YT)).toEqual({
      location:
        '/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/com.google.android.youtube-_ZCw5JfQvaAuZ5khXQX0GQ==/oat/arm64/base.odex',
      status: 'up-to-date',
      filter: 'speed-profile',
      reason: 'profile-utilization',
    })
    expect(parseCompileStateSlice(LOC_DM)).toEqual({
      location: LOC_DM_LOCATION,
      status: 'up-to-date',
      filter: 'verify',
      reason: 'vdex-dm',
    })
    expect(parseCompileStateSlice(LOC_NONE)).toEqual({
      location: 'none',
      status: 'no-dex-code',
      filter: 'unknown',
      reason: 'unknown',
    })
    // location 안에 ` status=` 꼴 글자가 있어도 마지막 자리로 가른다.
    expect(parseCompileStateSlice('location=/x status=a/y.odex status=up-to-date filter=speed reason=cmdline')).toEqual({
      location: '/x status=a/y.odex',
      status: 'up-to-date',
      filter: 'speed',
      reason: 'cmdline',
    })
    // 꼴이 다르면 추측하지 않는다.
    for (const bad of [
      'location=/x status=up-to-date filter=speed',
      'location=/x status=up-to-date filter=speed reason=cmdline extra=1',
      'location=/x filter=speed status=up-to-date reason=cmdline',
      'location=/x status= filter=speed reason=cmdline',
    ]) {
      expect(parseCompileStateSlice(bad), bad).toBeNull()
    }
  })

  it('BP-7 컴파일 상태 slice 파싱 — 같은 네 값은 한 줄 (갈래 · 횟수 무관) · 순서는 원문 이름의 코드 단위 순 · 입력 순서와 무관', () => {
    const rows = [
      g(LOC_WEBVIEW, 'other', 1, 1, 430_000, 430_000),
      g(LOC_NONE, 'main', 3, 3, 30_000, 10_000),
      g(LOC_YT, 'main', 1, 1, 16_690_000, 16_690_000),
      g(LOC_DM, 'other', 1, 1, 100_000, 100_000),
      g(LOC_PCAM, 'other', 1, 1, 4_060_000, 4_060_000),
      g(LOC_NONE, 'other', 1, 1, 10_000, 10_000),
      g('bindApplication', 'main', 1, 1, 1, 1),
    ]
    const art = buildArtCells(rows)
    expect(art.compileStates.reason).toBeNull()
    expect(art.compileStates.value!.map((r) => `${r.location} ${r.filter}`)).toEqual([
      '/data/app/~~MjuOuRHiVEevnTwW46TUwg==/com.google.android.webview-td0bFyTvF7EmulJitVzgDw==/oat/arm64/base.odex speed-profile',
      '/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/com.google.android.youtube-_ZCw5JfQvaAuZ5khXQX0GQ==/oat/arm64/base.odex speed-profile',
      '/data/user/0/com.google.android.youtube/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/oat/arm64/pcam.vdex verify',
      'none unknown',
      `${LOC_DM_LOCATION} verify`,
    ])
    expect(JSON.stringify(buildArtCells([...rows].reverse()))).toBe(JSON.stringify(art))
  })

  it('BP-7 컴파일 상태 slice 파싱 — location= 인데 꼴을 모르는 이름이 하나라도 있으면 목록 null + compile_state_slice_unparsable (JIT 수는 그대로)', () => {
    const art = buildArtCells([
      g(LOC_YT, 'main', 1, 1, 1, 1),
      g('location=/x status=up-to-date filter=speed', 'main', 1, 1, 1, 1),
      g('JIT compiling void Lfvb;.a() (kind=Baseline) from base.apk', 'other', 2, 2, 1, 1),
    ])
    expect(art.compileStates.value).toBeNull()
    expect(art.compileStates.reason).toEqual({
      code: 'compile_state_slice_unparsable',
      detail: { name: 'location=/x status=up-to-date filter=speed' },
    })
    expect(renderReason(art.compileStates.reason)).toContain('location=/x status=up-to-date filter=speed')
    expect(art.jitSlices).toBe(2)
  })
})

describe('BP-7 JIT slice 수', () => {
  it('BP-7 JIT slice 수 — JIT compiling 으로 시작하는 slice 를 갈래 무관 · 끝나지 않은 것까지 센다 = 표의 그 이름들 count 합', () => {
    const rows = [
      g('JIT compiling void Lfvb;.a(int) (kind=Baseline) from base.apk', 'other', 50, 49, 1, 1),
      g('JIT compiling int Lzz;.b() (kind=Optimized) from base.apk', 'other', 1, 1, 1, 1),
      g('JIT compiling void Lq;.c() (kind=Baseline) from base.apk', 'main', 1, 1, 1, 1),
      // 이름이 JIT compiling 으로 시작하지 않으면 세지 않는다 — JIT 스레드의 바깥 slice · 다른 dalvik slice.
      g('Compiling baseline', 'other', 52, 52, 1, 1),
      g('Background JIT compiling', 'other', 3, 3, 1, 1),
      g('jit compiling lower', 'other', 4, 4, 1, 1),
    ]
    const art = buildArtCells(rows)
    expect(art.jitSlices).toBe(52)

    const table = buildSliceTable(rows)
    const fromTable = table.rows
      .filter((r) => r.name.startsWith('JIT compiling'))
      .flatMap((r) => [r.main_thread, r.other_threads, r.async_tracks])
      .reduce((n, c) => n + (c?.count ?? 0), 0)
    expect(fromTable).toBe(art.jitSlices)
  })
})

describe('BP-7 ART 칸 null', () => {
  it('BP-7 dalvik 안 켠 원본은 null — 기록에 dalvik 이 없거나 기록이 null 이면 두 칸 null + dalvik_not_recorded · 블록 status 그대로', async () => {
    for (const scope of [OLD_SCOPE, null]) {
      const block = await extractDiagnose(input({ scope }))
      expect(block.target_process_compile_state_slices, JSON.stringify(scope)).toBeNull()
      expect(block.target_process_jit_slices).toBeNull()
      expect(block.target_process_compile_state_slices_reason_code).toBe('dalvik_not_recorded')
      expect(block.target_process_jit_slices_reason_code).toBe('dalvik_not_recorded')
      expect(block.target_process_jit_slices_reason).toBe(
        renderReason({ code: 'dalvik_not_recorded', detail: { atrace_categories: scope?.atraceCategories ?? null } }),
      )
      // 블록은 이것 때문에 바뀌지 않는다 — 표 · 수는 잰 그대로.
      expect(block.status).toBe('collected')
      expect(block.reason_code).toBeNull()
      expect(block.target_process_slices).toBe(6)
      expect(block.target_process_slice_names).toHaveLength(3)
    }
    expect(
      renderReason({ code: 'dalvik_not_recorded', detail: { atrace_categories: ['am', 'wm', 'view'] } }),
    ).toContain('am · wm · view')
  })

  it('BP-7 dalvik 안 켠 원본은 null — 원문 이름에 location= · JIT 가 있어도 기록이 없으면 세지 않는다', async () => {
    const groups = [...GROUPS, g(LOC_YT, 'main', 1, 1, 1, 1), g('JIT compiling x', 'other', 5, 5, 1, 1)]
    const tp = tpWith([HAPPY[0]!, HAPPY[1]!, [diagnoseSlicesSql(UPID, APP_PID), groups]])
    const block = await extractDiagnose(input({ tp, scope: OLD_SCOPE }))
    expect(block.target_process_compile_state_slices).toBeNull()
    expect(block.target_process_jit_slices).toBeNull()
    const on = await extractDiagnose(input({ tp: tpWith([HAPPY[0]!, HAPPY[1]!, [diagnoseSlicesSql(UPID, APP_PID), groups]]) }))
    expect(on.target_process_compile_state_slices).toHaveLength(1)
    expect(on.target_process_jit_slices).toBe(5)
  })

  it('BP-7 대상 앱 못 찾으면 null — 트레이스 쪽 이유면 두 칸 null + 블록과 같은 코드 (0 · [] 아님)', async () => {
    const cases: [string, DiagnoseExtractInput][] = [
      ['process_not_in_trace', input({ tp: tpWith([HAPPY[0]!, [appProcessSql(PKG, APP_PID), []]]) })],
      ['ftrace_not_recorded', input({ tp: tpWith([totals({ ftrace_cpu_stats: 0, ftrace_overrun_events: null })]) })],
      ['trace_missing', input({ tp: null })],
      ['query_failed', input({ tp: tpWith(HAPPY.slice(0, 2)) })],
      ['data_source_not_registered', input({ env: { sdkInt: 36, dataSources: [] } })],
    ]
    for (const [code, inp] of cases) {
      const block = await extractDiagnose(inp)
      expect(block.reason_code, code).toBe(code)
      expect(block.target_process_compile_state_slices, code).toBeNull()
      expect(block.target_process_jit_slices, code).toBeNull()
      expect(block.target_process_compile_state_slices_reason_code, code).toBe(code)
      expect(block.target_process_jit_slices_reason_code, code).toBe(code)
      expect(block.target_process_jit_slices_reason, code).toBe(block.reason)
    }
    // dalvik 을 안 켠 원본이면 트레이스 쪽 이유보다 그것이 먼저다.
    const old = await extractDiagnose(input({ tp: null, scope: OLD_SCOPE }))
    expect(old.target_process_jit_slices_reason_code).toBe('dalvik_not_recorded')
  })

  it('BP-7 대상 앱 못 찾으면 null — 값이 있는 partial(낡은 이름 · 켜기 오류)이면 두 칸은 잰 값 · 이유 null', async () => {
    const groups = [...GROUPS, g(LOC_NONE, 'main', 3, 3, 1, 1), g('JIT compiling x', 'other', 2, 2, 1, 1)]
    for (const tp of [
      tpWith([HAPPY[0]!, [appProcessSql(PKG, APP_PID), [{ upid: UPID, pid: APP_PID, name: '<pre-initialized>' }]], [diagnoseSlicesSql(UPID, APP_PID), groups]]),
      tpWith([totals({ ftrace_setup_errors: 3 }), HAPPY[1]!, [diagnoseSlicesSql(UPID, APP_PID), groups]]),
    ]) {
      const block = await extractDiagnose(input({ tp }))
      expect(block.status).toBe('partial')
      expect(block.target_process_compile_state_slices).toEqual([
        { location: 'none', status: 'no-dex-code', filter: 'unknown', reason: 'unknown' },
      ])
      expect(block.target_process_jit_slices).toBe(2)
      expect(block.target_process_compile_state_slices_reason_code).toBeNull()
      expect(block.target_process_jit_slices_reason_code).toBeNull()
    }
  })
})

describe('DM-7 표 자르지 않음 · 코드 단위 순', () => {
  /** 숫자가 없는 이름 n 개 — 접혀도 서로 다르게 남는다. */
  function distinctNames(n: number): string[] {
    const out: string[] = []
    for (let i = 0; out.length < n; i++) {
      let k = i
      let s = ''
      do {
        s = String.fromCharCode(97 + (k % 26)) + s
        k = Math.floor(k / 26)
      } while (k > 0)
      out.push(`slice ${s}`)
    }
    return out
  }

  it('DM-7 표 자르지 않음 · 코드 단위 순 — 행이 접은 이름 수 그대로이고 이름 길이도 원문 그대로', () => {
    const long = `startActivity: Intent { ${'cmp=com.google.android.youtube/x '.repeat(13)}}`
    expect(long.length).toBeGreaterThan(435)
    const names = [...distinctNames(12_000), long]
    const table = buildSliceTable(names.map((n) => g(n, 'other', 1, 1, 1_000, 1_000)))

    expect(table.rows).toHaveLength(names.length)
    expect(table.rows.find((r) => r.name.startsWith('startActivity'))!.name).toBe(long)
  })

  it('DM-7 표 자르지 않음 · 코드 단위 순 — 처음 순서는 UTF-16 코드 단위 순이다 (로캘 순이 아니다)', () => {
    const names = ['alpha', 'Zeta', 'é slice', '가 slice', '<missing root>', 'Beta', '_x', 'zeta']
    const table = buildSliceTable(names.map((n) => g(n, 'main', 1, 1, 1_000, 1_000)))

    // 코드 단위: '<'(3C) < 'B'(42) < 'Z'(5A) < '_'(5F) < 'a'(61) < 'z'(7A) < 'é'(E9) < '가'(AC00).
    // localeCompare 면 'alpha' 가 'Beta' · 'Zeta' 보다 앞에 오고 '_x' 가 맨 앞에 온다.
    expect(table.rows.map((r) => r.name)).toEqual(['<missing root>', 'Beta', 'Zeta', '_x', 'alpha', 'zeta', 'é slice', '가 slice'])
    expect(compareCodeUnits('Zeta', 'alpha')).toBe(-1)
  })

  it('DM-8 행 순서가 달라도 같은 표 — trace_processor 가 내는 순서에 기대지 않는다', () => {
    const rows = [
      g('b 1', 'main', 1, 1, 1_000_000, 1_000_000),
      g('a', 'async', 2, 1, 3_000_000, 3_000_000),
      g('b 2', 'main', 1, 1, 2_000_000, 2_000_000),
      g('a', 'main', 1, 1, 500_000, 500_000),
    ]
    const forward = JSON.stringify(buildSliceTable(rows))
    const backward = JSON.stringify(buildSliceTable([...rows].reverse()))
    expect(backward).toBe(forward)
  })
})

describe('DM-7 갈래 셋 · 끝나지 않은 slice', () => {
  it('DM-7 갈래 셋 · 끝나지 않은 slice — 갈래가 열로 갈리고, 빈 갈래는 null(0 이 아님)', () => {
    const table = buildSliceTable([
      g('traversal', 'main', 4, 4, 8_000_000, 3_000_000),
      g('traversal', 'other', 2, 2, 1_000_000, 600_000),
      g('first thumb complete', 'async', 3, 3, 9_000_000, 4_000_000),
    ])
    const [first, traversal] = table.rows

    expect(first).toEqual({
      name: 'first thumb complete',
      main_thread: null,
      other_threads: null,
      async_tracks: { count: 3, sum_ms: 9, max_ms: 4 },
    })
    expect(traversal).toEqual({
      name: 'traversal',
      main_thread: { count: 4, sum_ms: 8, max_ms: 3 },
      other_threads: { count: 2, sum_ms: 1, max_ms: 0.6 },
      async_tracks: null,
    })
  })

  it('DM-7 갈래 셋 · 끝나지 않은 slice — 끝나지 않은 slice 는 횟수에만 들고, 전부 안 끝났으면 합 · 최대가 null', () => {
    const table = buildSliceTable([
      // 3개 중 1개가 안 끝났다 — 합 · 최대는 끝난 2개만의 것이다.
      g('postAndWait', 'main', 3, 2, 4_000_000, 2_500_000),
      // 하나뿐이고 안 끝났다 — 길이를 모른다.
      g('Lifecycle.Started MainActivity', 'async', 1, 0, 0, null),
    ])

    expect(table.rows.find((r) => r.name === 'postAndWait')!.main_thread).toEqual({ count: 3, sum_ms: 4, max_ms: 2.5 })
    expect(table.rows.find((r) => r.name.startsWith('Lifecycle'))!.async_tracks).toEqual({
      count: 1,
      sum_ms: null,
      max_ms: null,
    })
    expect(table.slices).toBe(4)
    expect(table.unfinished).toBe(2)
  })

  it('DM-7 갈래 셋 — ms 는 ns 정수 합을 한 번만 바꾼다 (소수 셋째 자리)', () => {
    const table = buildSliceTable([g('x', 'main', 2, 2, 3_035_019_123, 75_286_400)])
    expect(table.rows[0]!.main_thread).toEqual({ count: 2, sum_ms: 3035.019, max_ms: 75.286 })
  })

  it('DM-7 갈래 셋 — 갈래는 tid = pid 면 main, 스레드 트랙이 아니면 async 다 (SQL)', () => {
    const sql = diagnoseSlicesSql(UPID, APP_PID)
    expect(sql).toContain(`when tt.id is null then 'async' when t.tid = ${APP_PID} then 'main' else 'other'`)
    expect(sql).toContain(`(t.upid = ${UPID} or pt.upid = ${UPID})`)
    // 끝나지 않은 slice(dur -1)는 세되 합 · 최대에서 뺀다.
    expect(sql).toContain('sum(s.dur >= 0)')
    expect(sql).toContain('max(case when s.dur >= 0 then s.dur end)')
  })
})

describe('DM-7 frametimeline 제외', () => {
  it('DM-7 frametimeline 제외 — 전체 수와 대상 앱 집계가 둘 다 Actual · Expected Timeline 의 slice 를 뺀다', () => {
    for (const sql of [DIAGNOSE_TOTALS_SQL, diagnoseSlicesSql(UPID, APP_PID)]) {
      expect(sql).toContain('s.id not in (select id from actual_frame_timeline_slice)')
      expect(sql).toContain('s.id not in (select id from expected_frame_timeline_slice)')
    }
    // 전체 수는 스레드 트랙 + 프로세스 트랙(비동기)이다.
    expect(DIAGNOSE_TOTALS_SQL).toContain(
      '(s.track_id in (select id from thread_track) or s.track_id in (select id from process_track))',
    )
  })
})

describe('D18 ftrace 손실 수', () => {
  it('D18 ftrace 손실 = overrun · commit_overrun · dropped_events 의 delta 합 — begin · end 를 더하지 않는다', () => {
    expect([...FTRACE_LOSS_STATS]).toEqual([
      'ftrace_cpu_overrun_delta',
      'ftrace_cpu_commit_overrun_delta',
      'ftrace_cpu_dropped_events_delta',
    ])
    expect(DIAGNOSE_TOTALS_SQL).toContain(
      "name in ('ftrace_cpu_overrun_delta', 'ftrace_cpu_commit_overrun_delta', 'ftrace_cpu_dropped_events_delta')",
    )
    expect(DIAGNOSE_TOTALS_SQL).not.toMatch(/_begin|_end/)
  })

  /**
   * **SQL 이 null 을 지키는가** — 가짜 runner 는 넣어 준 null 을 그대로 돌려주므로 TS 의 `?? null` 만
   * 시험한다. SQLite 의 `sum` 은 행이 없으면 NULL 이고 `total` 은 0.0 이다 (실 trace_processor ·
   * ftrace 가 안 돈 원본 B0: sum NULL · total 0.000). `total` · `coalesce(…, 0)` · `ifnull(…, 0)` 로
   * 바꾸면 "통계 없음" 이 "잃은 것 0" 이 된다. 실제 엔진으로 보는 시험은 아래 「실 trace_processor」.
   */
  it('D18 ftrace 통계가 없으면 null — 손실 칸은 sum 이고 0 으로 접는 함수가 없다 (SQL)', () => {
    const from = DIAGNOSE_TOTALS_SQL.indexOf("'ftrace_overrun_events', (") + "'ftrace_overrun_events', (".length
    const loss = DIAGNOSE_TOTALS_SQL.slice(from, DIAGNOSE_TOTALS_SQL.indexOf("'ftrace_cpu_stats'"))
    expect(loss).toMatch(/^select sum\(value\) from stats where name in \(/)
    expect(DIAGNOSE_TOTALS_SQL).not.toMatch(/\b(total|coalesce|ifnull)\(/)
  })

  it('D18 ftrace 손실 — 통계가 있으면 잰 값 그대로 (0 은 0 · 37 은 37)', async () => {
    expect((await extractDiagnose(input())).ftrace_overrun_events).toBe(0)
    const lost = await extractDiagnose(input({ tp: tpWith([totals({ ftrace_overrun_events: 37 }), ...HAPPY.slice(1)]) }))
    expect(lost.ftrace_overrun_events).toBe(37)
  })
})

describe('D35 ftrace 가 원본에 안 남음', () => {
  const SLICE_CELLS = [
    'trace_slices',
    'target_process_slices',
    'target_process_slices_unfinished',
    'target_process_slice_names_unfolded',
    'target_process_slice_names',
  ] as const

  it('D35 ftrace 통계 0행 — partial · ftrace_not_recorded(no_ftrace_stats) · slice 칸 null (0 · [] 아님)', async () => {
    // 실측 B0(ftrace 안 돈 원본) 모양: slice 0 · 손실 통계 없음 · CPU 통계 0행 · 켜기 오류 0.
    const block = await extractDiagnose(
      input({
        tp: tpWith([
          totals({ trace_slices: 0, ftrace_overrun_events: null, ftrace_cpu_stats: 0 }),
          ...HAPPY.slice(1),
        ]),
      }),
    )

    expect(block.status).toBe('partial')
    expect(block.reason_code).toBe('ftrace_not_recorded')
    expect(block.reason).toBe(DIAGNOSE_COPY.reasonFtraceNoStats)
    for (const key of SLICE_CELLS) expect(block[key], key).toBeNull()
    expect(block.ftrace_overrun_events).toBeNull()
    // 열림 · 범위는 트레이스와 따로 간다.
    expect(block.app_slices_open).toBe(true)
    expect(block.atrace_categories).toEqual(['am', 'wm', 'view', 'dalvik'])
  })

  /**
   * D37 — `ftrace_setup_errors` 는 atrace 실패만 세지 않는다 (실측 gfx · input 원본 B2 · B3: 오류 28 ·
   * slice 33만–38만). ftrace 가 돌았으면 잰 수 · 표를 지우지 않고, 일부가 빠졌을 수 있다는 사실만 status 로.
   */
  it('D37 · D38 ftrace 설정 오류 — partial · ftrace_setup_errors 이되 잰 수 · 표는 그대로', async () => {
    const happy = await extractDiagnose(input())
    const block = await extractDiagnose(
      input({ tp: tpWith([totals({ ftrace_setup_errors: 28, ftrace_overrun_events: 5 }), ...HAPPY.slice(1)]) }),
    )

    expect(block.status).toBe('partial')
    expect(block.reason_code).toBe('ftrace_setup_errors')
    expect(block.reason).toBe(fillCopy(DIAGNOSE_COPY.reasonFtraceSetupErrors, { count: 28 }))
    expect(block.reason).toBe('ftrace 설정 오류 28건 · slice 수 잰 그대로 · 빠진 이벤트 모름')
    for (const key of SLICE_CELLS) expect(block[key], key).toEqual(happy[key])
    expect(block.trace_slices).toBe(75_800)
    expect(block.target_process_slice_names).toHaveLength(3)
    expect(block.ftrace_overrun_events).toBe(5)
  })

  it('D37 블록 코드 하나 — 프로세스를 못 찾으면 process_not_in_trace · 이름만 낡았으면 켜기 오류가 앞선다', async () => {
    const noProcess = await extractDiagnose(
      input({ tp: tpWith([totals({ ftrace_setup_errors: 3 }), [appProcessSql(PKG, APP_PID), []]]) }),
    )
    expect(noProcess.reason_code).toBe('process_not_in_trace')
    expect(noProcess.target_process_slices).toBeNull()
    expect(noProcess.trace_slices).toBe(75_800)

    const stale = await extractDiagnose(
      input({
        tp: tpWith([
          totals({ ftrace_setup_errors: 3 }),
          [appProcessSql(PKG, APP_PID), [{ upid: UPID, pid: APP_PID, name: '<pre-initialized>' }]],
          HAPPY[2]!,
        ]),
      }),
    )
    expect(stale.status).toBe('partial')
    expect(stale.reason_code).toBe('ftrace_setup_errors')
    expect(stale.target_process_slices).toBe(6)
  })

  it('D38 통계 0행이면 켜기 오류가 있어도 ftrace_not_recorded — slice 칸 null', async () => {
    const block = await extractDiagnose(
      input({
        tp: tpWith([totals({ trace_slices: 0, ftrace_overrun_events: null, ftrace_cpu_stats: 0, ftrace_setup_errors: 4 })]),
      }),
    )
    expect(block.reason_code).toBe('ftrace_not_recorded')
    expect(block.reason).toBe(DIAGNOSE_COPY.reasonFtraceNoStats)
    for (const key of SLICE_CELLS) expect(block[key], key).toBeNull()
  })

  it('D35 켜기 오류 수를 못 읽으면(null) 그것만으로 모름이라 하지 않는다 — CPU 통계가 있으면 collected', async () => {
    const block = await extractDiagnose(input({ tp: tpWith([totals({ ftrace_setup_errors: null }), ...HAPPY.slice(1)]) }))
    expect(block.status).toBe('collected')
    expect(block.target_process_slices).toBe(6)
  })
})

/**
 * **실제 엔진으로 SQL 을 돌린다** — 위 시험은 SQL 문자열과 가짜 응답을 본다. 여기는 이 컴퓨터에
 * 고정 판 trace_processor 가 받아져 있으면(`~/.perftracker/bin`) 합성 systrace 원문(ftrace 통계가 없는
 * 원본)에 `DIAGNOSE_TOTALS_SQL` 과 `extractDiagnose` 를 그대로 돌린다. 없으면 건너뛴다 — 시험이
 * 바이너리를 내려받지 않는다.
 */
const TP_BIN = (() => {
  try {
    const bin = cachedBinaryPath(artifactFor(process.platform, process.arch))
    accessSync(bin, constants.X_OK)
    return bin
  } catch {
    return null
  }
})()

describe.skipIf(TP_BIN === null)('D18 · D35 실 trace_processor (합성 systrace · ftrace 통계 없음)', () => {
  function systrace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pt-diag-tp-'))
    const path = join(dir, 'trace.systrace')
    writeFileSync(
      path,
      '# tracer: nop\n#\n' +
        '           <...>-100   (  100) [000] ....  10.000000: tracing_mark_write: B|100|doFrame 1\n' +
        '           <...>-100   (  100) [000] ....  10.005000: tracing_mark_write: E|100\n' +
        '           <...>-101   (  100) [001] ....  10.006000: tracing_mark_write: B|100|open\n',
    )
    return path
  }

  it('D18 실 엔진 — ftrace 통계가 없는 원본에서 손실 칸이 null 이다 (total · coalesce 면 0)', async () => {
    const tp = new TraceProcessor(TP_BIN!, systrace())
    const row = await tp.queryJson<DiagnoseTotalsRow>(DIAGNOSE_TOTALS_SQL)
    expect(row.ftrace_overrun_events).toBeNull()
    expect(row.ftrace_cpu_stats).toBe(0)
    expect(row.trace_slices).toBe(2)
  })

  it('D35 실 엔진 — slice 가 있어도 ftrace 통계가 없으면 ftrace_not_recorded · slice 칸 null', async () => {
    const path = systrace()
    const block = await extractDiagnose(input({ tp: new TraceProcessor(TP_BIN!, path), tracePath: path, appPid: 100 }))
    expect(block.status).toBe('partial')
    expect(block.reason_code).toBe('ftrace_not_recorded')
    expect(block.trace_slices).toBeNull()
    expect(block.ftrace_overrun_events).toBeNull()
  })
})

/**
 * BP-7 「같은 원본을 trace_processor 로 다시 세면 둘이 같다」. ART 칸은 표 쿼리(`diagnoseSlicesSql`)의 행에서
 * 뽑으므로, 실 엔진에 그 쿼리를 돌려 만든 칸이 같은 원본을 **다른 SQL**(이름 glob 으로 직접 센 것)과 같은지 본다.
 * 원본은 합성 systrace — 대상 프로세스(100) 안 두 스레드 · 다른 프로세스(200)의 같은 이름 slice.
 * 실기기 원문(research raw-baseline B-Y-r1)으로 같은 대조를 한 결과는 intent bp-core-art 7 에 있다.
 */
describe.skipIf(TP_BIN === null)('BP-7 실 trace_processor — ART 칸을 다시 세면 같다', () => {
  function systrace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pt-art-tp-'))
    const path = join(dir, 'trace.systrace')
    const line = (tid: number, pid: number, t: number, body: string): string =>
      `           <...>-${tid}   (  ${pid}) [000] ....  ${t.toFixed(6)}: tracing_mark_write: ${body}\n`
    let text = '# tracer: nop\n#\n'
    let t = 10
    const slice = (tid: number, pid: number, name: string): void => {
      text += line(tid, pid, t, `B|${pid}|${name}`)
      text += line(tid, pid, t + 0.0005, `E|${pid}`)
      t += 0.001
    }
    slice(100, 100, LOC_YT)
    slice(100, 100, LOC_NONE)
    slice(100, 100, LOC_NONE)
    slice(101, 100, LOC_NONE)
    slice(101, 100, LOC_DM)
    for (let i = 0; i < 7; i++) slice(101, 100, `JIT compiling void Lfvb;.m${i}() (kind=Baseline) from base.apk`)
    slice(100, 100, 'JIT compiling int Lzz;.b() (kind=Optimized) from base.apk')
    slice(101, 100, 'Compiling baseline')
    slice(100, 100, 'Lfvb;')
    // 다른 프로세스 — 대상 앱 몫에 들면 안 된다.
    slice(200, 200, LOC_WEBVIEW)
    slice(200, 200, 'JIT compiling void La;.x() (kind=Baseline) from base.apk')
    // 끝나지 않은 JIT slice — 횟수에는 든다.
    text += line(101, 100, t, 'B|100|JIT compiling void Lq;.open() (kind=Baseline) from base.apk')
    writeFileSync(path, text)
    return path
  }

  it('BP-7 실 엔진 — 컴파일 상태 slice 목록 · JIT slice 수가 이름 glob 으로 직접 센 값과 같다', async () => {
    const tp = new TraceProcessor(TP_BIN!, systrace())
    const [cand] = await tp.queryJson<{ upid: number; pid: number }[]>(appProcessSql('com.x', 100))
    expect(cand!.pid).toBe(100)
    const art = buildArtCells(await tp.queryJson<SliceGroupRow[]>(diagnoseSlicesSql(cand!.upid, 100)))

    const scope =
      'from slice s left join thread_track tt on tt.id = s.track_id left join thread t on t.utid = tt.utid ' +
      'left join process_track pt on pt.id = s.track_id ' +
      `where (t.upid = ${cand!.upid} or pt.upid = ${cand!.upid})`
    const direct = await tp.queryJson<{ jit: number; locs: string[] }>(
      "select json_object('jit', (select count(*) " + scope + " and s.name glob 'JIT compiling*'), " +
        "'locs', (select json_group_array(name) from (select distinct s.name as name " + scope +
        " and s.name glob 'location=*' order by 1))) as j",
    )
    expect(art.jitSlices).toBe(direct.jit)
    expect(art.jitSlices).toBe(9)
    expect(art.compileStates.value!.map((r) => `location=${r.location} status=${r.status} filter=${r.filter} reason=${r.reason}`))
      .toEqual([...direct.locs].sort(compareCodeUnits))
    expect(art.compileStates.value).toHaveLength(3)
  })
})

describe('extractDiagnose', () => {
  it('DM-7 블록 — 켠 범위 · 수 · 원본 크기 · 표가 한 블록에 실린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-diag-'))
    const tracePath = join(dir, 'trace.perfetto-trace')
    writeFileSync(tracePath, Buffer.alloc(6_783))

    const block = await extractDiagnose(input({ tracePath }))

    expect(block).toEqual({
      atrace_categories: ['am', 'wm', 'view', 'dalvik'],
      atrace_apps: [PKG],
      status: 'collected',
      reason_code: null,
      reason: null,
      app_slices_open: true,
      app_slices_open_reason_code: null,
      app_slices_open_reason: null,
      trace_slices: 75_800,
      target_process_slices: 6,
      target_process_slices_unfinished: 0,
      ftrace_overrun_events: 0,
      trace_bytes: 6_783,
      target_process_slice_names_unfolded: 4,
      target_process_slice_names: [
        { name: 'Choreographer#doFrame *', main_thread: { count: 2, sum_ms: 12.5, max_ms: 7 }, other_threads: null, async_tracks: null },
        { name: 'RV Scroll', main_thread: { count: 3, sum_ms: 3, max_ms: 1.2 }, other_threads: null, async_tracks: null },
        { name: 'bindApplication', main_thread: { count: 1, sum_ms: 67.307, max_ms: 67.307 }, other_threads: null, async_tracks: null },
      ],
      // dalvik 이 켜졌고 프로세스를 찾았는데 그 꼴의 slice 가 없었다 — 잰 0 이다 (null 아님).
      target_process_compile_state_slices: [],
      target_process_compile_state_slices_reason_code: null,
      target_process_compile_state_slices_reason: null,
      target_process_jit_slices: 0,
      target_process_jit_slices_reason_code: null,
      target_process_jit_slices_reason: null,
    })
    expect(DiagnoseBlockSchema.parse(block)).toEqual(block)
  })

  it('DM-7 켠 범위는 session.json 기록 그대로 — 기록이 없으면 상수에서 지어내지 않고 null', async () => {
    const block = await extractDiagnose(input({ scope: null }))
    expect(block.atrace_categories).toBeNull()
    expect(block.atrace_apps).toBeNull()
  })

  it('DM-9 모름 칸 열림 null · 표 있음 — sdk 30 · debuggable false 면 열림만 null 이고 블록은 collected', async () => {
    const block = await extractDiagnose(input({ env: { sdkInt: 30, dataSources: ['linux.ftrace'] }, debuggable: false }))

    expect(block.app_slices_open).toBeNull()
    expect(block.app_slices_open_reason_code).toBe('app_slices_open_unknown')
    expect(block.app_slices_open_reason).toBe(fillCopy(DIAGNOSE_COPY.reasonNotDebuggable, { sdk: 30 }))
    expect(block.app_slices_open_reason).toBe('sdk 30 · debuggable 아님 · profileable 읽을 출처 없음')
    // 잰 프레임워크 slice 를 지우지 않는다 (결정 8) — 수 · 표는 그대로다.
    expect(block.status).toBe('collected')
    expect(block.reason_code).toBeNull()
    expect(block.target_process_slices).toBe(6)
    expect(block.target_process_slice_names).toHaveLength(3)
  })

  it('DM-9 모름 칸 열림 null — debuggable 을 못 읽었으면(null · 옛 매니페스트) debuggable 모름 문구', async () => {
    for (const debuggable of [null, undefined]) {
      const block = await extractDiagnose(input({ env: { sdkInt: 29, dataSources: ['linux.ftrace'] }, debuggable }))
      expect(block.app_slices_open).toBeNull()
      expect(block.app_slices_open_reason).toBe('sdk 29 · debuggable 모름 · profileable 읽을 출처 없음')
    }
  })

  it('DM-9 열림 true — sdk ≥31 이거나 sdk ≤30 의 debuggable 앱이면 열림 true · 이유 null', async () => {
    for (const [sdkInt, debuggable] of [
      [31, false],
      [36, null],
      [30, true],
    ] as const) {
      const block = await extractDiagnose(input({ env: { sdkInt, dataSources: ['linux.ftrace'] }, debuggable }))
      expect(block.app_slices_open, `sdk ${sdkInt}`).toBe(true)
      expect(block.app_slices_open_reason_code).toBeNull()
      expect(block.app_slices_open_reason).toBeNull()
    }
  })

  it('DM-9 프로세스 못 찾음 표 null — partial · process_not_in_trace, 대상 앱 몫 넷은 null(0행 아님) · 전체 수는 그대로', async () => {
    const block = await extractDiagnose(
      input({ tp: tpWith([HAPPY[0]!, [appProcessSql(PKG, APP_PID), []]]) }),
    )

    expect(block.status).toBe('partial')
    expect(block.reason_code).toBe('process_not_in_trace')
    expect(block.reason).toContain(PKG)
    expect(block.target_process_slices).toBeNull()
    expect(block.target_process_slices_unfinished).toBeNull()
    expect(block.target_process_slice_names_unfolded).toBeNull()
    expect(block.target_process_slice_names).toBeNull()
    expect(block.trace_slices).toBe(75_800)
    expect(block.ftrace_overrun_events).toBe(0)
    expect(block.app_slices_open).toBe(true)
  })

  it('DM-9 낡은 이름 — 트레이스가 <pre-initialized> 로 알아도 pid 로 찾으면 partial · process_name_stale_in_trace 이고 표가 있다', async () => {
    const block = await extractDiagnose(
      input({
        tp: tpWith([
          HAPPY[0]!,
          [appProcessSql(PKG, APP_PID), [{ upid: UPID, pid: APP_PID, name: '<pre-initialized>' }]],
          HAPPY[2]!,
        ]),
      }),
    )

    expect(block.status).toBe('partial')
    expect(block.reason_code).toBe('process_name_stale_in_trace')
    expect(block.reason).toContain('<pre-initialized>')
    expect(block.target_process_slices).toBe(6)
    expect(block.target_process_slice_names).toHaveLength(3)
  })

  it('DM-9 원본 없음 — failed · trace_missing, 트레이스 칸은 null 이고 열림은 sdk · debuggable 로 그대로 낸다', async () => {
    const block = await extractDiagnose(input({ tp: null, tracePath: null }))

    expect(block.status).toBe('failed')
    expect(block.reason_code).toBe('trace_missing')
    for (const key of [
      'trace_slices',
      'target_process_slices',
      'target_process_slices_unfinished',
      'ftrace_overrun_events',
      'trace_bytes',
      'target_process_slice_names_unfolded',
      'target_process_slice_names',
    ] as const) {
      expect(block[key], key).toBeNull()
    }
    // 열림은 트레이스가 아니라 조건으로 정해진다 (plan D18) — 원본이 없어도 안다.
    expect(block.app_slices_open).toBe(true)
    const unknown = await extractDiagnose(input({ tp: null, env: { sdkInt: 30, dataSources: ['linux.ftrace'] } }))
    expect(unknown.app_slices_open_reason_code).toBe('app_slices_open_unknown')
  })

  it('DM-9 쿼리 실패 — failed · query_failed, 앞서 읽은 수까지 null 로 둔다 (0 이 아님)', async () => {
    // 프로세스 집계 쿼리만 응답이 없다 — 전체 수는 읽혔어도 블록 칸을 반쯤 채워 내지 않는다.
    const block = await extractDiagnose(input({ tp: tpWith(HAPPY.slice(0, 2)) }))

    expect(block.status).toBe('failed')
    expect(block.reason_code).toBe('query_failed')
    expect(block.trace_slices).toBeNull()
    expect(block.target_process_slice_names).toBeNull()
    expect(block.app_slices_open).toBe(true)
  })

  it('DM-9 linux.ftrace 미등록 — unsupported, 트레이스의 slice 0개를 "없었다" 로 내지 않는다', async () => {
    const block = await extractDiagnose(
      input({
        env: { sdkInt: 36, dataSources: ['linux.process_stats', 'linux.sys_stats'] },
        tp: tpWith([totals({ trace_slices: 0, ftrace_overrun_events: null, ftrace_cpu_stats: 0 }), ...HAPPY.slice(1)]),
      }),
    )

    expect(block.status).toBe('unsupported')
    expect(block.reason_code).toBe('data_source_not_registered')
    expect(block.reason).toContain('linux.ftrace')
    expect(block.trace_slices).toBeNull()
    expect(block.target_process_slice_names).toBeNull()
  })
})
