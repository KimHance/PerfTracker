import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeMaxT, readMarks } from '../src/web/report/axis.js'
import {
  buildBars,
  buildDelta,
  buildDistribution,
  buildPairs,
  buildSeries,
  buildStat,
  metricState,
  type NoneVm,
  type SeriesVm,
} from '../src/web/report/blocks.js'
import { fmtValue, NONE_MISSING, NONE_NULL } from '../src/web/report/format.js'
import { buildHeader } from '../src/web/report/header.js'
import { MANIFEST, SECTIONS } from '../src/web/report/manifest.js'
import { MISSING, readPath } from '../src/web/report/read.js'
import type {
  BarsBlock,
  DeltaBlock,
  DistributionBlock,
  PairsBlock,
  SeriesBlock,
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
          else if (b.kind === 'bars') buildBars(b, doc)
          else if (b.kind === 'delta') buildDelta(b, doc)
          else if (b.kind === 'pairs') buildPairs(b, doc)
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
  it('frame 이 통째로 없으면 분포는 "수집 안 함" 이다 — 빈 차트가 아니다', () => {
    const vm = buildDistribution(block<DistributionBlock>('프레임 지속 시간 분포'), LOWEND, 900)
    expect((vm as NoneVm).none).toBe(true)
    expect((vm as NoneVm).label).toContain(NONE_MISSING)
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
    expect(metricState(LOWEND, 'frame').status).toBe('unsupported')
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
    const b = block<DistributionBlock>('프레임 지속 시간 분포')
    const vm = buildDistribution(b, FULL, 900)
    const buckets = readPath(FULL, b.path) as unknown[]

    expect(b.breakAfterEmptyBuckets).toBe(Infinity)
    expect((vm as { bars: unknown[] }).bars).toHaveLength(buckets.length)
    expect((vm as { breaks: unknown[] }).breaks).toHaveLength(0)
  })

  it('툴팁에 누적 비율을 넣지 않는다 — 버킷은 시간축이 아니다', () => {
    const vm = buildDistribution(block<DistributionBlock>('프레임 지속 시간 분포'), FULL, 900)
    const tip = (vm as { tipOf: (i: number) => { sub: string } }).tipOf(1)
    expect(tip.sub).toContain('전체의')
    expect(tip.sub).not.toContain('누적')
  })

  it('상한 없는 마지막 버킷은 "이상" 으로 읽힌다', () => {
    const vm = buildDistribution(block<DistributionBlock>('프레임 지속 시간 분포'), FULL, 900)
    const buckets = readPath(FULL, 'metrics.frame.data.buckets') as unknown[]
    const tip = (vm as { tipOf: (i: number) => { head: string } }).tipOf(buckets.length - 1)
    expect(tip.head).toContain('이상')
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
    const rows = (vm as { rows: { label: string; before: string; after: string }[] }).rows
    expect(rows[0]!.before).toBe('100%')
    expect(rows[0]!.after).toBe(NONE_NULL)
  })
})

describe('stat', () => {
  it('값이 없으면 단위를 붙이지 않는다 — "수집 안 함 ms" 가 되면 안 된다', () => {
    const vm = buildStat(block<StatBlock>('앱 시작'), { metrics: {} })
    expect(vm.value).toBe(NONE_MISSING)
    expect(vm.unit).toBe('')
    expect(vm.dim).toBe(true)
  })
})

describe('지표 상태', () => {
  it('status 와 reason_code 를 끌어온다', () => {
    expect(metricState(LOWEND, 'frame').status).toBe('unsupported')
    expect(metricState(LOWEND, 'frame').reasonCode).toBe('sdk_too_low')
  })

  it('지표에 속하지 않는 블록은 상태가 없다', () => {
    expect(metricState(FULL, undefined).status).toBeNull()
  })
})

describe('매니페스트에 없는 지표', () => {
  it('무시한 개수를 푸터에 남긴다 — 조용히 버리면 새 지표가 생겨도 아무도 모른다', () => {
    const h = buildHeader({ metrics: { frame: { status: 'collected' }, battery: { status: 'collected' } } })
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

describe('프레임 꼬리표 — 기기가 붙인 것', () => {
  const block = MANIFEST.find((b) => b.title === '프레임 꼬리표') as BarsBlock

  it('개수와 퍼센트를 함께 낸다', () => {
    const doc = {
      metrics: {
        frame: {
          data: {
            jank: {
              total_frames: 1000,
              by_type: [
                { type: 'Buffer Stuffing', count: 800 },
                { type: 'Dropped Frame', count: 101 },
              ],
            },
          },
        },
      },
    }
    const vm = buildBars(block, doc) as { rows: { label: string; value: string }[] }
    expect(vm.rows[0]!.value).toBe('800 · 80.0%')
    expect(vm.rows[1]!.value).toBe('101 · 10.1%')
  })

  it('분모는 전체 프레임이다 — 막대의 합이 아니다', () => {
    // 꼬리표는 겹치므로 합(1,100)으로 나누면 각 비율이 실제보다 작아진다.
    const doc = {
      metrics: {
        frame: {
          data: {
            jank: {
              total_frames: 1000,
              by_type: [
                { type: 'A', count: 600 },
                { type: 'B', count: 500 },
              ],
            },
          },
        },
      },
    }
    const vm = buildBars(block, doc) as { rows: { value: string }[] }
    expect(vm.rows[0]!.value).toBe('600 · 60.0%')
  })

  it('분모가 없으면 퍼센트를 지어내지 않는다', () => {
    const doc = { metrics: { frame: { data: { jank: { by_type: [{ type: 'A', count: 5 }] } } } } }
    const vm = buildBars(block, doc) as { rows: { value: string }[] }
    expect(vm.rows[0]!.value).toBe('5')
  })

  it('꼬리표 카드는 두 번째 계열색을 쓴다 — 다른 카드와 구분된다', () => {
    expect(block.tone).toBe('alt')
    // 색이 판정으로 읽히지 않게, 이 화면에서 tone 을 쓰는 곳은 frame 지표뿐이어야 한다.
    expect(MANIFEST.filter((b) => b.tone === 'alt').every((b) => b.metric === 'frame')).toBe(true)
  })
})
