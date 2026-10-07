import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DiagnoseBlockSchema,
  renderReason,
  SliceBranchStatsSchema,
  SliceNameRowSchema,
} from '@perftracker/core'
import { computeMaxT, type Mark, readMarks } from '../src/web/report/axis.js'
import {
  badgeOf,
  blockState,
  buildBars,
  buildDelta,
  buildDistribution,
  buildFrameTimeline,
  buildPairs,
  buildSeries,
  buildStat,
  cardUnit,
  FPAD,
  type FrameTimelineVm,
  metricState,
  timeTicks,
  NO_DELTA,
  type NoneVm,
  type PairsVm,
  type SeriesVm,
  VITALS_SLOW_FRAME_MS,
} from '../src/web/report/blocks.js'
import { fmtValue, NONE_MISSING, NONE_NULL, STATUS_LABEL } from '../src/web/report/format.js'
import { buildHeader, isDiagnoseSession, tabsFor } from '../src/web/report/header.js'
import { MANIFEST, NOT_DRAWN_METRICS, SECTIONS } from '../src/web/report/manifest.js'
import { MISSING, readPath } from '../src/web/report/read.js'
import {
  ariaSort,
  buildSliceTable,
  INITIAL_SORT,
  nextSort,
  type SliceSort,
  type SliceTableVm,
  sortMark,
  sortSliceRows,
} from '../src/web/report/slices.js'
import type {
  BarsBlock,
  DeltaBlock,
  DistributionBlock,
  FrameTimelineBlock,
  PairsBlock,
  SeriesBlock,
  SliceTableBlock,
  StatBlock,
} from '../src/web/report/manifest.js'

/**
 * **실기기 표본 셋을 그대로 읽는다.** 셋 다 오류 없이 그려져야 하고, 특히 `low-end` 는
 * 지표 둘이 통째로 없고 `cpu.data.app` 이 `null` 이라 이 화면의 규칙을 가장 많이 건드린다.
 */
const sample = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../docs/design/report/samples/${name}.json`, import.meta.url)),
      'utf8',
    ),
  )

const FULL = sample('full')
const LEGACY = sample('legacy')
const LOWEND = sample('low-end')

const block = <T>(title: string): T => MANIFEST.find((b) => b.title === title) as T

/**
 * 빌더의 규칙을 보는 테스트는 매니페스트 카드가 아니라 이 블록을 쓴다 — 카드가 어느 경로를
 * 보든 "버킷을 접지 않는다" 같은 규칙은 같아야 한다.
 */
const TRACE_DIST: DistributionBlock = {
  kind: 'distribution', section: 'render', title: '분포(테스트용)',
  metric: 'hwui', span: 12,
  path: 'metrics.hwui.data.histogram',
  percentilesPath: 'metrics.hwui.data.percentiles',
  breakAfterEmptyBuckets: Infinity,
}

describe('readPath — 세 상태를 가른다', () => {
  it('필드가 없으면 MISSING', () => {
    expect(readPath({ a: 1 }, 'b')).toBe(MISSING)
    expect(readPath({ a: { b: 1 } }, 'a.c')).toBe(MISSING)
  })

  it('값이 null 이면 null — MISSING 이 아니다', () => {
    expect(readPath({ a: null }, 'a')).toBeNull()
  })

  /**
   * **이 테스트가 이 파일의 이유다.** `cur[seg] === undefined` 로 판정하면 두 상태가 같아지고,
   * 화면은 "이 도구가 원래 안 재는 것" 과 "이 세션에서 못 쟀다" 를 같은 회색으로 그린다.
   */
  it('MISSING 과 null 이 서로 다른 문장이 된다', () => {
    expect(fmtValue(MISSING, 'int')).toBe(NONE_MISSING)
    expect(fmtValue(null, 'int')).toBe(NONE_NULL)
    expect(NONE_MISSING).not.toBe(NONE_NULL)
  })

  it('중간이 null 이면 그 아래는 MISSING 이다', () => {
    expect(readPath({ a: null }, 'a.b')).toBe(MISSING)
  })
})

describe('표본 셋이 전부 렌더된다', () => {
  for (const [name, doc] of [['full', FULL], ['legacy', LEGACY], ['low-end', LOWEND]] as const) {
    it(`${name} — 모든 블록이 던지지 않는다`, () => {
      const marks = readMarks(doc)
      const maxT = computeMaxT(doc, marks)
      for (const b of MANIFEST) {
        expect(() => {
          if (b.kind === 'series') buildSeries(b, doc, maxT, marks, null)
          else if (b.kind === 'distribution') buildDistribution(b, doc, 900)
          else if (b.kind === 'frametimeline') buildFrameTimeline(b, doc, maxT, marks, null)
          else if (b.kind === 'bars') buildBars(b, doc)
          else if (b.kind === 'delta') buildDelta(b, doc)
          else if (b.kind === 'pairs') buildPairs(b, doc)
          else if (b.kind === 'slicetable') buildSliceTable(b, doc)
          else buildStat(b, doc)
        }, `${name} / ${b.title}`).not.toThrow()
      }
      expect(() => buildHeader(doc)).not.toThrow()
    })
  }

  it('매니페스트의 모든 section 이 SECTIONS 에 있다 — 블록이 어느 탭에도 안 걸리면 사라진다', () => {
    const known = new Set(SECTIONS.map((s) => s.id))
    for (const b of MANIFEST) expect(known.has(b.section), b.title).toBe(true)
  })
})

describe('low-end — 못 잰 것을 숨기지 않는다', () => {
  /**
   * **sdk 30 에서도 분포가 나온다.** `hwui` 는 `dumpsys gfxinfo` 에서 와서 버전 하한이 없다 —
   * 렌더를 트레이스로만 재던 시절 이 기기는 분포가 통째로 비었다.
   */
  it('sdk 30 기기에서도 분포가 그려진다', () => {
    const vm = buildDistribution(block<DistributionBlock>('프레임 시간 분포'), LOWEND, 900)
    expect((vm as NoneVm).none).toBeUndefined()
    expect((vm as { bars: unknown[] }).bars.length).toBeGreaterThan(0)
  })

  /**
   * 지표 하나 안에서 **반쪽만** 못 잰 상태다. 앱 CPU 를 0% 로 그리면 그 화면은 거짓말이고,
   * 기기 CPU 까지 같이 죽이면 있는 데이터를 버리는 것이다.
   */
  it('cpu.data.app 이 null 이어도 기기 CPU 는 그려진다', () => {
    const marks = readMarks(LOWEND)
    const maxT = computeMaxT(LOWEND, marks)
    const app = buildSeries(block<SeriesBlock>('앱 CPU'), LOWEND, maxT, marks, null)
    const dev = buildSeries(block<SeriesBlock>('기기 CPU'), LOWEND, maxT, marks, null)

    expect((app as NoneVm).none).toBe(true)
    expect((dev as NoneVm).none).toBeUndefined()
    expect((dev as SeriesVm).segments.length).toBeGreaterThan(0)
  })

  /**
   * 헤더에 플래그 줄이 없어졌으므로, 같은 사실이 **제자리에서** 읽히는지 본다.
   * 그 자리가 비면 화면이 자기가 못 잰 것을 숨긴 셈이 된다.
   */
  it('미수집 지표는 카드 배지로 닿는다', () => {
    expect(metricState(LOWEND, 'network').status).toBe('unsupported')
  })

  it('debuggable 은 기기 탭 앱 표에 있다', () => {
    const vm = buildPairs(block<PairsBlock>('앱'), LOWEND)
    const row = (vm as { rows: { label: string; value: string }[] }).rows
      .find((r) => r.label === 'debuggable')
    expect(row?.value).toBe('예')
  })

  it('주사율이 null 이면 화면 표에 "값 없음" 으로 뜬다 — 0Hz 가 아니다', () => {
    const vm = buildPairs(block<PairsBlock>('화면'), LOWEND)
    const row = (vm as { rows: { label: string; value: string }[] }).rows
      .find((r) => r.label === '주사율')
    expect(row?.value).toBe(NONE_NULL)
  })
})

describe('legacy — 새 필드가 없는 세션', () => {
  const dbg = (doc: unknown): string | undefined =>
    (buildPairs(block<PairsBlock>('앱'), doc) as { rows: { label: string; value: string }[] })
      .rows.find((r) => r.label === 'debuggable')?.value

  /** `false`(릴리스 확인)와 `수집 안 함`(모름)이 같은 문장이 되면 안 된다. */
  it('필드가 없으면 false 가 아니라 "수집 안 함" 이다', () => {
    expect(dbg(LEGACY)).toBe(NONE_MISSING)
    expect(dbg(FULL)).toBe('아니오')
    expect(dbg(LOWEND)).toBe('예')
  })
})

describe('경고 — 헤더가 아니라 데이터 블록이다', () => {
  it('있으면 code 와 message 로 낸다', () => {
    const vm = buildPairs(block<PairsBlock>('경고'), FULL)
    const rows = (vm as { rows: { label: string; value: string }[] }).rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.label).toMatch(/^[a-z_]+$/)
  })

  /** 빈 배열은 "재 봤더니 없었다" 다 — `수집 안 함` 이 아니다. */
  it('빈 배열은 "경고 없음" 이고 필드 부재와 다르다', () => {
    expect((buildPairs(block<PairsBlock>('경고'), { warnings: [] }) as NoneVm).label).toBe('경고 없음')
    expect((buildPairs(block<PairsBlock>('경고'), {}) as NoneVm).label).toContain(NONE_MISSING)
  })
})

describe('시계열 — null 인 초에서 선을 끊는다', () => {
  const seriesBlock: SeriesBlock = {
    kind: 'series', section: 'cpu', title: 't', span: 6,
    path: 'p', field: 'v', sampling: 'gauge', baseline: 'zero', fmt: 'n0',
  }
  const doc = (rows: unknown[]): unknown => ({ p: rows })

  it('빠진 초에서 조각이 갈라진다 — 이으면 안 잰 구간에 직선이 그어진다', () => {
    const vm = buildSeries(
      seriesBlock,
      doc([{ t_s: 0, v: 1 }, { t_s: 1, v: 2 }, { t_s: 3, v: 3 }, { t_s: 4, v: 4 }]),
      4, [], null,
    ) as SeriesVm

    expect(vm.segments).toHaveLength(2)
    expect(vm.gaps).toHaveLength(1)
  })

  it('점 하나짜리 조각은 버리지 않고 점으로 남긴다', () => {
    const vm = buildSeries(
      seriesBlock, doc([{ t_s: 0, v: 1 }, { t_s: 2, v: 5 }]), 2, [], null,
    ) as SeriesVm

    expect(vm.segments).toHaveLength(0)
    expect(vm.singletons).toHaveLength(2)
  })

  /**
   * 누적 카운터는 0초가 없는 것이 **정상**이다 — 앞에 뺄 표본이 없어서다.
   * 그것을 결측으로 세면 모든 cumulative 계열의 왼쪽 끝에 회색 띠가 생긴다.
   */
  it('cumulative 는 0초를 빠진 것으로 세지 않는다', () => {
    const rows = [{ t_s: 1, v: 1 }, { t_s: 2, v: 2 }]
    const gauge = buildSeries(seriesBlock, doc(rows), 2, [], null) as SeriesVm
    const cum = buildSeries(
      { ...seriesBlock, sampling: 'cumulative' }, doc(rows), 2, [], null,
    ) as SeriesVm

    expect(gauge.gaps).toHaveLength(1)
    expect(cum.gaps).toHaveLength(0)
  })

  it('transform 은 값에 적용되고 fmt 는 이중 변환하지 않는다', () => {
    const vm = buildSeries(
      { ...seriesBlock, transform: (ms) => ms / 10, fmt: 'n1' },
      doc([{ t_s: 0, v: 1000 }, { t_s: 1, v: 2000 }]), 1, [], null,
    ) as SeriesVm

    expect(vm.summary).toContain('max 200.0')
  })

  it('호버한 초에 값이 없으면 "표본 없음" 이고 점을 찍지 않는다', () => {
    const vm = buildSeries(
      seriesBlock, doc([{ t_s: 0, v: 1 }, { t_s: 2, v: 3 }]), 2, [], 1,
    ) as SeriesVm

    expect(vm.readout).toContain('표본 없음')
    expect(vm.cursor.r).toBe(0)
  })
})

describe('시간축 — 잰 구간만 그린다', () => {
  const doc = (session: Record<string, unknown>): unknown => ({ session })

  /**
   * 세션 길이까지 축을 그리던 시절에는 **모든 그래프 꼬리에 회색 띠**가 남았다.
   * `start` 가 adb 왕복을 하는 동안 트레이서는 아직 돌지 않고 `stop` 은 먼저 멈추기 때문이다.
   */
  it('오른쪽 끝은 마지막 **온전한** 초다 — 세션 길이가 아니다', () => {
    // 실기기: 세션 9.017초 · 트레이스 8.250초 · 마지막 표본 t_s=7.
    // 8초 칸은 4분의 1만 측정된 구간이라 표본이 없는 것이 정상이다.
    expect(computeMaxT(doc({ duration_ms: 9017, trace_span_ms: 8250 }), [])).toBe(7)
    // 같은 세션을 옛 규칙으로 그리면 10초까지 가고 꼬리 세 칸이 빈다.
    expect(computeMaxT(doc({ duration_ms: 9017 }), [])).toBe(10)
  })

  it('trace_span_ms 가 없는 옛 세션은 세션 길이로 물러선다', () => {
    expect(computeMaxT(doc({ duration_ms: 5238 }), [])).toBe(6)
  })

  it('표본이 축보다 멀리 있으면 축이 표본까지 늘어난다 — 잰 것을 자르지 않는다', () => {
    const withRow = { session: { trace_span_ms: 2000 }, metrics: { cpu: { data: { device_timeline: [{ t_s: 9, busy_pct: 1 }] } } } }
    expect(computeMaxT(withRow, [])).toBe(9)
  })
})

describe('마킹 — 시계열과 같은 0초로 옮긴다', () => {
  const marksDoc = (session: Record<string, unknown>): unknown => ({ session })

  /** 마킹은 세션 시작 기준, 시계열은 트레이스 시작 기준이다. 실측 0.88초 차이. */
  it('trace_start_offset_ms 만큼 당긴다', () => {
    const m = readMarks(marksDoc({
      trace_start_offset_ms: 880,
      marks: [{ offset_ms: 5880, label: '스크롤' }],
    }))
    expect(m[0]!.t).toBe(5)
  })

  /**
   * **모르면 옮기지 않는다.** 0 으로 가정해 옮기면 어긋난 자리에 찍히면서 맞는 것처럼
   * 보인다 — 옛 세션이 그 경우다.
   */
  it('offset 이 없으면 원래 자리에 둔다', () => {
    const m = readMarks(marksDoc({ marks: [{ offset_ms: 5880, label: '스크롤' }] }))
    expect(m[0]!.t).toBe(6)
  })

  it('트레이스보다 먼저 찍힌 마킹은 0초에 붙인다 — 축 밖으로 내보내지 않는다', () => {
    const m = readMarks(marksDoc({
      trace_start_offset_ms: 880,
      marks: [{ offset_ms: 100, label: '바로 남김' }],
    }))
    expect(m[0]!.t).toBe(0)
  })
})

/**
 * **긴 세션에서 라벨이 겹쳐 뭉개졌다** — 5분 30초 세션에서 `270s 300s330s` 로 보였다.
 * 간격이 30초에서 멈춰 눈금이 12개가 됐기 때문이고, 축 폭은 256px 뿐이다.
 */
describe('시간축 눈금', () => {
  it('세션이 길어져도 라벨 수가 늘지 않는다', () => {
    for (const maxT of [8, 30, 70, 120, 333, 600, 1234, 3600, 7200]) {
      expect(timeTicks(maxT).length, `${maxT}s`).toBeLessThanOrEqual(7)
    }
  })

  it('사람이 시간으로 읽는 간격만 쓴다 — 47초 같은 것은 안 나온다', () => {
    const ticks = timeTicks(333)
    const gaps = ticks.slice(1, -1).map((t, i) => t - ticks[i]!)
    for (const g of gaps) expect([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]).toContain(g)
  })

  /** 오른쪽 끝이 몇 초인지 안 적히면 그래프 가로 폭이 무슨 뜻인지 알 수 없다. */
  it('마지막은 항상 세션 끝이다', () => {
    for (const maxT of [8, 45, 333, 1234]) expect(timeTicks(maxT).at(-1)).toBe(maxT)
  })

  /** 끝 눈금이 앞 눈금에 붙으면 앞의 것을 버린다 — 규칙적인 간격보다 끝을 아는 것이 낫다. */
  it('끝 눈금에 붙은 앞 눈금을 버린다', () => {
    // 333 에서 60초 간격이면 300 이 남는데, 33초 차이(9.9%)는 글자가 겹친다.
    expect(timeTicks(333)).not.toContain(300)
    expect(timeTicks(333)).toEqual([0, 60, 120, 180, 240, 333])
    // 45 에서 40 은 5초(11%) 차이라 버리고, 30 은 15초(33%) 차이라 남는다.
    expect(timeTicks(45)).toEqual([0, 10, 20, 30, 45])
  })

  it('딱 떨어지면 끝을 두 번 적지 않는다', () => {
    expect(timeTicks(120)).toEqual([0, 30, 60, 90, 120])
  })
})

describe('시간축은 하나다', () => {
  it('가장 긴 계열 · 표식 · 세션 길이 중 최댓값을 쓴다', () => {
    const doc = {
      session: { duration_ms: 30_000, marks: [{ offset_ms: 44_000, label: 'm' }] },
      metrics: { cpu: { data: { device_timeline: [{ t_s: 12, busy_pct: 1 }] } } },
    }
    // 표식이 44초라 축은 거기까지 가야 한다 — 그렇지 않으면 표식이 화면 밖에 선다.
    expect(computeMaxT(doc, readMarks(doc))).toBe(44)
  })

  it('아무것도 없으면 0 이 아니라 1 이다 — 0 이면 나눗셈이 터진다', () => {
    expect(computeMaxT({}, [])).toBe(1)
  })

  it('표본이 없는 뒷구간도 축에 남는다 (세션 길이 기준)', () => {
    const doc = { session: { duration_ms: 50_000 }, metrics: {} }
    expect(computeMaxT(doc, [])).toBe(50)
  })
})

describe('분포', () => {
  it('전체 버킷을 접지 않고 그린다', () => {
    // 빌더의 규칙을 보는 테스트라 매니페스트 카드에 매이지 않는다 — 카드가 어느 경로를
    // 보든 "버킷을 접지 않는다" 는 규칙은 같아야 한다.
    const b = TRACE_DIST
    const vm = buildDistribution(b, FULL, 900)
    const buckets = readPath(FULL, b.path) as unknown[]

    expect(b.breakAfterEmptyBuckets).toBe(Infinity)
    expect((vm as { bars: unknown[] }).bars).toHaveLength(buckets.length)
    expect((vm as { breaks: unknown[] }).breaks).toHaveLength(0)
  })

  it('툴팁에 누적 비율을 넣지 않는다 — 버킷은 시간축이 아니다', () => {
    const vm = buildDistribution(TRACE_DIST, FULL, 900)
    const tip = (vm as { tipOf: (i: number) => { sub: string } }).tipOf(1)
    expect(tip.sub).toContain('전체의')
    expect(tip.sub).not.toContain('누적')
  })

  it('상한 없는 마지막 버킷은 "이상" 으로 읽힌다', () => {
    const vm = buildDistribution(TRACE_DIST, FULL, 900)
    const buckets = readPath(FULL, 'metrics.hwui.data.histogram') as unknown[]
    const tip = (vm as { tipOf: (i: number) => { head: string } }).tipOf(buckets.length - 1)
    expect(tip.head).toContain('이상')
  })

  /**
   * **가로 눈금은 칸의 시작이 아니라 끝이다.** 시작값을 쓰면 첫 칸 아래에 `0ms` 가 서는데,
   * 프레임 대부분이 그 칸에 있으므로 "0ms 에 끝난 프레임이 480장" 으로 읽힌다.
   * 데이터 쪽이 이미 같은 규칙(`6ms=155` → `[5, 6)`)이라 축만 어긋나 있었다.
   */
  it('가로 눈금은 칸의 끝이다 — 첫 칸 아래에 0ms 가 서지 않는다', () => {
    const card: DistributionBlock = { ...TRACE_DIST, path: 'b', percentilesPath: 'p' }
    const doc = {
      b: [
        { from_ms: 0, to_ms: 5, count: 480 },
        { from_ms: 5, to_ms: 6, count: 12 },
        { from_ms: 6, to_ms: null, count: 3 },
      ],
    }
    const vm = buildDistribution(card, doc, 900) as { xLabels: { label: string }[] }
    const labels = vm.xLabels.map((t) => t.label)

    expect(labels[0]).toBe('5ms')
    expect(labels).not.toContain('0ms')
    // 상한이 없는 칸은 끝이 없으므로 시작값에 `+` 를 붙인다.
    expect(labels).toContain('6ms+')
  })

  const shareOf = (doc: unknown): { k: string; v: string } | null => {
    const card: DistributionBlock = {
      ...TRACE_DIST, path: 'b', percentilesPath: 'p',
      share: { label: 'jank', countPath: 'c', totalPath: 't' },
    }
    const vm = buildDistribution(card, { b: [{ from_ms: 0, to_ms: 5, count: 1 }], ...(doc as object) }, 900)
    return (vm as { share: { k: string; v: string } | null }).share
  }

  /**
   * **마감이 8.33ms 든 16.67ms 든 상관없는 하나의 숫자다.** 그 비교는 기기가 프레임마다
   * 자기 마감으로 이미 끝냈고, 읽는 쪽이 알고 싶은 것은 "그래서 몇 %" 하나다.
   */
  it('백분위 옆에 jank 비율 하나를 세운다', () => {
    expect(shareOf({ c: 170, t: 1682 })).toEqual({ k: 'jank', v: '10.1' })
  })

  /** 분자든 분모든 못 읽었으면 자리가 빈다 — 0% 를 지어내지 않는다. */
  it('분자나 분모를 못 읽으면 세우지 않는다', () => {
    expect(shareOf({ c: null, t: 1682 })).toBeNull()
    expect(shareOf({ c: 170 })).toBeNull()
    expect(shareOf({ c: 170, t: 0 })).toBeNull()
  })
})

/**
 * **옮겨 적은 이름은 대조를 끊는다.** gfxinfo 라벨을 "그리기 명령" 으로 쓰면 원문에서
 * grep 되지 않고, 우리 스키마 필드를 "앱 warn" 으로 쓰면 `result.json` 에서 찾을 수 없다.
 */
describe('logcat 카드는 스키마 필드 이름을 그대로 쓴다', () => {
  it('라벨이 곧 경로다', () => {
    for (const k of block<PairsBlock>('logcat 줄 수').keys ?? []) expect(k.l, k.p).toBe(k.p)
  })
})

/**
 * **재는데 화면이 침묵하면 사람과 파일이 다른 이야기를 한다.** `frame` 이 그래서 통째로
 * 사라졌다. 크래시·ANR·스로틀은 그 반대 방향으로 푼다 — 보여 준다.
 */
describe('세션을 믿어도 되는지 정하는 값들', () => {
  const doc = (over: object): unknown => ({
    metrics: {
      log: { status: 'collected', data: { device_crashes: [], device_anrs: [], ...over } },
      thermal: { status: 'collected', data: {} },
    },
  })

  /** `[]` 는 재 봤더니 없었다 — `수집 안 함` 이 아니다. */
  it('크래시가 없으면 "없음" 이라고 말한다', () => {
    const vm = buildPairs(block<PairsBlock>('크래시'), doc({}))
    expect((vm as NoneVm).label).toBe('크래시 없음')
  })

  /**
   * **sdk 30 처럼 logdr 접근이 막힌 기기가 정확히 이 경우다.** 로그를 못 받았으니 크래시가
   * 있었는지 없었는지 모른다 — 그때 "크래시 없음" 이라고 하면 없던 사실을 만든다.
   */
  it('로그를 못 받았으면 "없음" 이 아니라 "값 없음" 이다', () => {
    const vm = buildPairs(block<PairsBlock>('크래시'), doc({ device_crashes: null }))
    expect((vm as NoneVm).label).not.toBe('크래시 없음')
    expect((vm as NoneVm).label).toBe(NONE_NULL)
  })

  /** 필드가 아예 없던 시절의 세션은 또 다른 사실이다 — 세 상태가 다 갈려야 한다. */
  it('필드가 없으면 "수집 안 함" 이다', () => {
    const vm = buildPairs(block<PairsBlock>('크래시'), { metrics: { log: { data: {} } } })
    expect((vm as NoneVm).label).toContain(NONE_MISSING)
  })

  it('있으면 태그와 메시지를 그대로 낸다', () => {
    const vm = buildPairs(
      block<PairsBlock>('크래시'),
      doc({ device_crashes: [{ tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main', pid: 1 }] }),
    )
    const rows = (vm as { rows: { label: string; value: string }[] }).rows
    expect(rows[0]).toMatchObject({ label: 'AndroidRuntime', value: 'FATAL EXCEPTION: main' })
  })

  /**
   * 이름은 AOSP 의 `THERMAL_STATUS_*` 그대로다 — 우리가 매긴 등급이 아니다(규칙 2).
   * 숫자를 함께 적어 `dumpsys thermalservice` 와 대조된다.
   */
  it('스로틀 단계를 기기가 쓰는 이름으로 낸다', () => {
    const d = { metrics: { thermal: { status: 'collected', data: {
      device_status_before: 0, device_status_after: 3, hal_ready_before: true, status_override_before: false,
    } } } }
    const rows = (buildPairs(block<PairsBlock>('스로틀 단계'), d) as { rows: { label: string; value: string }[] }).rows
    expect(rows.find((r) => r.label === '시작')!.value).toBe('NONE (0)')
    expect(rows.find((r) => r.label === '종료')!.value).toBe('SEVERE (3)')
  })

  /**
   * **평소엔 아무 뜻이 없고 이상할 때만 뜻이 생기는 값은 카드에 두지 않는다.**
   * `hal_ready` · `status_override` 가 그렇다 — 4세션 내내 `예/아니오` 로 고정이라
   * 읽는 사람에게 할 일을 주지 않는다. 값은 `result.json` 에 그대로 있다.
   */
  it('평소에 뜻 없는 값을 카드에 두지 않는다', () => {
    const keys = block<PairsBlock>('스로틀 단계').keys ?? []
    expect(keys.map((k) => k.p)).toEqual(['device_status_before', 'device_status_after'])
    // 같은 섹션의 다른 카드와 같은 어휘를 쓴다 — 두 줄뿐이라 경로가 없어도 모호하지 않다.
    expect(keys.map((k) => k.l)).toEqual(['시작', '종료'])
  })

  it('모르는 단계는 지어내지 않고 숫자만 낸다', () => {
    expect(fmtValue(9, 'thermal')).toBe('9')
    expect(fmtValue(null, 'thermal')).toBe(NONE_NULL)
  })
})

describe('pairs · bars · delta', () => {
  it('freq 는 같은 주파수의 코어를 한 줄로 접는다', () => {
    const vm = buildPairs(block<PairsBlock>('클러스터 주파수'), FULL)
    // 8코어가 3클러스터다 — 같은 값 8줄은 정보가 아니다.
    expect((vm as { rows: unknown[] }).rows.length).toBeLessThan(8)
  })

  it('bars 는 배열 라벨을 범위로 접는다', () => {
    const vm = buildBars(block<BarsBlock>('CPU 클러스터 최대 주파수'), FULL)
    expect((vm as { rows: { label: string }[] }).rows[0]!.label).toMatch(/CPU \d+–\d+/)
  })

  it('delta 는 before/after 를 짝지어 낸다', () => {
    const vm = buildDelta(block<DeltaBlock>('온도 (세션 전 → 후)'), FULL)
    const rows = (vm as { rows: { label: string; before: string; after: string }[] }).rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.before).toContain('°C')
  })

  /** 측정 중인 세션은 `state_after` 가 `null` 이다 — 0 이 아니고, before 를 복사해서도 안 된다. */
  it('state_after 가 null 이면 after 는 "값 없음" 이다', () => {
    const b = block<DeltaBlock>('기기 상태 (전 → 후)')
    const vm = buildDelta(b, {
      device: { state_before: { battery_level: 100 }, state_after: null },
    })
    const rows = (vm as { rows: { label: string; before: string; after: string; delta: string }[] }).rows
    expect(rows[0]!.before).toBe('100%')
    expect(rows[0]!.after).toBe(NONE_NULL)
    // 한쪽을 못 읽었으면 뺄 것이 없다. 0 으로 채우면 "안 변했다" 는 없던 사실이 된다.
    expect(rows[0]!.delta).toBe(NO_DELTA)
  })

  const stateRows = (before: unknown, after: unknown): Record<string, string>[] => {
    const vm = buildDelta(block<DeltaBlock>('기기 상태 (전 → 후)'), {
      device: { state_before: before, state_after: after },
    })
    const rows = (vm as { rows: { label: string; delta: string }[] }).rows
    return rows.map((r) => ({ label: r.label, delta: r.delta }))
  }

  /**
   * **차이의 단위는 before·after 와 같은 포맷터가 붙인다.** 여기서 단위를 따로 정하면
   * 한 줄의 세 숫자 중 하나만 다른 단위로 적히는 날이 온다.
   */
  it('차이에 같은 단위가 붙는다 — 퍼센트면 %, 온도면 °C, kB 필드면 MB', () => {
    const rows = stateRows(
      { battery_level: 100, battery_temp_c: 37.1, mem_available_kb: 4_294_656 },
      { battery_level: 96, battery_temp_c: 37.0, mem_available_kb: 4_281_344 },
    )
    expect(rows.find((r) => r['label'] === '배터리')!['delta']).toBe('-4%')
    expect(rows.find((r) => r['label'] === '배터리 온도')!['delta']).toBe('-0.1°C')
    expect(rows.find((r) => r['label'] === '가용 메모리')!['delta']).toBe('-13 MB')
  })

  it('오른 값에는 + 를 붙인다', () => {
    expect(stateRows({ battery_temp_c: 45.8 }, { battery_temp_c: 48.2 })[1]!['delta']).toBe('+2.4°C')
  })

  /**
   * **적을 차이가 없는 세 경우가 다 `-` 다.** 셋을 한 글자로 합쳐도 규칙 3 을 깨지 않는다 —
   * 바로 왼쪽 두 칸이 이미 셋을 가른다 (`37.1°C → 37.1°C` 대 `100% → 값 없음`).
   */
  it('안 변했으면 - 다', () => {
    expect(stateRows({ battery_temp_c: 37.1 }, { battery_temp_c: 37.1 })[1]!['delta']).toBe(NO_DELTA)
  })

  /** `wifi - wifi` 는 뜻이 없다. 값이 달라도(`wifi` → `lte`) 뺄 수는 없다. */
  it('뺄 수 없는 값은 - 다', () => {
    const rows = stateRows({ charging: true, network: 'wifi' }, { charging: true, network: 'lte' })
    expect(rows.find((r) => r['label'] === '충전')!['delta']).toBe(NO_DELTA)
    expect(rows.find((r) => r['label'] === '네트워크')!['delta']).toBe(NO_DELTA)
  })

  /** 칸이 비면 렌더가 깨진 것처럼 보이고, 그 줄만 다른 표처럼 읽힌다. */
  it('차이 칸은 비지 않는다', () => {
    for (const r of stateRows({ charging: true }, { charging: true })) {
      expect(r['delta'], r['label']).not.toBe('')
    }
  })

  it('배열형(온도 존)도 같은 규칙이다', () => {
    const vm = buildDelta(block<DeltaBlock>('온도 (세션 전 → 후)'), {
      metrics: { thermal: { data: { zones: [{ name: 'AP', before_c: 45.8, after_c: 48.2 }] } } },
    })
    expect((vm as { rows: { delta: string }[] }).rows[0]!.delta).toBe('+2.4°C')
  })
})

describe('stat', () => {
  it('값이 없으면 단위를 붙이지 않는다 — "수집 안 함 ms" 가 되면 안 된다', () => {
    const vm = buildStat(block<StatBlock>('앱 시작'), { metrics: {} })
    expect(vm.value).toBe(NONE_MISSING)
    expect(vm.unit).toBe('')
    expect(vm.dim).toBe(true)
  })

  /**
   * **`값 없음` 만 크게 띄우면 도구가 고장 난 것처럼 보인다.** 실제로는 `am start -W` 가
   * timeout 을 보고해 `TotalTime` 이 안 찍힌 것이고, 그 사실은 `reason_code` 에 이미 있다.
   */
  it('값이 없으면 그 이유(reason_code)를 함께 낸다', () => {
    const doc = {
      metrics: {
        startup: {
          status: 'partial',
          reason: 'am start -W 가 Status: timeout 을 보고했습니다',
          reason_code: 'launch_wait_timed_out',
          data: { total_time_ms: null, wait_time_ms: 10259 },
        },
      },
    }
    const vm = buildStat(block<StatBlock>('앱 시작'), doc)
    expect(vm.why?.code).toBe('launch_wait_timed_out')
    // 긴 문장은 툴팁으로 간다 — 카드에 문단을 깔지 않는다.
    expect(vm.why?.full).toContain('timeout')
  })

  /**
   * `partial` 은 나온 필드와 안 나온 필드를 같이 갖는다. 멀쩡한 숫자 밑에 사유를 달면
   * 그 숫자까지 의심하게 된다.
   */
  it('값이 있으면 사유를 붙이지 않는다', () => {
    const doc = {
      metrics: {
        startup: {
          status: 'partial', reason: '무언가', reason_code: 'launch_wait_timed_out',
          data: { total_time_ms: 718 },
        },
      },
    }
    expect(buildStat(block<StatBlock>('앱 시작'), doc).why).toBeNull()
  })
})

/**
 * **이 화면에서 색이 좋고 나쁨을 말하는 유일한 자리다** (규칙 2 의 의도적 예외).
 * 그래서 경계가 우리 것이 아니라는 조건이 코드에 박혀 있어야 한다.
 */
describe('기준선 막대 (gauge)', () => {
  const startup = (totalMs: unknown): unknown => ({
    metrics: { startup: { status: 'ok', data: { total_time_ms: totalMs } } },
  })
  const gauge = (totalMs: unknown) => buildStat(block<StatBlock>('앱 시작'), startup(totalMs)).gauge

  /**
   * **값이 없으면 막대도 없다.** 빈 막대를 그리면 읽는 쪽은 그것을 `0ms` 로 읽는다 —
   * 규칙 3 이 화면에서 깨지는 자리가 정확히 여기다.
   */
  it('값이 없으면 막대를 그리지 않는다', () => {
    expect(gauge(null)).toBeNull()
    expect(buildStat(block<StatBlock>('앱 시작'), { metrics: {} }).gauge).toBeNull()
  })

  const withReason = (code: string): unknown => ({
    metrics: {
      startup: { status: 'partial', reason: '무언가', reason_code: code, data: { total_time_ms: null } },
    },
  })

  /**
   * **타임아웃은 "못 쟀다" 와 "오래 걸렸다" 가 같은 사건이다** — ActivityManager 가 실행
   * 완료 보고를 기다리다 포기한 것이다. 그 자리를 비워 두면 세션에서 가장 나쁜 소식이
   * 화면에서 가장 조용해진다.
   */
  it('타임아웃이면 막대를 마지막 구간으로 꽉 채운다', () => {
    const g = buildStat(block<StatBlock>('앱 시작'), withReason('launch_wait_timed_out')).gauge
    expect(g?.fill).toBe(1)
    expect(g?.level).toBe(5)
    expect(g?.axisLabel).toContain('타임아웃')
  })

  /** 잰 값이 아니라는 것이 뷰모델에 남아야 렌더러가 빗금으로 구분할 수 있다. */
  it('그 막대는 잰 값이 아니라고 표시한다', () => {
    expect(buildStat(block<StatBlock>('앱 시작'), withReason('launch_wait_timed_out')).gauge?.measured)
      .toBe(false)
    expect(gauge(2868)?.measured).toBe(true)
  })

  /**
   * **아무 결측에나 칠하지 않는다.** `--launch` 를 안 준 세션은 나쁜 일이 아니라 재지 않은
   * 것이다 — 거기에 빨간 막대를 세우면 없던 사실을 만든다.
   */
  it('나쁜 소식이 아닌 결측에는 막대를 세우지 않는다', () => {
    expect(buildStat(block<StatBlock>('앱 시작'), withReason('launch_not_requested')).gauge).toBeNull()
    expect(buildStat(block<StatBlock>('앱 시작'), withReason('launch_time_unreported')).gauge).toBeNull()
  })

  /** 경계와 같은 값은 위 구간이다 — 구글의 문장이 "5초를 넘으면" 이라 마지막도 같은 방향. */
  it('구간은 넘긴 경계의 개수다', () => {
    expect(gauge(999)?.level).toBe(0)
    expect(gauge(1000)?.level).toBe(1)
    expect(gauge(2868)?.level).toBe(2)
    expect(gauge(4999)?.level).toBe(4)
    expect(gauge(5000)?.level).toBe(5)
  })

  it('막대는 축 밖으로 나가지 않고, 넘긴 것은 넘겼다고 말한다', () => {
    expect(gauge(2500)?.fill).toBeCloseTo(0.5)
    expect(gauge(2500)?.over).toBe(false)
    // 12초짜리 시작도 막대는 꽉 찬 데서 멈춘다. 큰 숫자는 이미 카드 위에 있다.
    expect(gauge(12_000)?.fill).toBe(1)
    expect(gauge(12_000)?.over).toBe(true)
    expect(gauge(12_000)?.level).toBe(5)
  })

  /**
   * 경계를 우리가 정했다고 읽히면 규칙 2 를 깬 것이다. 출처가 뷰모델에 실려 화면까지 간다.
   */
  it('경계의 출처를 함께 낸다', () => {
    expect(gauge(2868)?.source).toContain('Android Vitals')
    expect(gauge(2868)?.axisLabel).toContain('5,000ms')
  })
})

describe('지표 상태', () => {
  it('status 와 reason_code 를 끌어온다', () => {
    expect(metricState(LOWEND, 'network').status).toBe('unsupported')
    expect(metricState(LOWEND, 'network').reasonCode).toBe('sdk_too_low')
  })

  it('지표에 속하지 않는 블록은 상태가 없다', () => {
    expect(metricState(FULL, undefined).status).toBeNull()
  })
})

describe('매니페스트에 없는 지표', () => {
  it('무시한 개수를 푸터에 남긴다 — 조용히 버리면 새 지표가 생겨도 아무도 모른다', () => {
    const h = buildHeader({ metrics: { hwui: { status: 'collected' }, battery: { status: 'collected' } } })
    expect(h.ignored).toEqual(['battery'])
    expect(h.footerIgnored).toContain('battery')
  })

  it('전부 아는 지표면 아무 문구도 띄우지 않는다', () => {
    expect(buildHeader(FULL).footerIgnored).toBe('')
  })
})

describe('스키마 메이저', () => {
  it('다르면 푸터가 이 화면의 한계를 말한다', () => {
    expect(buildHeader({ schema_version: '2.0.0' }).schemaMismatch).toBe(true)
    expect(buildHeader({ schema_version: '1.1.0' }).schemaMismatch).toBe(false)
  })

  it('duration 라벨을 쓴다', () => {
    expect(buildHeader(FULL).meta.some((m) => m.k === 'duration')).toBe(true)
  })
})

/**
 * README 가 보고서에 대해 **숫자로** 말하는 자리는 하나뿐이다("시계열 다섯"). 매니페스트에
 * series 를 하나 더 넣고 README 를 안 고치면 여기서 깨진다 — 문서가 조용히 낡는 것을 막는
 * 유일한 장치다 (`packages/core/test/schema/readme.test.ts` 와 같은 역할).
 */
describe('README 가 말하는 숫자', () => {
  it('"시계열 다섯" 이 매니페스트의 series 개수와 같다', () => {
    const readme = readFileSync(
      fileURLToPath(new URL('../../../README.md', import.meta.url)),
      'utf8',
    )
    const KO = ['영', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열']
    const n = MANIFEST.filter((b) => b.kind === 'series').length
    expect(readme).toContain(`시계열 ${KO[n]}`)
  })
})

/**
 * `jank_type`·`기기가 준 마감`·트레이스 `프레임 수` 카드는 화면에서 뺐다 — 렌더를
 * 프레임워크(`hwui`) 기준으로 정했고, 두 출처를 한 화면에 놓으면 같은 이름이 두 번 나온다.
 * **데이터는 `result.json` 에 그대로 있다.** 아래는 남은 카드들이 지켜야 할 것.
 *
 * `frame` 이 렌더 섹션으로 돌아온 것은 그 판단을 뒤집은 것이 아니다 — **범위가 달라졌다.**
 * 개수도 백분위도 내지 않고 시간축만 내므로 같은 이름의 숫자가 두 벌이 되는 조건 자체가
 * 없다. 아래 세 테스트가 그 조건을 지킨다.
 */
describe('프레임워크 지표 카드', () => {
  const card = block<PairsBlock>('프레임 수')

  it('개수와 퍼센트를 함께 낸다', () => {
    const doc = {
      metrics: {
        hwui: { data: { total_frames: 1682, janky_frames: 170, deadline_missed: 273 } },
      },
    }
    const rows = (buildPairs(card, doc) as { rows: { label: string; value: string; share: string }[] }).rows
    const janky = rows.find((r) => r.label === 'Janky frames')!
    expect(janky.value).toBe('170')
    expect(janky.share).toBe('10.1%')
    // 분모 자신에는 100% 를 달지 않는다.
    expect(rows.find((r) => r.label === 'Total frames rendered')!.share).toBe('')
  })

  it('분모가 없으면 비율을 지어내지 않는다', () => {
    const rows = (
      buildPairs(card, { metrics: { hwui: { data: { janky_frames: 5 } } } }) as {
        rows: { label: string; share: string }[]
      }
    ).rows
    expect(rows.find((r) => r.label === 'Janky frames')!.share).toBe('')
  })

  it('두 번째 계열색을 쓴다 — 다른 카드와 구분된다', () => {
    expect(card.tone).toBe('alt')
    // 색이 판정으로 읽히지 않게, tone 을 쓰는 곳은 렌더(hwui) 뿐이어야 한다.
    expect(MANIFEST.filter((b) => b.tone === 'alt').every((b) => b.metric === 'hwui')).toBe(true)
  })

  /**
   * **일부러 안 그리는 것과 몰라서 안 그리는 것은 다르다.** 후자만 푸터가 경고해야 한다 —
   * 이유가 있어 뺀 지표가 매번 뜨면 진짜 신호(아무도 안 넣은 새 지표)가 묻힌다.
   *
   * **지금은 목록이 비어 있다.** 한동안 `frame` 이 여기 있었는데, 화면엔 없고 파일에만
   * 남아서 사람과 LLM 이 다른 숫자를 봤다 — 그래서 수집을 접었다.
   */
  it('안 그리는 목록이 비어 있고, 그래서 푸터가 조용하다', () => {
    expect(NOT_DRAWN_METRICS).toEqual([])
    expect(buildHeader(FULL).footerIgnored).toBe('')
  })

  it('렌더 섹션의 지표는 hwui 와 frame 둘뿐이다', () => {
    for (const b of MANIFEST.filter((x) => x.section === 'render')) {
      expect(['hwui', 'frame'], b.title).toContain(b.metric)
    }
  })

  /** 트레이스 쪽은 **시간축 카드 하나**여야 한다. 개수나 백분위 카드가 붙으면 그때부터 두 벌이다. */
  it('frame 은 시간축 카드 하나뿐이다', () => {
    expect(MANIFEST.filter((b) => b.metric === 'frame').map((b) => b.kind)).toEqual(['frametimeline'])
  })

  /**
   * `path` 만 보면 `share` 처럼 중첩된 경로를 놓친다 — 렌더 섹션이 참조하는 **모든** 문자열
   * 경로를 훑는다. 트레이스에서 오는 경로는 `metrics.frame.data`(시간축) 하나뿐이고,
   * `metrics.frame.data.percentiles` 같은 것이 하나라도 끼면 같은 화면에 두 모집단이 선다.
   */
  it('렌더 섹션의 트레이스 경로는 시간축 하나뿐이다', () => {
    const paths = MANIFEST.filter((x) => x.section === 'render').flatMap((b) =>
      JSON.stringify(b).match(/metrics\.[a-z_.]+/g) ?? [],
    )
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) expect(p).toMatch(/^(metrics\.hwui\.|metrics\.frame\.data$)/)
  })
})

/**
 * **분포는 한 장이다.** 두 장을 나란히 놓았더니 읽는 쪽이 먼저 묻는 것이 "어느 게 진짜냐"
 * 였다. 화면에 남긴 것은 프레임워크 쪽 — 안드로이드 Vitals 가 보는 모집단과 값이다.
 * 트레이스 분포는 `result.json` 에 그대로 있고 화면에서만 뺐다.
 */
describe('렌더 섹션', () => {
  const labels = (): string[] =>
    MANIFEST.filter((b) => b.section === 'render' && b.kind === 'pairs').flatMap((b) =>
      ((b as PairsBlock).keys ?? []).map((k) => k.l),
    )

  it('분포 카드는 하나뿐이고 프레임워크 것이다', () => {
    const dists = MANIFEST.filter((b) => b.kind === 'distribution')
    expect(dists).toHaveLength(1)
    expect(dists[0]!.path).toBe('metrics.hwui.data.histogram')
    expect(dists[0]!.metric).toBe('hwui')
  })

  /** **버전 하한이 없는 쪽을 골랐다.** sdk 30 처럼 트레이스가 없는 기기에서도 그려져야 한다. */
  it('트레이스가 통째로 없어도 분포가 그려진다', () => {
    const card = block<DistributionBlock>('프레임 시간 분포')
    const sdk30 = {
      metrics: {
        hwui: {
          data: {
            total_frames: 215,
            histogram: [
              { from_ms: 5, to_ms: 6, count: 2 },
              { from_ms: 6, to_ms: null, count: 213 },
            ],
          },
        },
      },
    }
    const vm = buildDistribution(card, sdk30, 900)
    expect((vm as NoneVm).none).toBeUndefined()
    expect((vm as { bars: unknown[] }).bars.length).toBeGreaterThan(0)
  })

  it('없으면 카드는 남고 "수집 안 함" 이다', () => {
    expect((buildDistribution(block<DistributionBlock>('프레임 시간 분포'), {}, 900) as NoneVm).none).toBe(true)
  })

  /** 같은 이름이 두 번 나오면 "어느 게 진짜냐" 가 생긴다 — 실제로 그렇게 읽혔다. */
  it('같은 이름의 값을 두 번 내지 않는다', () => {
    const seen = labels()
    expect(new Set(seen).size).toBe(seen.length)
  })

  /**
   * 실측에서 480 과 450 이 겹쳐 읽을 수 없었다. 꼭대기 눈금(실제 최댓값)이 규칙적인 눈금
   * 바로 옆에 붙었기 때문이다 — 축의 최댓값이 더 쓸모 있으므로 규칙적인 쪽을 밀어낸다.
   */
  it('y축 눈금이 겹치지 않는다', () => {
    const card: DistributionBlock = { ...TRACE_DIST, path: 'b', percentilesPath: 'p' }
    const doc = { b: [{ from_ms: 0, to_ms: 5, count: 480 }, { from_ms: 5, to_ms: 6, count: 1 }] }
    const vm = buildDistribution(card, doc, 900) as { yTicks: { label: string }[] }
    const labels = vm.yTicks.map((t) => t.label)

    expect(labels).toContain('480')
    // 450 은 480 에 붙어 있어 빠져야 한다.
    expect(labels).not.toContain('450')
    // 아래쪽 눈금은 그대로 남는다 — 규칙 전체를 버린 것이 아니다.
    expect(labels).toContain('150')
  })

  it('프레임워크 카드는 트레이스에 없는 것을 낸다', () => {
    expect(labels()).toContain('Slow UI thread')
    expect(labels()).toContain('High input latency')
  })

  /**
   * **기기가 영어로 준 이름은 영어로 싣는다.** 옮기면 원문과 대조할 수 없다 —
   * "그리기 명령" 은 `dumpsys gfxinfo` 출력에서 grep 되지 않는다.
   */
  it('gfxinfo 줄 이름을 번역하지 않는다', () => {
    for (const l of labels()) expect(l, l).toMatch(/^[\x20-\x7E]+$/)
  })

  /**
   * `High input latency` 는 실측에서 전체 프레임 수를 넘었다 (2,759 대 1,682 · 33 대 26).
   * 분모가 아닌 값에 비율을 붙이면 100% 넘는 숫자가 나온다.
   */
  it('원인별 횟수에는 비율을 붙이지 않는다', () => {
    const card = block<PairsBlock>('원인별 횟수')
    expect((card.keys ?? []).every((k) => k.pct === undefined)).toBe(true)
  })

  /**
   * `Janky frames` 와 `Frame deadline missed` 는 **별개 카운터**다. sdk 36(SM-F936N)에서는
   * 다섯 표본 전부 같은 값이었지만 sdk 30(SM-A405S)에서는 157 대 8 로 갈렸다 —
   * 같아 보인다고 하나를 지우면 sdk 30 에서 없는 사실을 만든다.
   */
  it('같은 값이 나와도 두 카운터를 다 낸다', () => {
    const card = block<PairsBlock>('프레임 수')
    const ps = (card.keys ?? []).map((k) => k.p)
    expect(ps).toContain('janky_frames')
    expect(ps).toContain('deadline_missed')
  })
})

describe('렌더 섹션 서브탭', () => {
  it('분포와 타임라인 둘을 갖는다', () => {
    const render = SECTIONS.find((s) => s.id === 'render')!
    expect(render.subTabs?.map((t) => t.id)).toEqual(['distribution', 'timeline'])
  })

  /** 서브탭이 있는 섹션의 블록은 어느 탭 소속인지 반드시 말해야 한다 — 안 그러면 사라진다. */
  it('서브탭이 있는 섹션의 블록은 전부 sub 를 갖는다', () => {
    const withSubs = new Set(SECTIONS.filter((s) => s.subTabs !== undefined).map((s) => s.id))
    const orphan = MANIFEST.filter((b) => withSubs.has(b.section) && b.sub === undefined)
    expect(orphan.map((b) => b.title), 'sub 가 없는 블록').toEqual([])
  })

  it('선언한 sub 는 그 섹션의 subTabs 안에 있다', () => {
    for (const b of MANIFEST) {
      if (b.sub === undefined) continue
      const ids = SECTIONS.find((s) => s.id === b.section)?.subTabs?.map((t) => t.id) ?? []
      expect(ids, `${b.title} 의 sub=${b.sub}`).toContain(b.sub)
    }
  })
})

/**
 * **시간별 프레임.** 이 카드가 답하는 질문은 `hwui` 의 분포와 다르다 — "몇 장이 얼마나
 * 걸렸나" 가 아니라 **"언제 그랬나"** 다. 그래서 규칙도 다르다: 짝을 못 찾은 프레임은
 * 0 이 아니고, 마감은 프레임마다 다르며, 표본을 뽑았으면 그 사실이 화면에 남아야 한다.
 */
describe('buildFrameTimeline', () => {
  const card = block<FrameTimelineBlock>('시간별 프레임')

  /**
   * **`maxT` 는 초다.** 기본값이 한동안 `20000` 이었는데 그것은 20초가 아니라 **20,000초**라
   * 축이 실제보다 1000배 길었다 — 어떤 표본을 넣어도 막대가 왼쪽 1% 안에 뭉쳐서, x 좌표
   * 계산이 사실상 한 번도 시험되지 않았다. 아래 「마지막 온전한 초를 넘는 프레임」 테스트가
   * 그 기본값으로는 통과해 버린다.
   */
  const ftl = (
    data: unknown,
    marks: Mark[] = [],
    hoverT: number | null = null,
    maxT = 20,
  ): FrameTimelineVm =>
    buildFrameTimeline(
      card,
      { metrics: { frame: { status: 'collected', data } } },
      maxT,
      marks,
      hoverT,
    ) as FrameTimelineVm

  const one = (
    appMs: number,
    presentMs: number | null,
    deadlineMs: number | null,
  ): unknown => ({
    samples: [[0, appMs, presentMs, deadlineMs]],
    sampling: 'all',
    bucket_ms: null,
    frames_seen: 1,
  })

  it('막대를 앱/표시 두 칸으로 쌓는다', () => {
    const vm = ftl(one(6, 8, 8.33))
    expect(vm.bars).toHaveLength(1)
    expect(vm.bars[0]!.appMs).toBe(6)
    expect(vm.bars[0]!.presentMs).toBe(8)
    expect(vm.bars[0]!.totalMs).toBe(14)
    // 두 칸은 겹치지 않고 이어 붙는다 — 위 칸의 바닥이 아래 칸의 천장이다.
    expect(vm.bars[0]!.present!.y + vm.bars[0]!.present!.h).toBeCloseTo(vm.bars[0]!.app.y, 5)
  })

  /** 짝을 못 찾은 프레임. 0 으로 그리면 "0ms 만에 합성됐다" 가 된다. */
  it('표시 시간이 null 이면 아래 칸만 그리고 합도 앱 시간뿐이다', () => {
    const vm = ftl(one(6, null, 8.33))
    expect(vm.bars[0]!.presentMs).toBeNull()
    expect(vm.bars[0]!.totalMs).toBe(6)
    expect(vm.bars[0]!.present).toBeNull()
  })

  /** 0 높이 칸과 그림은 같아 보이지만 **툴팁이 달라야 한다** — `0.00ms` 가 아니라 `모름`. */
  it('표시 시간이 null 이면 툴팁이 "모름" 이라고 말한다', () => {
    const lines = ftl(one(6, null, 8.33)).tipOf(0)!.lines.join(' / ')
    expect(lines).toContain('모름')
    expect(lines).not.toContain('0.00')
  })

  /** D5 — 우리가 판정하지 않는다. 선은 Vitals 값 하나뿐이고 막대를 분류하지 않는다. */
  it('보조선은 Vitals 16ms 하나다', () => {
    const vm = ftl(one(6, 8, 8.33))
    expect(VITALS_SLOW_FRAME_MS).toBe(16)
    expect(vm.guide.ms).toBe(16)
    expect(vm.guide.source).toContain('Android Vitals')
    expect(vm.bars[0]).not.toHaveProperty('late')
  })

  it('마감에서 주사율을 낸다', () => {
    const vm = ftl({
      samples: [[0, 6, 8, 8.33], [8, 6, 8, 41.67]],
      sampling: 'all', bucket_ms: null, frames_seen: 2,
    })
    expect(vm.bars[0]!.hz).toBe(120)
    expect(vm.bars[1]!.hz).toBe(24)
  })

  /** 마감이 없으면 주사율도 없다. 60 으로 추측하지 않는다. */
  it('마감이 null 이면 주사율도 null 이다', () => {
    const vm = ftl(one(6, 8, null))
    expect(vm.bars[0]!.hz).toBeNull()
    expect(vm.tipOf(0)!.lines.join(' / ')).not.toContain('Hz')
  })

  /** 조용히 자르지 않는다 — 표본이라는 사실이 화면에 있어야 한다. */
  it('표본을 뽑았으면 각주를 낸다', () => {
    const vm = ftl({
      samples: [[0, 6, 8, 8.33]], sampling: 'max_per_bucket', bucket_ms: 40, frames_seen: 12400,
    })
    expect(vm.note).toContain('12,400')
  })

  /**
   * **각주의 숫자는 무엇을 센 것인지 자기 문장 안에서 말해야 한다.**
   *
   * 같은 「렌더」 섹션의 한 탭 옆에서 `hwui` 가 「프레임 수」로 `total_frames` 를 낸다.
   * 두 수는 **다른 모집단**이고(이쪽은 화면에 나간 프레임, 그쪽은 앱이 그린 프레임)
   * 실측에서 값도 다르다. 각주가 그냥 `12,400장` 이라고 적으면 한 세션에 프레임 수가
   * 두 개 있는 것으로 읽히는데, 그 구분은 README 와 스키마에만 있어 화면을 보는 사람에게
   * 닿지 않는다. **아래 키 허용 목록 테스트는 이것을 잡지 못한다** — `frames_seen` 은
   * 뷰모델의 키가 아니라 `note` **문자열 안**으로 나가기 때문이다.
   */
  it('각주가 무엇을 센 프레임인지 말한다 — hwui 의 프레임 수와 섞이지 않게', () => {
    const vm = ftl({
      samples: [[0, 6, 8, 8.33]], sampling: 'max_per_bucket', bucket_ms: 3, frames_seen: 12400,
    })
    expect(vm.note).toContain('화면에 나간 프레임')
  })

  it('전부 실었으면 각주가 없다', () => {
    expect(ftl(one(6, 8, 8.33)).note).toBeNull()
  })

  it('마크를 세로선으로 넘긴다', () => {
    const vm = ftl(one(6, 8, 8.33), [{ t: 5, label: '스크롤 시작' }])
    expect(vm.markLines).toHaveLength(1)
  })

  /**
   * **마킹은 초, 이 축은 ms 다.** 1000 을 안 곱하면 모든 마크가 왼쪽 끝에 쌓여
   * "세션 시작 직후에 다 찍혔다" 로 읽힌다 — 틀린 줄 모르는 쪽이 더 나쁘다.
   */
  it('마크를 ms 축으로 옮긴다 — 초를 그대로 쓰지 않는다', () => {
    const data = { samples: [[10000, 6, 8, 8.33]], sampling: 'all', bucket_ms: null, frames_seen: 1 }
    const vm = ftl(data, [{ t: 10, label: '10초' }])
    // 10초 마크와 10,000ms 프레임은 같은 순간이므로 같은 x 에 선다.
    expect(vm.markLines[0]!.x).toBeCloseTo(vm.bars[0]!.x + vm.bars[0]!.w / 2, 5)
    // **둘이 같기만 하면 통과하는 비교는 축이 1000배 틀려도 통과한다** — 둘 다 같은 `px` 를
    // 지나기 때문이다. 20초 축의 10초는 그림의 한가운데여야 한다.
    expect(vm.markLines[0]!.x).toBeCloseTo(FPAD.l + (vm.width - FPAD.l - FPAD.r) / 2, 5)
  })

  /**
   * **오른쪽 끝을 말없이 자르지 않는다.**
   *
   * `axis.ts` 의 `maxT` 는 **마지막 온전한 초**에서 멈춘다(`floor(trace_span_ms/1000) - 1`).
   * 초당 집계는 온전히 덮인 초에서만 값이 나오므로 시계열에는 맞는 규칙이다. 그러나
   * **프레임은 초로 접히지 않아** `t_ms` 가 `trace_span_ms` 끝까지 간다 — 20.4초 트레이스면
   * `maxT = 19` 이고, 그것을 그대로 폭으로 쓰면 19초 뒤의 1.4초(120Hz 면 170장 남짓)가
   * `viewBox` 밖으로 밀려 **화면에서 사라진다.** 게다가 `yMax` 는 그 안 보이는 막대까지
   * 세므로, 잘린 꼬리에 스파이크가 있으면 **아무 막대도 닿지 않는 높이로 세로축이 선다.**
   *
   * `frame` 이 한 번 접힌 이유가 정확히 이것이다 — 파일에 있는 숫자와 화면에 있는 그림이
   * 다른 말을 하는 것. 되살리며 그 사고를 그대로 들여올 수는 없다.
   */
  it('마지막 온전한 초를 넘는 프레임도 그림 안에 있다', () => {
    // trace_span_ms = 20,400 → 마지막 온전한 초는 19 → `maxT = 19`.
    // 프레임은 20,400ms 까지 이어지고, 가장 튄 프레임(90ms)이 하필 그 꼬리에 있다.
    const samples: unknown[] = []
    for (let t = 0; t <= 20400; t += 102) samples.push([t, 6, 8, 8.33])
    samples[samples.length - 1] = [20400, 90, 8, 8.33]
    const vm = ftl(
      { samples, sampling: 'all', bucket_ms: null, frames_seen: samples.length },
      [], null, 19,
    )

    const tallest = vm.bars.reduce((a, b) => (b.totalMs > a.totalMs ? b : a))
    expect(tallest.tMs, '가장 튄 프레임은 마지막 온전한 초보다 뒤에 있다').toBeGreaterThan(19000)

    // 그 막대의 중심이 그림 영역(왼쪽 여백 ~ 오른쪽 여백) 안에 있어야 한다.
    const cx = tallest.x + tallest.w / 2
    expect(cx).toBeGreaterThanOrEqual(FPAD.l)
    expect(cx).toBeLessThanOrEqual(vm.width - FPAD.r)
    // 막대 전체도 viewBox 를 벗어나지 않는다.
    expect(tallest.x + tallest.w).toBeLessThanOrEqual(vm.width)

    // 세로축 꼭대기는 **보이는** 막대가 만든 것이어야 한다 — 잘린 막대가 축을 늘려 놓으면
    // 그 높이에 닿는 막대가 화면에 하나도 없다.
    expect(Math.min(...vm.bars.map((b) => b.present?.y ?? b.app.y))).toBeCloseTo(FPAD.t, 5)

    // 눈금도 축 밖으로 나가지 않는다 — 나가면 오른쪽 끝이 몇 초인지 읽을 수 없다.
    for (const t of vm.xTicks) expect(t.x).toBeLessThanOrEqual(vm.width - FPAD.r)
  })

  /**
   * 막대가 2px 라 마우스로 못 짚는다. 덮개 하나를 깔고 가장 가까운 막대를 찾되,
   * **프레임이 없던 시간에서는 아무것도 짚지 않는다** — 짚으면 그 시각에 프레임이
   * 있었다는 없던 사실이 된다.
   */
  it('가까운 막대를 짚되 프레임이 없던 자리는 비운다', () => {
    const samples: unknown[] = []
    for (let i = 0; i < 10; i++) samples.push([i * 8, 6, 8, 8.33])
    samples.push([20000, 6, 8, 8.33])
    const vm = ftl({ samples, sampling: 'all', bucket_ms: null, frames_seen: 11 }, [], null, 20)

    expect(vm.idxAt(vm.bars[10]!.x / vm.width)).toBe(10)
    // 앞쪽 열 장과 마지막 한 장 사이는 20초 가까이 비어 있다.
    expect(vm.idxAt(0.5)).toBeNull()
  })

  it('없으면 카드는 남고 "수집 안 함" 이다', () => {
    expect((buildFrameTimeline(card, {}, 20, [], null) as NoneVm).none).toBe(true)
  })

  /** 재 봤더니 프레임이 0장인 것도 사실이지만, 그릴 막대는 없다. */
  it('표본이 비면 값 없음이다', () => {
    const vm = buildFrameTimeline(
      card,
      { metrics: { frame: { data: { samples: [], sampling: 'all', bucket_ms: null, frames_seen: 0 } } } },
      20, [], null,
    )
    expect((vm as NoneVm).none).toBe(true)
  })

  /**
   * **경로 가드가 못 보는 자리.** 위(「렌더 섹션의 트레이스 경로는 시간축 하나뿐이다」) 테스트는
   * 매니페스트의 `path` 문자열만 본다 — `metrics.frame.data` 하나뿐인지는 확인하지만, 그
   * 객체를 통째로 받은 `buildFrameTimeline` 이 그 안에서 **무엇을 뽑아 화면에 얹는지**는
   * 안 본다. `frame` 이 한 번 지워졌던 이유가 정확히 그 자리였다 — `hwui` 와 `frame` 이
   * `janky_frames` 1,556 대 170, `p99` 39.56 대 53 처럼 같은 이름 아래 다른 숫자를 냈고,
   * "이 앱의 p99" 에 답이 두 개가 됐다. 되살리며 건 조건은 `frame` 이 **시간축만** 낸다는
   * 것 하나이고, 그 조건은 매니페스트의 `path` 가 아니라 **이 함수가 뷰모델에 담는 키**로
   * 지켜진다 — `metrics.frame.data.p99` 처럼 새 하위 경로가 생기면 위 경로 테스트가 잡지만,
   * 이미 받은 `data` 에서 `p99` 나 `janky` 필드를 읽어 툴팁·눈금·각주에 얹는 것은 경로가
   * 그대로라 그 테스트를 통과한다.
   *
   * 그래서 뷰모델과 막대 하나의 키를 **명시적 허용 목록**과 통째로 대조한다. 여기 없는 키가
   * 하나라도 늘면 이 테스트가 먼저 깨진다 — 카운트든 백분위든, 화면에 닿기 전에 리뷰어가
   * 이 목록에 손을 대야 한다.
   *
   * **이 목록이 못 보는 자리가 하나 있다: `note` 문자열.** `frames_seen` 은 뷰모델의 키가
   * 아니라 그 문장 **안**에 섞여 화면에 닿으므로 여기 걸리지 않는다 — 앞으로 어떤 수를 그
   * 문장에 더해도 이 테스트는 통과한다. 그 자리는 위 「각주가 무엇을 센 프레임인지 말한다」가
   * 지키고, 각주에 실리는 수는 지표가 아니라 "표본을 뽑았다" 는 **고지**여야 한다
   * (`AGENTS.md` 의 프레임 타임라인 절).
   */
  it('뷰모델·막대의 키가 허용 목록과 정확히 같다 — 새 필드는 반드시 리뷰에서 보인다', () => {
    const vm = ftl(one(6, 8, 8.33))

    const VM_KEYS = [
      'width', 'bars', 'idxAt', 'guide', 'yTicks', 'xTicks', 'markLines', 'note', 'tipOf',
    ]
    const BAR_KEYS = [
      'tMs', 'tSec', 'appMs', 'presentMs', 'totalMs', 'deadlineMs', 'hz', 'x', 'w', 'app', 'present',
    ]

    expect(Object.keys(vm).sort()).toEqual([...VM_KEYS].sort())
    expect(Object.keys(vm.bars[0]!).sort()).toEqual([...BAR_KEYS].sort())
  })
})

/**
 * 매니페스트는 렌더 섹션의 타임라인 서브탭에 이 카드를 놓는다. `sub` 가 없으면 어느 탭에도
 * 안 그려져 조용히 사라지고, `frame` 은 다시 "파일에만 있는 지표" 가 된다.
 */
describe('시간별 프레임 카드', () => {
  const card = block<FrameTimelineBlock>('시간별 프레임')

  it('렌더 섹션의 타임라인 탭에 있다', () => {
    expect(card.section).toBe('render')
    expect(card.sub).toBe('timeline')
    expect(card.metric).toBe('frame')
    expect(card.path).toBe('metrics.frame.data')
  })

  /** 그려지므로 푸터의 "무시한 지표" 가 이 지표를 부를 일이 없다. */
  it('frame 은 일부러 안 그리는 지표가 아니다', () => {
    expect(NOT_DRAWN_METRICS).not.toContain('frame')
    expect(MANIFEST.some((b) => b.metric === 'frame')).toBe(true)
  })
})

/**
 * `packages/gui/AGENTS.md` 는 이 화면의 모양 목록을 **개수와 이름으로** 말한다. 새 `kind` 를
 * 늘리고 문서를 안 고치면 여기서 깨진다 — 통과하는 테스트는 문서가 맞다는 증거가 아니지만,
 * 이 테스트는 목록이 갈리는 순간을 잡는다.
 */
describe('AGENTS.md 가 말하는 모양 목록', () => {
  it('매니페스트가 쓰는 kind 가 전부 적혀 있다', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../AGENTS.md', import.meta.url)),
      'utf8',
    )
    const KO = ['영', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열']
    const kinds = [...new Set(MANIFEST.map((b) => b.kind))]
    expect(doc).toContain(`데이터 모양이 ${KO[kinds.length]} 가지`)
    for (const k of kinds) expect(doc, k).toContain(`\`${k}\``)
  })
})

/* ══════════════════ 진단 세션 (DM-13) ══════════════════ */

/**
 * **합성 진단 블록.** 이름은 SM-S901N · YouTube 실측 이름을 접은 꼴이고 값은 지어 붙였다. 순서를
 * 일부러 섞어 둔다 — 화면이 처음 순서를 스스로 지키는지 보려는 것이다. 블록은 core 의 스키마로
 * 검사한다 (`DiagnoseBlockSchema.parse`) — 시험의 문서가 실제로 나올 수 있는 모양이어야 한다.
 */
const SLICE_ROWS = [
  {
    name: 'bindApplication',
    main_thread: { count: 1, sum_ms: 67.307, max_ms: 67.307 },
    other_threads: null,
    async_tracks: null,
  },
  {
    name: 'Choreographer#doFrame *',
    main_thread: { count: 550, sum_ms: 3035.019, max_ms: 75.286 },
    other_threads: { count: 7, sum_ms: 1.362, max_ms: 0.553 },
    async_tracks: null,
  },
  {
    name: '<missing root>',
    main_thread: null,
    other_threads: { count: 1500, sum_ms: 7574.2, max_ms: 2011.3 },
    async_tracks: null,
  },
  {
    name: 'animation',
    main_thread: { count: 495, sum_ms: 830.2, max_ms: 24.9 },
    other_threads: null,
    async_tracks: null,
  },
  {
    name: 'RV Scroll',
    main_thread: { count: 364, sum_ms: 432.8, max_ms: 21.6 },
    other_threads: null,
    async_tracks: null,
  },
  {
    // 한 갈래의 slice 가 전부 끝나지 않았으면 합 · 최대가 null 이다 (README).
    name: 'onAccountReady',
    main_thread: null,
    other_threads: null,
    async_tracks: { count: 2, sum_ms: null, max_ms: null },
  },
  {
    // 같은 합 — 정렬에서 이름 순으로 갈린다.
    name: 'Zygote preload',
    main_thread: { count: 3, sum_ms: 432.8, max_ms: 200.1 },
    other_threads: null,
    async_tracks: null,
  },
]

const OPEN_UNKNOWN_REASON = renderReason({
  code: 'app_slices_open_unknown',
  detail: { sdk_int: 30, debuggable: false },
})

type DiagState =
  | 'collected' | 'open-null' | 'no-process' | 'failed' | 'stale'
  | 'ftrace-not-recorded' | 'ftrace-setup-errors'

function diagBlock(state: DiagState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    atrace_categories: ['am', 'wm', 'view'],
    atrace_apps: ['com.google.android.youtube'],
    status: 'collected',
    reason_code: null,
    reason: null,
    app_slices_open: true,
    app_slices_open_reason_code: null,
    app_slices_open_reason: null,
    trace_slices: 75800,
    target_process_slices: 62803,
    target_process_slices_unfinished: 2,
    ftrace_overrun_events: 0,
    trace_bytes: 6783480,
    target_process_slice_names_unfolded: 4921,
    target_process_slice_names: SLICE_ROWS,
  }
  const reason = (code: string, detail: Record<string, unknown> = {}): Record<string, unknown> => ({
    reason_code: code,
    reason: renderReason({ code, detail } as Parameters<typeof renderReason>[0]),
  })
  const noSlices = {
    target_process_slices: null,
    target_process_slices_unfinished: null,
    target_process_slice_names_unfolded: null,
    target_process_slice_names: null,
  }
  switch (state) {
    case 'collected':
      return base
    case 'open-null':
      return {
        ...base,
        app_slices_open: null,
        app_slices_open_reason_code: 'app_slices_open_unknown',
        app_slices_open_reason: OPEN_UNKNOWN_REASON,
      }
    case 'no-process':
      return {
        ...base, ...noSlices, status: 'partial',
        ...reason('process_not_in_trace', { package: 'com.google.android.youtube' }),
      }
    case 'failed':
      return {
        ...base, ...noSlices, status: 'failed', ...reason('trace_missing'),
        trace_slices: null, ftrace_overrun_events: null, trace_bytes: null,
      }
    case 'stale':
      return {
        ...base, status: 'partial',
        ...reason('process_name_stale_in_trace', {
          pid: 10046, trace_name: '<pre-initialized>', package: 'com.google.android.youtube',
        }),
      }
    case 'ftrace-not-recorded':
      return {
        ...base, ...noSlices, status: 'partial', ...reason('ftrace_not_recorded'),
        trace_slices: null, ftrace_overrun_events: null,
      }
    case 'ftrace-setup-errors':
      return { ...base, status: 'partial', ...reason('ftrace_setup_errors', { setup_errors: 28 }) }
  }
}

/** 진단 세션 문서 — 진단 여부 · 블록 · 원본 경로. 원본이 없으면(failed) `artifacts.trace` 도 null. */
function diagDoc(state: DiagState): Record<string, unknown> {
  const block = DiagnoseBlockSchema.parse(diagBlock(state))
  return {
    schema_version: '1.2.0',
    session: { id: 'a1b2c3', name: '유튜브 진단', state: 'completed', options: { launch: true, diagnose: true } },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: 5570, tracing_processes_cpu_share_pct: 1,
      tracing_processes_peak_rss_kb: 15436, adb_commands_during_session: 0, trace_buffer_overrun: false,
    },
    artifacts: { trace: state === 'failed' ? null : 'trace.perfetto-trace', raw: [] },
    diagnose: block,
  }
}

const DIAG_STATES: DiagState[] = [
  'collected', 'open-null', 'no-process', 'failed', 'stale', 'ftrace-not-recorded', 'ftrace-setup-errors',
]
const DIAG_BLOCKS = MANIFEST.filter((b) => b.section === 'diagnose')
const SLICE_CARD = MANIFEST.find((b) => b.kind === 'slicetable') as SliceTableBlock

/**
 * **진단 블록의 필드가 화면 어디에 나오는가** (plan D27 — 자리 다섯).
 *
 * 1. 행 — pairs 카드의 라벨이 필드 경로이고 값 칸이 그 값을 같은 포맷으로 낸다 (null 이면 `값 없음`)
 * 2. 카드 배지 — `status` 가 unsupported · skipped · failed
 * 3. 카드 제목 title — `reason` 문장. partial 의 `status` · `reason_code` 도 이 자리로 센다
 * 4. 열림 행 title — `app_slices_open_reason`
 * 5. null 값 자리의 코드 — 열림 행(`app_slices_open_reason_code`) · 표 자리(블록 `reason_code`)
 *
 * 뷰모델에서 거꾸로 센다 — 선언이 아니라 **그려질 것**이 근거다.
 */
function diagnosePlaces(doc: unknown): Map<string, string[]> {
  const places = new Map<string, string[]>()
  const add = (field: string, place: string): void => {
    places.set(field, [...(places.get(field) ?? []), place])
  }
  const block = readPath(doc, 'diagnose') as Record<string, unknown>

  for (const b of DIAG_BLOCKS) {
    const state = blockState(doc, b)
    const badge = badgeOf(state)
    if (badge !== null && badge === STATUS_LABEL[block['status'] as string]) add('status', `배지:${b.title}`)
    if (state.reason !== null && state.reason === block['reason']) {
      add('reason', `제목 title:${b.title}`)
      // D27 — partial · failed 의 status · reason_code 는 그 문장으로 센다.
      if (block['status'] !== 'collected') {
        add('status', `제목 title:${b.title}`)
        add('reason_code', `제목 title:${b.title}`)
      }
    }

    if (b.kind === 'pairs') {
      const vm = buildPairs(b, doc)
      if ((vm as NoneVm).none === true) continue
      for (const [i, row] of (vm as PairsVm).rows.entries()) {
        const key = b.keys![i]!
        // 원본 카드는 루트 경로(`diagnose.trace_bytes`) · 나머지는 블록 기준(`trace_slices`).
        const field = key.p.startsWith('diagnose.') ? key.p.slice('diagnose.'.length) : key.p
        const own = b.path === 'diagnose' || key.p.startsWith('diagnose.')
        if (!own) continue
        if (row.label === key.p && row.value === fmtValue(block[field] as never, key.f)) add(field, `행:${b.title}`)
        if (row.title !== undefined && row.title === block['app_slices_open_reason']) {
          add('app_slices_open_reason', `열림 행 title`)
        }
        if (row.code !== undefined && row.code === block['app_slices_open_reason_code']) {
          add('app_slices_open_reason_code', `열림 행 코드`)
        }
      }
    }

    if (b.kind === 'slicetable') {
      const vm = buildSliceTable(b, doc)
      const names = block['target_process_slice_names'] as { name: string }[] | null
      if ((vm as NoneVm).none === true) {
        // 표 자리의 `값 없음` + 블록 코드.
        if (names === null && state.reasonCode === block['reason_code']) {
          add('target_process_slice_names', '표 자리 값 없음')
          add('reason_code', '표 자리 코드')
        }
      } else {
        const t = vm as SliceTableVm
        const want = [...names!].map((r) => r.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        if (t.rows.length === names!.length && t.rows.every((r, i) => r.name === want[i])) {
          add('target_process_slice_names', '표')
        }
      }
    }
  }
  return places
}

describe('DM-13 진단 탭 전 필드', () => {
  /** 스키마가 블록에 필드를 늘리면 여기서 먼저 깨진다 — 그 필드의 자리를 정하기 전엔 통과하지 않는다. */
  it('DM-13 진단 탭 전 필드 — 블록 필드 목록이 core 스키마와 같다 (시험 문서가 전부를 싣는다)', () => {
    const schemaKeys = Object.keys(DiagnoseBlockSchema.shape).sort()
    for (const s of DIAG_STATES) expect(Object.keys(diagBlock(s)).sort(), s).toEqual(schemaKeys)
    // 표 한 행 · 갈래 하나의 필드도 매니페스트가 선언한 것과 같다.
    expect(Object.keys(SliceNameRowSchema.shape).sort()).toEqual(
      [SLICE_CARD.nameField, ...SLICE_CARD.groups.map((g) => g.field)].sort(),
    )
    expect(Object.keys(SliceBranchStatsSchema.shape).sort()).toEqual(SLICE_CARD.stats.map((s) => s.field).sort())
  })

  for (const s of DIAG_STATES) {
    it(`DM-13 진단 탭 전 필드 — ${s}: 블록의 모든 필드가 다섯 자리 중 하나에 나온다`, () => {
      const doc = diagDoc(s)
      const block = doc['diagnose'] as Record<string, unknown>
      const places = diagnosePlaces(doc)

      const hidden = Object.keys(block).filter((k) => !places.has(k))
      // 화면에 안 나와도 되는 것은 **값이 없어 말할 것이 없는 이유 칸**과 `collected`(배지 없음 ·
      // 제목 툴팁 없음 — 지표 카드와 같은 관례)뿐이다.
      const silentOk = hidden.filter((k) => {
        if (k === 'status') return block['status'] === 'collected'
        if (k === 'reason_code' || k === 'reason') return block[k] === null && block['status'] === 'collected'
        if (k === 'app_slices_open_reason_code' || k === 'app_slices_open_reason') {
          return block[k] === null && block['app_slices_open'] === true
        }
        return false
      })
      expect(hidden.filter((k) => !silentOk.includes(k)), JSON.stringify([...places])).toEqual([])
    })
  }

  it('DM-13 collected 는 배지도 제목 title 도 없다 — 지표 카드와 같은 관례', () => {
    const doc = diagDoc('collected')
    for (const b of DIAG_BLOCKS) {
      expect(badgeOf(blockState(doc, b)), b.title).toBeNull()
      expect(blockState(doc, b).reason, b.title).toBeNull()
    }
  })

  it('DM-13 failed 는 네 카드에 배지 · 제목 title, 표 자리는 값 없음 + trace_missing', () => {
    const doc = diagDoc('failed')
    for (const b of DIAG_BLOCKS) {
      expect(badgeOf(blockState(doc, b)), b.title).toBe('실패')
      expect(blockState(doc, b).reason, b.title).toBe('트레이스 원본이 없습니다.')
    }
    const vm = buildSliceTable(SLICE_CARD, doc)
    expect((vm as NoneVm).none).toBe(true)
    expect((vm as NoneVm).label).toBe(NONE_NULL)
    expect(blockState(doc, SLICE_CARD).reasonCode).toBe('trace_missing')
    // 표가 없으면 카드 단위(행 수)도 없다 — `0행` 이 아니다.
    expect(cardUnit(SLICE_CARD, vm, true)).toBe('')
    // 원본 경로가 null 이면 `값 없음` 은 문장이라 등폭이 아니다.
    const source = DIAG_BLOCKS.find((b) => b.title === '원본') as PairsBlock
    const trace = (buildPairs(source, doc) as PairsVm).rows[0]!
    expect(trace.value).toBe(NONE_NULL)
    expect(trace.mono).toBeUndefined()
  })

  /** 열림은 블록 status 와 따로 간다 — null 이어도 블록은 collected 이고 표가 있다 (README · D34). */
  it('DM-13 열림 null — 열림 행만 값 없음 + 코드 · 문장은 그 행 title, 표는 그대로', () => {
    const doc = diagDoc('open-null')
    const scope = DIAG_BLOCKS.find((b) => b.title === '기록 범위') as PairsBlock
    const row = (buildPairs(scope, doc) as PairsVm).rows.find((r) => r.label === 'app_slices_open')!
    expect(row.value).toBe(NONE_NULL)
    expect(row.code).toBe('app_slices_open_unknown')
    expect(row.title).toBe(OPEN_UNKNOWN_REASON)
    expect((buildSliceTable(SLICE_CARD, doc) as SliceTableVm).rows).toHaveLength(SLICE_ROWS.length)
    expect(badgeOf(blockState(doc, scope))).toBeNull()
  })

  /** 값이 있으면 이유를 달지 않는다 — 멀쩡한 값까지 의심하게 만든다. */
  it('DM-13 열림 true 면 그 행에 코드도 title 도 없다', () => {
    const scope = DIAG_BLOCKS.find((b) => b.title === '기록 범위') as PairsBlock
    const row = (buildPairs(scope, diagDoc('collected')) as PairsVm).rows.find((r) => r.label === 'app_slices_open')!
    expect(row.value).toBe('예')
    expect(row.code).toBeUndefined()
    expect(row.title).toBeUndefined()

    // 이유 칸에 무엇이 남아 있어도 값이 있으면 달지 않는다 — 값이 이긴다 (stat 카드와 같은 규칙).
    const odd = { diagnose: { app_slices_open: true, app_slices_open_reason_code: 'x', app_slices_open_reason: 'y' } }
    const oddRow = (buildPairs(scope, odd) as PairsVm).rows.find((r) => r.label === 'app_slices_open')!
    expect(oddRow.code).toBeUndefined()
    expect(oddRow.title).toBeUndefined()
  })

  /** 그 밖의 null 칸은 `값 없음` 만 — 코드는 열림 행과 표 자리에만 붙는다 (시안 · D27). */
  it('DM-13 no-process — 대상 앱 몫 칸은 값 없음만 · 코드는 표 자리에만', () => {
    const doc = diagDoc('no-process')
    const counts = DIAG_BLOCKS.find((b) => b.title === 'slice 수') as PairsBlock
    const rows = (buildPairs(counts, doc) as PairsVm).rows
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]))
    expect(byLabel['trace_slices']!.value).toBe('75,800')
    for (const k of ['target_process_slices', 'target_process_slices_unfinished', 'target_process_slice_names_unfolded']) {
      expect(byLabel[k]!.value, k).toBe(NONE_NULL)
      expect(byLabel[k]!.code, k).toBeUndefined()
    }
    expect(blockState(doc, SLICE_CARD).reasonCode).toBe('process_not_in_trace')
  })

  it('DM-13 원본 경로가 보인다 — 라벨은 루트 경로 그대로, 경로는 자르지 않는다', () => {
    const source = DIAG_BLOCKS.find((b) => b.title === '원본') as PairsBlock
    const rows = (buildPairs(source, diagDoc('collected')) as PairsVm).rows
    expect(rows.map((r) => r.label)).toEqual(['artifacts.trace', 'diagnose.trace_bytes'])
    expect(rows[0]!.value).toBe('trace.perfetto-trace')
    expect(rows[0]!.wrap).toBe(true)
    expect(rows[0]!.mono).toBe(true)
    expect(rows[1]!.value).toBe('6.47 MB')
  })

  it('DM-13 slice 표 카드 단위는 행 수를 말한다 — 프레임워크와 앱 slice 를 가르지 않는 범위', () => {
    const doc = diagDoc('collected')
    expect(cardUnit(SLICE_CARD, buildSliceTable(SLICE_CARD, doc), true)).toBe(`대상 앱 프로세스 · ${SLICE_ROWS.length}행`)
  })
})

describe('DM-13 행 모델 자르지 않음 · 구별 없음', () => {
  const vmOf = (rows: unknown[]): SliceTableVm =>
    buildSliceTable(SLICE_CARD, { diagnose: { target_process_slice_names: rows } }) as SliceTableVm

  it('DM-13 행 모델 자르지 않음 — 1만 행이 1만 행이다', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      name: `slice ${String(i).padStart(5, '0')}`,
      main_thread: { count: i + 1, sum_ms: i * 1.5, max_ms: i },
      other_threads: null,
      async_tracks: null,
    }))
    const vm = vmOf(many)
    expect(vm.rows).toHaveLength(10_000)
    expect(vm.unit).toBe('대상 앱 프로세스 · 10,000행')
  })

  it('DM-13 행 모델 자르지 않음 — 이름은 원문 그대로다 (435자)', () => {
    const long = `startActivity: Intent { ${'x'.repeat(400)} }`.padEnd(435, 'y')
    expect(long).toHaveLength(435)
    const vm = vmOf([{ name: long, main_thread: { count: 1, sum_ms: 12.4, max_ms: 12.4 }, other_threads: null, async_tracks: null }])
    expect(vm.rows[0]!.name).toBe(long)
  })

  it('DM-13 처음 순서는 이름의 코드 단위 순이다 — 로캘 순이 아니다', () => {
    const vm = vmOf(SLICE_ROWS)
    expect(vm.rows.map((r) => r.name)).toEqual([
      '<missing root>', 'Choreographer#doFrame *', 'RV Scroll', 'Zygote preload',
      'animation', 'bindApplication', 'onAccountReady',
    ])
    // 로캘 순이면 `animation` 이 `Zygote preload` 보다 앞에 온다 — 그 순서가 아님을 못 박는다.
    const names = vm.rows.map((r) => r.name)
    expect(names.indexOf('Zygote preload')).toBeLessThan(names.indexOf('animation'))
  })

  it('DM-13 행 모델 구별 없음 — 모든 행이 이름과 칸뿐이고 모양이 같다', () => {
    const vm = vmOf(SLICE_ROWS)
    for (const r of vm.rows) {
      expect(Object.keys(r).sort()).toEqual(['cells', 'name'])
      expect(r.cells).toHaveLength(9)
      for (const c of r.cells) expect(Object.keys(c).sort()).toEqual(['nil', 'text'])
    }
    // 뷰모델 전체에도 순위 · 강조 · 상위 N 자리가 없다.
    expect(Object.keys(vm).sort()).toEqual(['columns', 'groups', 'nameLabel', 'rows', 'unit', 'values'])
  })

  it('DM-13 빈 갈래는 — 이고 0 이 아니다 · 끝나지 않은 slice 만 있으면 합 · 최대가 — 다', () => {
    const vm = vmOf(SLICE_ROWS)
    const bind = vm.rows.find((r) => r.name === 'bindApplication')!
    expect(bind.cells.map((c) => c.text)).toEqual(['1', '67.3', '67.3', '—', '—', '—', '—', '—', '—'])
    const open = vm.rows.find((r) => r.name === 'onAccountReady')!
    expect(open.cells.slice(6).map((c) => c.text)).toEqual(['2', '—', '—'])
    expect(open.cells.slice(6).map((c) => c.nil)).toEqual([false, true, true])
  })

  it('DM-13 표가 null 이면 0행이 아니라 값 없음 · 필드가 없으면 수집 안 함', () => {
    expect((buildSliceTable(SLICE_CARD, { diagnose: { target_process_slice_names: null } }) as NoneVm).label).toBe(NONE_NULL)
    expect((buildSliceTable(SLICE_CARD, {}) as NoneVm).label).toContain(NONE_MISSING)
  })

  /** `[]` 는 "프로세스는 찾았고 slice 가 0개" 다 — 재 봤더니 없었다. 표는 서고 단위가 0행을 말한다. */
  it('DM-13 빈 배열은 0행 표다 — 값 없음이 아니다', () => {
    const vm = vmOf([])
    expect((vm as unknown as NoneVm).none).toBeUndefined()
    expect(vm.rows).toEqual([])
    expect(vm.unit).toBe('대상 앱 프로세스 · 0행')
  })
})

describe('DM-13 정렬은 사람이 고를 때만', () => {
  const vm = buildSliceTable(SLICE_CARD, { diagnose: { target_process_slice_names: SLICE_ROWS } }) as SliceTableVm
  const names = (s: SliceSort): string[] => sortSliceRows(vm, s).map((r) => r.name)

  it('DM-13 처음 정렬 상태는 이름 오름이고 그때 순서는 처음 순서 그대로다', () => {
    expect(INITIAL_SORT).toEqual({ key: 'name', dir: 'asc' })
    expect(names(INITIAL_SORT)).toEqual(vm.rows.map((r) => r.name))
  })

  it('DM-13 숫자 열 첫 누름은 내림 · 다시 누르면 오름 · 이름 첫 누름은 오름', () => {
    const s1 = nextSort(INITIAL_SORT, 'main_thread.sum_ms')
    expect(s1).toEqual({ key: 'main_thread.sum_ms', dir: 'desc' })
    expect(nextSort(s1, 'main_thread.sum_ms')).toEqual({ key: 'main_thread.sum_ms', dir: 'asc' })
    expect(nextSort(s1, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort(INITIAL_SORT, 'name')).toEqual({ key: 'name', dir: 'desc' })
  })

  it('DM-13 빈 칸은 방향과 무관하게 끝 · 같은 값은 이름 코드 단위 순', () => {
    const desc = names({ key: 'main_thread.sum_ms', dir: 'desc' })
    expect(desc).toEqual([
      'Choreographer#doFrame *', 'animation', 'RV Scroll', 'Zygote preload', 'bindApplication',
      '<missing root>', 'onAccountReady',
    ])
    const asc = names({ key: 'main_thread.sum_ms', dir: 'asc' })
    expect(asc).toEqual([
      'bindApplication', 'RV Scroll', 'Zygote preload', 'animation', 'Choreographer#doFrame *',
      '<missing root>', 'onAccountReady',
    ])
  })

  it('DM-13 정렬은 새 배열이다 — 처음 순서를 망가뜨리지 않는다', () => {
    const before = vm.rows.map((r) => r.name)
    names({ key: 'other_threads.count', dir: 'desc' })
    expect(vm.rows.map((r) => r.name)).toEqual(before)
  })

  it('DM-13 aria-sort · 표시는 정렬된 열에만', () => {
    const s: SliceSort = { key: 'async_tracks.count', dir: 'desc' }
    expect(ariaSort(s, 'async_tracks.count')).toBe('descending')
    expect(ariaSort(s, 'name')).toBe('none')
    expect(sortMark(s, 'async_tracks.count')).toBe('▼')
    expect(sortMark({ key: 'name', dir: 'asc' }, 'name')).toBe('▲')
    expect(sortMark(s, 'main_thread.count')).toBe('')
  })

  it('DM-13 정렬할 수 있는 머리는 이름 + 갈래 셋 × 수 셋 = 10개', () => {
    expect(1 + vm.columns.length).toBe(10)
    expect(vm.columns.map((c) => c.key)).toEqual([
      'main_thread.count', 'main_thread.sum_ms', 'main_thread.max_ms',
      'other_threads.count', 'other_threads.sum_ms', 'other_threads.max_ms',
      'async_tracks.count', 'async_tracks.sum_ms', 'async_tracks.max_ms',
    ])
  })
})

describe('DM-13 평소 보고서 그대로', () => {
  const overhead = MANIFEST.find((b) => b.title === '측정 비용')!

  it('DM-13 평소 보고서 그대로 — 탭 둘 · 진단 pill 없음 · 측정 비용 단위 없음', () => {
    for (const doc of [FULL, LEGACY, LOWEND]) {
      expect(isDiagnoseSession(doc)).toBe(false)
      expect(tabsFor(doc).map((t) => t.id)).toEqual(['summary', 'device'])
      expect(buildHeader(doc).diagnosePill).toBeNull()
      expect(cardUnit(overhead, buildPairs(overhead as PairsBlock, doc), isDiagnoseSession(doc))).toBe('')
    }
  })

  it('DM-13 진단 세션 — 탭 셋 · 진단 pill · 측정 비용 단위 앱 프로세스 몫 미포함', () => {
    const doc = diagDoc('collected')
    expect(tabsFor(doc).map((t) => t.label)).toEqual(['요약', '기기', '진단'])
    expect(buildHeader(doc).diagnosePill).toBe('진단')
    expect(cardUnit(overhead, buildPairs(overhead as PairsBlock, doc), true)).toBe('앱 프로세스 몫 미포함')
  })

  /** 기준은 `session.options.diagnose === true` 하나 — 블록만 있거나 `false` 면 진단 세션이 아니다. */
  it('DM-13 진단 여부는 options.diagnose === true 하나로 정한다', () => {
    expect(isDiagnoseSession({ session: { options: { diagnose: false } }, diagnose: {} })).toBe(false)
    expect(isDiagnoseSession({ diagnose: {} })).toBe(false)
    expect(isDiagnoseSession({ session: { options: { diagnose: 'true' } } })).toBe(false)
    expect(isDiagnoseSession({ session: { options: { diagnose: true } } })).toBe(true)
  })

  /** 평소 보고서의 기존 블록은 진단 칸이 생기기 전과 같은 뷰모델이다 — 새 칸(코드 · title · mono)이 안 붙는다. */
  it('DM-13 평소 보고서 그대로 — 기존 pairs 행에 새 칸이 붙지 않는다', () => {
    for (const b of MANIFEST.filter((x) => x.kind === 'pairs' && x.section !== 'diagnose')) {
      const vm = buildPairs(b as PairsBlock, FULL)
      if ((vm as NoneVm).none === true) continue
      for (const r of (vm as PairsVm).rows) expect(Object.keys(r).sort(), b.title).toEqual(['label', 'share', 'value', 'wrap'])
    }
  })
})
