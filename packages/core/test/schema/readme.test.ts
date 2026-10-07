import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appProcessSql } from '../../src/collectors/appProcess.js'
import { COLLECTORS } from '../../src/collectors/registry.js'
import {
  DIAGNOSE_TOTALS_SQL,
  type DiagnoseExtractInput,
  diagnoseSlicesSql,
  extractDiagnose,
  FTRACE_LOSS_STATS,
  foldSliceName,
} from '../../src/extract/diagnose.js'
import { DIAGNOSE_ATRACE_CATEGORIES, DIAGNOSE_MAX_DURATION_MS } from '../../src/perfetto/config.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { METRIC_REASON_CODES, renderReason } from '../../src/schema/reasons.js'
import { APP_SLICE_MIN_SDK, appSliceOpen } from '../../src/session/diagnose.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'
import {
  DiagnoseBlockSchema,
  ResultSchema,
  SCHEMA_VERSION,
  SliceBranchStatsSchema,
  SliceNameRowSchema,
} from '../../src/schema/result.js'

/**
 * README 가 스키마에 대해 **숫자로** 말하는 것들을 코드와 대조한다.
 *
 * 왜 이 파일이 있는가: 이 저장소는 같은 문장이 **두 번** 낡은 전적이 있다.
 * `reason_code` 개수는 M2 리뷰에서 6 → 21 로 고쳤는데 M3 가 30 으로 넓히는 동안 21 그대로
 * 남았다. 사람이 고치기로 한 규칙은 이미 두 번 실패했으므로 세 번째로 같은 규칙을 세우지
 * 않는다.
 *
 * 이 저장소가 같은 문제에 이미 쓰고 있는 해법을 문서에 적용한 것이다:
 * `insufficient_samples` 문장이 `POLL_PERIOD_MS` 를 읽고 `sdk_too_low` 가
 * `ANDROID_RELEASE_BY_SDK` 를 읽는 것 — **진실의 출처를 하나로 두고 나머지는 거기서
 * 끌어온다.** 마크다운은 런타임에 상수를 읽을 수 없으므로, 그 자리를 테스트가 대신한다.
 *
 * **숫자를 아예 빼는 선택지도 있었고 택하지 않았다.** 그 숫자는 장식이 아니라 소비자의
 * 유일한 자가진단 손잡이다: `1.1.0` 산출물끼리는 `schema_version` 이 같아서, 캐시해 둔 스키마가
 * 낡았는지 확인할 방법은 "내 파일의 enum 개수를 세어 이 숫자와 비교" 밖에 없다.
 * 숫자를 빼면 "그냥 다시 꺼내 보라" 만 남는다 — 확인이 아니라 권유다.
 *
 * 문장을 다시 쓰면 이 테스트가 "찾지 못했다" 로 실패한다. 그것이 의도한 동작이다 —
 * 고정된 문장을 고칠 때는 이 대조가 여전히 성립하는지 사람이 한 번 봐야 한다.
 */
const README = readFileSync(fileURLToPath(new URL('../../../../README.md', import.meta.url)), 'utf8')
const STATUS = readFileSync(fileURLToPath(new URL('../../../../docs/STATUS.md', import.meta.url)), 'utf8')
const CORE_AGENTS = readFileSync(fileURLToPath(new URL('../../AGENTS.md', import.meta.url)), 'utf8')
const RESULT_TS = readFileSync(fileURLToPath(new URL('../../src/schema/result.ts', import.meta.url)), 'utf8')

/** `### <제목>` 절 하나 — 다음 `## ` · `### ` 머리 전까지. */
function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`)
  if (start < 0) return ''
  const rest = README.slice(start + heading.length + 2)
  const end = rest.search(/\n#{2,3} /)
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * 절 안에서 머리가 `| 필드 |` 인 표들의 첫 칸에 적힌 이름 전부. 한 칸에 `` `a` · `b` `` 처럼
 * 여럿이 있으면 다 센다. 표가 목록으로 말하는 것을 코드와 대조하는 데 쓴다.
 */
function fieldColumn(text: string): string[] {
  const names: string[] = []
  let inTable = false
  for (const line of text.split('\n')) {
    if (line.startsWith('| 필드 |')) {
      inTable = true
      continue
    }
    if (!line.startsWith('|')) {
      inTable = false
      continue
    }
    if (!inTable || line.startsWith('| ---')) continue
    const first = line.split('|')[1] ?? ''
    for (const m of first.matchAll(/`([^`]+)`/g)) names.push(m[1]!)
  }
  return names
}

/**
 * **지표 목록이 두 번 낡았다.** `metrics.frame` 을 접은 커밋이 README 를 136줄 줄였는데
 * 머리말의 표에는 `frame` 행이 남았고, 개수는 `지표 8개` 그대로였다. 링크(`#metricsframe`)는
 * 가리키는 절이 없어 죽어 있었는데 **아무 테스트도 그것을 몰랐다** — 이 파일은 그때
 * `reason_code` 개수와 `schema_version` 만 보고 있었다.
 *
 * npm 에 내면 이 README 가 그대로 패키지 페이지가 된다. 틀린 지표 목록은 이제 밖으로 나간다.
 */
describe('README 의 지표 목록', () => {
  const ids = COLLECTORS.map((c) => c.id)

  it('개수를 코드와 대조한다', () => {
    const m = /## 무엇을 재는가 — 지표 (\d+)개/.exec(README)
    expect(m, 'README 에서 지표 개수 문장을 찾지 못했다 — 문구를 바꿨다면 이 테스트도 함께 고칠 것').not.toBeNull()
    expect(Number(m![1])).toBe(ids.length)
  })

  it('등록된 지표가 전부 표에 있다', () => {
    const missing = ids.filter((id) => !README.includes(`[\`${id}\`](#metrics${id})`))
    expect(missing, 'README 표에 없는 지표').toEqual([])
  })
})

describe('README 가 스키마에 대해 말하는 숫자', () => {
  it('reason_code 개수가 METRIC_REASON_CODES 와 같다', () => {
    const m = /이 버전의 reason_code 값은 \*\*(\d+)개\*\*/.exec(README)
    expect(m, 'README 에서 reason_code 개수 문장을 찾지 못했다 — 문구를 바꿨다면 이 테스트도 함께 고칠 것').not.toBeNull()
    expect(Number(m![1])).toBe(METRIC_REASON_CODES.length)
  })

  it('schema_version 이 SCHEMA_VERSION 과 같다', () => {
    const m = /`schema_version` 이 그 계약의 버전입니다 \(현재 `([^`]+)`\)/.exec(README)
    expect(m, 'README 에서 schema_version 문장을 찾지 못했다').not.toBeNull()
    expect(m![1]).toBe(SCHEMA_VERSION)
  })

  /**
   * 숫자가 아니라 **사실**의 고정. `1.1.0` 시절 중간에 스키마를 캐시한 소비자가 깨지는 경로는
   * 셋이고 서로 독립적인데, `1.1.0` 산출물끼리는 `schema_version` 이 같아 다시 꺼내라는 신호가
   * 없다. 그 설명이 README 에서 사라지면 소비자는 조용히 깨진다. `1.2.0` 부터는 버전이 신호이고,
   * 진단 세션 산출물이 `1.1.0` 스키마에 걸리는 자리도 함께 적혀 있어야 한다 (DM-6).
   */
  it('캐시된 스키마가 깨지는 경로를 README 가 다 말한다 — 1.1.0 안의 셋과 1.2.0 의 진단 키', () => {
    const section = README.slice(README.indexOf('### 스키마를 다시 꺼내야 하는 때'))
    expect(section.length, '"스키마를 다시 꺼내야 하는 때" 절이 없다').toBeGreaterThan(0)

    // 경로 1 — thermal_zones 항목이 닫힌 객체다.
    expect(section).toContain('thermal_zones')
    expect(section).toContain('additionalProperties: false')
    // 경로 2 — reason_code 가 닫힌 enum 이다.
    expect(section).toContain('reason_code')
    // 경로 3 — cpu / log 의 필드 이름이 바뀌었다. 이름이 바뀐 것은 소비자가 **즉시** 알아야
    // 하는 종류의 변경이고(옛 이름을 읽으면 undefined 다), 그 사실이 여기 없으면
    // `schema_version` 이 같은 1.1.0 산출물끼리는 신호가 하나도 없다.
    expect(section).toContain('device_total_busy_pct')
    expect(section).toContain('log.device_total')
    // 그리고 왜 1.1.0 끼리는 신호가 없는지.
    expect(section).toContain('schema_version')
    expect(section).toMatch(/신호가 산출물 안에\s*\n?존재하지 않습니다/)
    // 1.2.0 부터는 버전이 신호이고, 진단 세션 산출물이 1.1.0 스키마에 걸리는 자리.
    expect(section).toContain('`1.2.0` 부터는 `schema_version` 이 신호입니다')
    expect(section).toContain('`diagnose` 키와 `options.diagnose`')
  })
})

describe('DM-6 schema_version 1.2.0', () => {
  it('DM-6 schema_version 1.2.0 — 1.1.0 은 출시됐으므로 진단 자리를 더한 지금은 1.2.0 이다', () => {
    expect(SCHEMA_VERSION).toBe('1.2.0')
  })

  /**
   * `1.1.0` 은 npm 0.1.0 ~ 0.2.1 로 나갔다. "출시된 적이 없다" 는 문장이 남으면 버전을 올리지
   * 않을 근거가 다시 생긴다 — 그 문장이 바로 1.1.0 안에서 계약을 넓히던 근거였다.
   */
  it('DM-6 schema_version 1.2.0 — "1.1.0 은 출시된 적이 없다" 는 문장이 코드 · README · STATUS 에 0', () => {
    const claim = /1\.1\.0[^\n]{0,40}(?:\n[^\n]{0,40})?출시된 적이 없/
    for (const [where, text] of [
      ['README.md', README],
      ['docs/STATUS.md', STATUS],
      ['packages/core/AGENTS.md', CORE_AGENTS],
      ['packages/core/src/schema/result.ts', RESULT_TS],
    ] as const) {
      expect(claim.exec(text)?.[0] ?? null, where).toBeNull()
    }
    expect(CORE_AGENTS).not.toContain('미출시 동안 올리지 않는다')
  })

  it('DM-6 README 최상위 구조 표가 ResultSchema 의 최상위 키와 같다 — diagnose 가 표에 있다', () => {
    const listed = fieldColumn(section('### 최상위 구조'))
    expect(listed.length, '「최상위 구조」 표를 찾지 못했다').toBeGreaterThan(0)
    expect([...listed].sort()).toEqual(Object.keys(ResultSchema.shape).sort())
  })
})

describe('DM-7 README 진단 블록 절', () => {
  it('DM-7 README 진단 블록 절의 필드 표가 스키마의 필드와 양방향으로 같다', () => {
    const listed = fieldColumn(section('### `diagnose`'))
    expect(listed.length, 'README 에서 「`diagnose`」 절의 필드 표를 찾지 못했다').toBeGreaterThan(0)
    const inSchema = [
      ...Object.keys(DiagnoseBlockSchema.shape),
      ...Object.keys(SliceNameRowSchema.shape),
      ...Object.keys(SliceBranchStatsSchema.shape),
    ]
    expect(listed.filter((k) => !inSchema.includes(k)), 'README 에만 있는 필드').toEqual([])
    expect(inSchema.filter((k) => !listed.includes(k)), '스키마에만 있는 필드').toEqual([])
  })

  it('DM-7 README 진단 블록 절이 합 ms 와 갈래 · 접기 · 순서 규칙을 말한다', () => {
    const text = section('### `diagnose`')
    expect(text).toContain('`sum_ms` 를 행끼리 더하지 마세요')
    expect(text).toContain('프레임워크 slice(am · wm · view)와 앱 slice 를 가르지 않습니다')
    expect(text).toContain('frametimeline')
    expect(text).toContain('UTF-16 코드 단위 순')
    expect(text).toContain('`app_slices_open_unknown`')
  })
})

describe('DM-14 README measurement_overhead', () => {
  it('DM-14 README measurement_overhead 절이 진단 세션 한정을 말한다', () => {
    const text = section('### `measurement_overhead`')
    expect(text).toContain('atrace slice 비용이 앱 프로세스에 청구되어')
    expect(text).toContain('평소 세션과 수치를 나란히 놓을 수 없습니다')
  })
})

/**
 * README `diagnose` 절이 코드에 대해 **목록 · 표로** 말하는 것 전부를 코드와 대조한다 (명세 검수 #1).
 * 필드 표 둘은 위 `DM-7 README 진단 블록 절` 이 본다. 여기는 그 밖 — 상태 표 · 열림 조건 표 · 접기 예 ·
 * 손실 통계 이름 · 카테고리 · 최대 시간 · 예시 JSON. 하나라도 코드와 어긋나면 README 가 조용히 낡는다.
 */
describe('DM-9 README 진단 절 ↔ 코드', () => {
  const DIAG = section('### `diagnose`')
  const PKG = 'com.example.app'
  const PID = 4242
  const UPID = 7
  const TRACE = '/tmp/readme-diag.pftrace'
  const OK_TOTALS = { trace_slices: 10, ftrace_overrun_events: 0, ftrace_cpu_stats: 96, ftrace_setup_errors: 0 }
  const PROC = [{ upid: UPID, pid: PID, name: PKG }]
  const GROUPS = [{ name: 'RV Scroll', branch: 'main', count: 1, finished: 1, sum_ns: 1_000, max_ns: 1_000 }]
  /** 원본 파일 — trace_bytes 가 잰 값이 되게. */
  const tracePath = (() => {
    const p = join(mkdtempSync(join(tmpdir(), 'pt-readme-')), 'trace.perfetto-trace')
    writeFileSync(p, 'fake')
    return p
  })()

  function tp(responses: [string, unknown][]): TraceProcessor {
    const runner = new FakeProcessRunner()
    for (const [sql, v] of responses) runner.on(`query ${TRACE} ${sql}`, { stdout: `"j"\n"${JSON.stringify(v)}"\n` })
    return new TraceProcessor('/bin/tp', TRACE, runner)
  }
  function input(over: Partial<DiagnoseExtractInput>): DiagnoseExtractInput {
    return {
      tp: tp([
        [DIAGNOSE_TOTALS_SQL, OK_TOTALS],
        [appProcessSql(PKG, PID), PROC],
        [diagnoseSlicesSql(UPID, PID), GROUPS],
      ]),
      tracePath,
      packageName: PKG,
      appPid: PID,
      env: { sdkInt: 36, dataSources: ['linux.ftrace'] },
      debuggable: false,
      scope: { atraceCategories: ['am', 'wm', 'view'], atraceApps: [PKG] },
      ...over,
    }
  }

  /** README 상태 표의 줄마다 그 상태를 내는 입력. 키 = `status|reason_code`. */
  const SCENARIOS: Record<string, DiagnoseExtractInput> = {
    'collected|null': input({}),
    'partial|process_not_in_trace': input({ tp: tp([[DIAGNOSE_TOTALS_SQL, OK_TOTALS], [appProcessSql(PKG, PID), []]]) }),
    'partial|process_name_stale_in_trace': input({
      tp: tp([
        [DIAGNOSE_TOTALS_SQL, OK_TOTALS],
        [appProcessSql(PKG, PID), [{ upid: UPID, pid: PID, name: '<pre-initialized>' }]],
        [diagnoseSlicesSql(UPID, PID), GROUPS],
      ]),
    }),
    'partial|ftrace_not_recorded': input({
      tp: tp([[DIAGNOSE_TOTALS_SQL, { ...OK_TOTALS, trace_slices: 0, ftrace_overrun_events: null, ftrace_cpu_stats: 0 }]]),
    }),
    'partial|ftrace_setup_errors': input({
      tp: tp([
        [DIAGNOSE_TOTALS_SQL, { ...OK_TOTALS, ftrace_setup_errors: 2 }],
        [appProcessSql(PKG, PID), PROC],
        [diagnoseSlicesSql(UPID, PID), GROUPS],
      ]),
    }),
    'unsupported|data_source_not_registered': input({ env: { sdkInt: 36, dataSources: ['linux.sys_stats'] } }),
    'failed|trace_missing': input({ tp: null, tracePath: null }),
    'failed|query_failed': input({ tp: tp([[DIAGNOSE_TOTALS_SQL, OK_TOTALS]]) }),
  }
  const CELLS = [
    'trace_slices',
    'target_process_slices',
    'target_process_slices_unfinished',
    'ftrace_overrun_events',
    'trace_bytes',
    'target_process_slice_names_unfolded',
    'target_process_slice_names',
  ] as const

  /** 머리가 `head` 로 시작하는 표의 줄들 — 칸마다 문자열. */
  function tableRows(text: string, head: string): string[][] {
    const lines = text.split('\n')
    const start = lines.findIndex((l) => l.startsWith(head))
    if (start < 0) return []
    const rows: string[][] = []
    for (const line of lines.slice(start + 2)) {
      if (!line.startsWith('|')) break
      rows.push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    }
    return rows
  }
  const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)

  it('DM-9 README 상태 표 ↔ extractDiagnose — 줄마다 status · reason_code · null 이 되는 칸이 코드와 같고, 빠진 상태가 없다', async () => {
    const rows = tableRows(DIAG, '| `status` | `reason_code` |')
    expect(rows.length, 'README 에서 상태 표를 찾지 못했다').toBeGreaterThan(0)

    const listed: string[] = []
    for (const [statusCell, codeCell, nullCell] of rows) {
      const status = ticks(statusCell!)[0]!
      const [code, ...rest] = ticks(codeCell!)
      const detail = Object.fromEntries(rest.map((t) => t.split(': ') as [string, string]))
      const key = `${status}|${code}`
      listed.push(key)
      const scenario = SCENARIOS[key]
      expect(scenario, `README 상태 표의 줄 ${key} 에 맞는 경우가 코드에 없다`).toBeDefined()

      const block = await extractDiagnose(scenario!)
      expect(block.status, key).toBe(status)
      expect(block.reason_code, key).toBe(code === 'null' ? null : code)
      if (code === 'ftrace_not_recorded' || code === 'ftrace_setup_errors') {
        expect(block.reason, key).toBe(renderReason({ code, detail: { setup_errors: 2 } }))
      }
      if (detail['data_source'] !== undefined) expect(block.reason, key).toContain(detail['data_source'])
      const nulls = CELLS.filter((c) => block[c] === null)
      const claimed = nullCell === '없음' ? [] : ticks(nullCell!)
      expect([...claimed].sort(), `${key} 의 null 이 되는 칸`).toEqual([...nulls].sort())
    }
    expect(Object.keys(SCENARIOS).filter((k) => !listed.includes(k)), 'README 상태 표에 없는 경우').toEqual([])
  })

  /**
   * D38 · 2차 검수 #1 — 블록은 `reason_code` · `reason` 만 내고 detail 을 싣지 않는다. README 가 갈래를
   * `detail.cause` 로 가르라고 하면 result.json 에 없는 필드를 말하는 것이다.
   */
  it('D38 README 진단 절이 result.json 에 없는 detail · cause 로 가르라고 하지 않는다', () => {
    expect(DIAG).not.toMatch(/\bcause\b|detail\./)
    expect(Object.keys(DiagnoseBlockSchema.shape)).not.toContain('detail')
  })

  it('DM-9 README 열림 조건 표 ↔ appSliceOpen — 경계 sdk 와 debuggable 마다 같은 값', () => {
    const rows = tableRows(DIAG, '| 기기 · 앱 | `app_slices_open` |')
    expect(rows).toHaveLength(3)
    const [open, debug, unknown] = rows

    const atLeast = Number(/^sdk ≥(\d+)$/.exec(open![0]!)?.[1])
    expect(atLeast).toBe(APP_SLICE_MIN_SDK)
    expect(ticks(open![1]!)).toEqual(['true'])
    for (const d of [false, null, true]) expect(appSliceOpen(atLeast, d).open).toBe(true)

    const below = Number(/^sdk ≤(\d+) · `debuggable: true`$/.exec(debug![0]!)?.[1])
    expect(below).toBe(APP_SLICE_MIN_SDK - 1)
    expect(ticks(debug![1]!)).toEqual(['true'])
    expect(appSliceOpen(below, true).open).toBe(true)

    const belowUnknown = Number(/^sdk ≤(\d+) · `debuggable` 이 `false` 또는 `null`$/.exec(unknown![0]!)?.[1])
    expect(belowUnknown).toBe(APP_SLICE_MIN_SDK - 1)
    expect(ticks(unknown![1]!).slice(0, 2)).toEqual(['null', 'app_slices_open_unknown'])
    for (const d of [false, null]) expect(appSliceOpen(belowUnknown, d).open).toBeNull()
  })

  it('DM-7 README 접기 예 ↔ foldSliceName — 「A → B」 마다 foldSliceName(A) 가 B', () => {
    const bullet = /- \*\*이름 접기\*\*[\s\S]*?(?=\n- )/.exec(DIAG)?.[0] ?? ''
    const pairs = [...bullet.matchAll(/`([^`]+)`\s*→\s*`([^`]+)`/g)].map((m) => [m[1]!, m[2]!] as const)
    expect(pairs.length, 'README 「이름 접기」 의 예를 찾지 못했다').toBeGreaterThanOrEqual(4)
    for (const [raw, folded] of pairs) expect(foldSliceName(raw), raw).toBe(folded)
    // 숫자 없는 토큰이 그대로라는 예가 있어야 한다 — 접기의 경계를 말하는 예다.
    expect(pairs.some(([raw, folded]) => raw === folded)).toBe(true)
  })

  it('DM-7 README 손실 통계 이름 ↔ FTRACE_LOSS_STATS', () => {
    const bullet = /- \*\*`ftrace_overrun_events`\*\*[\s\S]*?(?=\n- |\n\n)/.exec(DIAG)?.[0] ?? ''
    const names = ticks(bullet).filter((t) => t.startsWith('ftrace_cpu_'))
    expect(names).toEqual([...FTRACE_LOSS_STATS])
  })

  it('DM-7 README 진단 절의 카테고리 · 최대 시간 ↔ DIAGNOSE_ATRACE_CATEGORIES · DIAGNOSE_MAX_DURATION_MS', () => {
    const cats = /카테고리 ((?:`[a-z]+` · )*`[a-z]+`)/.exec(DIAG)?.[1] ?? ''
    expect(ticks(cats)).toEqual([...DIAGNOSE_ATRACE_CATEGORIES])
    const minutes = Number(/최대 (\d+)분/.exec(DIAG)?.[1])
    expect(minutes * 60_000).toBe(DIAGNOSE_MAX_DURATION_MS)
  })

  it('DM-7 README 예시 JSON ↔ DiagnoseBlockSchema — 모든 필드가 순서대로 있고 스키마를 그대로 통과한다', () => {
    const json = /```json\n([\s\S]*?)\n```/.exec(DIAG)?.[1]
    expect(json, 'README 진단 절에서 예시 JSON 을 찾지 못했다').toBeDefined()
    const example = JSON.parse(json!) as Record<string, unknown>
    expect(Object.keys(example)).toEqual(Object.keys(DiagnoseBlockSchema.shape))
    // 스키마가 모르는 키는 parse 가 지운다 — 지운 것이 있으면 같지 않다.
    expect(DiagnoseBlockSchema.parse(example)).toEqual(example)
  })
})

describe('DM-6 README 1.1.0 역사', () => {
  /**
   * 코드 검수 #4. 1.1.0 은 npm 0.1.0(2026-08-20 · reason_code 35개 · metrics.frame 없음) 뒤 0.2.0
   * (2026-08-31)이 같은 1.1.0 으로 metrics.frame 과 no_frames 를 더했다 (git 2ee8198 · 4a68127).
   * "출시 전에만 넓혔다" · "출시 뒤 첫 확장" 은 그 사실과 다르다.
   */
  it('DM-6 1.1.0 역사 — 0.2.0 이 같은 1.1.0 으로 frame · no_frames 를 더한 사실이 있고, "첫 확장" 단정이 없다', () => {
    const cache = section('### 스키마를 다시 꺼내야 하는 때')
    expect(cache).toContain('0.2.0(2026-08-31)이 같은 `1.1.0` 으로 `metrics.frame` 과 `no_frames` 를 더했습니다')
    for (const [where, text] of [
      ['README.md', README],
      ['docs/STATUS.md', STATUS],
      ['packages/core/src/schema/result.ts', RESULT_TS],
    ] as const) {
      expect(text, where).toContain('no_frames')
      expect(text, where).not.toMatch(/첫 확장|첫 적용|출시 전 개발 중에 계약이|그 전 개발 중에/)
    }
  })
})
