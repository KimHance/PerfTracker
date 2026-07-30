import type { Mark } from './axis.js'
import type { Fmt } from './format.js'
import { clock, fmtAxis, fmtValue, niceMax, nf, NONE_MISSING, NONE_NULL } from './format.js'
import type {
  BarsBlock,
  Block,
  DeltaBlock,
  DistributionBlock,
  PairsBlock,
  SeriesBlock,
  StatBlock,
} from './manifest.js'
import { MISSING, type Read, readPath } from './read.js'

/**
 * **블록의 뷰모델을 만드는 순수 함수들.**
 *
 * 여기 있는 것: 기하 계산, 결측 판정, 문자열 포맷.
 * 여기 **없는** 것: React, DOM, 이벤트. 그것들은 `.tsx` 의 몫이다.
 *
 * 이렇게 가르는 이유는 core 의 `sources/` ↔ `toDomain.ts` 와 같다 — 규칙을 기기(여기서는
 * 브라우저) 없이 테스트할 수 있어야 한다. 선을 어디서 끊는가, 첫 초를 뺄 것인가 같은
 * 판단이 전부 이 파일에 있고, 그것이 이 화면에서 틀리면 가장 비싼 종류의 오류다.
 */

export interface NoneVm {
  none: true
  /** `수집 안 함 — <경로> 없음` 인지 `값 없음` 인지. 둘은 다른 사실이다. */
  label: string
}

/** 데이터가 없을 때의 뷰모델. `MISSING` 과 `null` 을 여기서 마지막으로 가른다. */
function none(raw: Read, path: string | undefined): NoneVm {
  return {
    none: true,
    label: raw === MISSING ? `${NONE_MISSING} — ${path ?? ''} 없음` : NONE_NULL,
  }
}

function isEmptyArray(raw: Read): boolean {
  return !Array.isArray(raw) || raw.length === 0
}

/* ══════════════════ 시계열 ══════════════════ */

export const SW = 300
export const SH = 118
export const SPAD = { l: 36, r: 8, t: 10, b: 26 }

export interface SeriesVm {
  none?: false
  /** 선 조각들. **`null` 인 초에서 끊긴다.** */
  segments: string[]
  /** 점 하나짜리 조각. 선을 그릴 수 없어 점으로 남긴다 — 버리면 잰 값이 사라진다. */
  singletons: { x: number; y: number }[]
  /** 부분집합 보조선(점선). 쌓지 않는다. */
  subSegments: string[]
  /** 표본이 없는 초의 회색 띠. 선이 끊긴 이유가 화면에 남아야 한다. */
  gaps: { x: number; w: number }[]
  yTicks: { y: number; gy: number; label: string }[]
  xTicks: { x: number; anchor: 'start' | 'middle' | 'end'; label: string }[]
  markLines: { x: number; hot: boolean }[]
  /** 호버 커서. 값이 없는 초에서는 점을 찍지 않는다(`r === 0`). */
  cursor: { on: boolean; x: number; y: number; r: number }
  summary: string
  readout: string
  readoutKind: 'idle' | 'value' | 'nosample'
  footnote: string
  /** 화면 x 좌표(0~1) → 초. 호버 핸들러가 쓴다. */
  tAt: (ratio: number) => number
}

export function buildSeries(
  b: SeriesBlock,
  res: unknown,
  maxT: number,
  marks: Mark[],
  hoverT: number | null,
): SeriesVm | NoneVm {
  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return none(raw, b.path)

  const tf = b.transform ?? ((v: number) => v)
  const pts = new Map<number, number>()
  const subPts = new Map<number, number>()
  for (const row of raw as Record<string, unknown>[]) {
    const t = row['t_s']
    if (typeof t !== 'number') continue
    const v = row[b.field]
    if (typeof v === 'number') pts.set(t, tf(v))
    if (b.subField !== undefined) {
      const sv = row[b.subField]
      if (typeof sv === 'number') subPts.set(t, tf(sv))
    }
  }
  if (pts.size === 0) return none(null, b.path)

  const all = [...pts.values(), ...subPts.values()]
  const dataMax = Math.max(...all)
  const dataMin = Math.min(...all)
  const yMax = niceMax(dataMax)
  // baseline:'data' 는 0 근처를 지나지 않는 계열용이다. 0 기준으로 그리면 선이 화면
  // 위쪽에 눌린 직선이 되어 변동이 안 보인다 (기기 가용 메모리가 그렇다).
  const yMin = b.baseline === 'data' ? Math.max(0, Math.floor(dataMin / (yMax / 10)) * (yMax / 10)) : 0
  const span = yMax - yMin || 1

  const px = (t: number): number => SPAD.l + (maxT === 0 ? 0 : (t / maxT) * (SW - SPAD.l - SPAD.r))
  const py = (v: number): number => SH - SPAD.b - ((v - yMin) / span) * (SH - SPAD.t - SPAD.b)

  // 누적 카운터는 0초가 없는 것이 정상이라 그 초를 "빠진 것" 으로 세지 않는다.
  const firstExpected = b.sampling === 'cumulative' ? 1 : 0

  const runs = (has: (t: number) => boolean): number[][] => {
    const out: number[][] = []
    let cur: number[] = []
    for (let t = firstExpected; t <= maxT; t++) {
      if (has(t)) cur.push(t)
      else if (cur.length > 0) { out.push(cur); cur = [] }
    }
    if (cur.length > 0) out.push(cur)
    return out
  }

  const toPath = (run: number[], map: Map<number, number>): string =>
    run.map((t, i) => `${i === 0 ? 'M' : 'L'}${px(t).toFixed(1)} ${py(map.get(t)!).toFixed(1)}`).join(' ')

  const valueRuns = runs((t) => pts.has(t))
  const gapRuns = runs((t) => !pts.has(t))

  const yVals = [yMin, yMin + (yMax - yMin) / 2, yMax]
  const step = maxT <= 12 ? 3 : maxT <= 30 ? 10 : maxT <= 70 ? 20 : 30
  const xs: number[] = []
  for (let t = 0; t <= maxT; t += step) xs.push(t)
  if (xs[xs.length - 1] !== maxT) xs.push(maxT)

  const vv = [...pts.values()]
  const vAvg = vv.reduce((a, x) => a + x, 0) / vv.length
  const summary =
    `min ${fmtValue(Math.min(...vv), b.fmt)} · avg ${fmtValue(vAvg, b.fmt)} · max ${fmtValue(Math.max(...vv), b.fmt)}`

  const has = hoverT !== null && pts.has(hoverT)
  const sub = b.subField !== undefined && hoverT !== null && subPts.has(hoverT)
    ? ` · ${b.subLabel} ${fmtValue(subPts.get(hoverT)!, b.fmt)}`
    : ''

  return {
    segments: valueRuns.filter((r) => r.length > 1).map((r) => toPath(r, pts)),
    singletons: valueRuns
      .filter((r) => r.length === 1)
      .map((r) => ({ x: px(r[0]!), y: py(pts.get(r[0]!)!) })),
    subSegments:
      b.subField === undefined
        ? []
        : runs((t) => subPts.has(t)).filter((r) => r.length > 1).map((r) => toPath(r, subPts)),
    gaps: gapRuns.map((r) => ({
      x: px(r[0]!) - (r.length === 1 ? 1.5 : 0),
      w: Math.max(3, px(r[r.length - 1]!) - px(r[0]!)),
    })),
    yTicks: yVals.map((v) => ({ y: py(v) + 3, gy: py(v), label: fmtAxis(v) })),
    xTicks: xs.map((t, i) => ({
      x: px(t),
      anchor: i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle',
      label: `${t}s`,
    })),
    markLines: marks.map((mk) => ({ x: px(mk.t), hot: hoverT === mk.t })),
    cursor: {
      on: hoverT !== null && hoverT >= 0 && hoverT <= maxT,
      x: hoverT === null ? 0 : px(hoverT),
      y: has ? py(pts.get(hoverT)!) : SH - SPAD.b,
      r: has ? 3 : 0,
    },
    summary,
    readout:
      hoverT === null
        ? summary
        : has
          ? `${clock(hoverT)} · ${fmtValue(pts.get(hoverT)!, b.fmt)}${sub}`
          : `${clock(hoverT)} · 표본 없음`,
    readoutKind: hoverT === null ? 'idle' : has ? 'value' : 'nosample',
    footnote: b.subField === undefined ? '' : `점선 ${b.subLabel}`,
    tAt: (ratio) => {
      const rel = ratio * SW
      const t = Math.round(((rel - SPAD.l) / (SW - SPAD.l - SPAD.r)) * maxT)
      return Math.max(0, Math.min(maxT, t))
    },
  }
}

/* ══════════════════ 분포 ══════════════════ */

export const DH = 168
export const DPAD = { l: 44, r: 10, t: 18, b: 30 }

interface Bucket {
  from_ms: number
  to_ms: number | null
  count: number
}

export interface DistributionVm {
  none?: false
  width: number
  bars: { idx: number; x: number; y: number; w: number; h: number; rx: number }[]
  /** 히트 영역은 **슬롯 전체 높이**다 — 막대가 아니다. 얇은 막대와 빈 칸도 잡힌다. */
  hits: { idx: number; x: number; w: number }[]
  breaks: { x: number; label: string }[]
  xLabels: { x: number; label: string }[]
  yTicks: { y: number; gy: number; label: string }[]
  pLines: { x: number; label: string }[]
  percentiles: { k: string; v: string }[]
  /** 백분위 옆에 서는 비율 하나(jank %). 분자·분모를 못 읽었으면 `null` 이다. */
  share: { k: string; v: string } | null
  footnote: string
  /** 툴팁 내용. **누적 비율을 넣지 않는다** — 버킷은 시간축이 아니라 지속 시간 구간이다. */
  tipOf: (idx: number) => { head: string; value: string; sub: string } | null
}

/**
 * **백분위 옆에 세우는 비율 하나.**
 *
 * 마감이 8.33ms 든 16.67ms 든, 세션 중에 바뀌었든 상관없다 — 그 비교는 기기가 **프레임마다
 * 자기 마감으로** 이미 끝냈고 `janky_frames` 가 그 결과의 합이다. 우리가 기준선을 고르는
 * 것이 아니라 기기가 내린 판정을 세는 것이라 규칙 2 를 깨지 않는다.
 *
 * 분자든 분모든 못 읽었으면 `null` 이다 — 0% 를 지어내지 않는다 (규칙 3).
 */
function buildShare(
  spec: DistributionBlock['share'],
  res: unknown,
): { k: string; v: string } | null {
  if (spec === undefined) return null
  const count = readPath(res, spec.countPath)
  const total = readPath(res, spec.totalPath)
  if (typeof count !== 'number' || typeof total !== 'number' || total === 0) return null
  return { k: spec.label, v: nf((count / total) * 100, 1) }
}

export function buildDistribution(
  b: DistributionBlock,
  res: unknown,
  width: number,
): DistributionVm | NoneVm {
  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return none(raw, b.path)

  const buckets = raw as Bucket[]
  const total = buckets.reduce((n, x) => n + x.count, 0)

  // 빈 구간 접기. 지금은 `Infinity` 라 안 접히지만, 버킷이 다시 늘면 이 자리가 살아난다.
  type Slot = { type: 'bar'; b: Bucket; idx: number } | { type: 'break'; len: number }
  const slots: Slot[] = []
  let collapsed = 0
  for (let i = 0; i < buckets.length; ) {
    if (buckets[i]!.count === 0) {
      let j = i
      while (j < buckets.length && buckets[j]!.count === 0) j++
      if (j - i >= b.breakAfterEmptyBuckets) {
        slots.push({ type: 'break', len: j - i })
        collapsed += j - i
        i = j
        continue
      }
      for (let k = i; k < j; k++) slots.push({ type: 'bar', b: buckets[k]!, idx: k })
      i = j
      continue
    }
    slots.push({ type: 'bar', b: buckets[i]!, idx: i })
    i++
  }

  const W = Math.max(360, width)
  const plot = W - DPAD.l - DPAD.r
  const slotW = plot / Math.max(1, slots.length)
  const gap = slotW > 9 ? 2 : slotW > 5 ? 1 : slotW > 3 ? 0.6 : 0.3
  const bw = Math.max(1, slotW - gap)
  const labelEvery = Math.max(1, Math.ceil(slots.length / Math.max(4, Math.floor(plot / 62))))
  const maxCount = Math.max(...buckets.map((r) => r.count), 1)
  const cy = (v: number): number => DH - DPAD.b - (v / maxCount) * (DH - DPAD.t - DPAD.b)

  const bars: DistributionVm['bars'] = []
  const hits: DistributionVm['hits'] = []
  const breaks: DistributionVm['breaks'] = []
  const xLabels: DistributionVm['xLabels'] = []
  const slotCenter = new Map<number, number>()

  let x = DPAD.l
  slots.forEach((s, si) => {
    if (s.type === 'break') {
      breaks.push({ x: x + slotW / 2, label: `${s.len}칸 생략` })
      x += slotW
      return
    }
    const h = s.b.count === 0 ? 0 : Math.max(1, (s.b.count / maxCount) * (DH - DPAD.t - DPAD.b))
    bars.push({ idx: s.idx, x, y: DH - DPAD.b - h, w: bw, h, rx: Math.min(2, bw / 3) })
    hits.push({ idx: s.idx, x: x - gap / 2, w: slotW })
    slotCenter.set(s.idx, x + bw / 2)
    // **눈금은 칸의 끝이다.** 시작값을 쓰면 첫 칸 아래에 `0ms` 가 서고, 그 칸에 프레임이
    // 몰려 있으므로 "0ms 에 끝난 프레임이 480장" 으로 읽힌다. 데이터 쪽이 이미 같은 규칙을
    // 쓰고 있다 (`toHwuiHistogram`: 프레임워크의 `6ms=155` → `[5, 6)`) — 축만 어긋나 있었다.
    if (si % labelEvery === 0) {
      xLabels.push({ x: x + bw / 2, label: s.b.to_ms === null ? `${s.b.from_ms}ms+` : `${s.b.to_ms}ms` })
    }
    x += slotW
  })

  const yStep = niceMax(maxCount / 4)
  const yVals: number[] = []
  for (let v = 0; v <= maxCount + 0.001; v += yStep) yVals.push(v)
  // 꼭대기(실제 최댓값)를 눈금으로 얹되, 바로 아래 눈금과 **너무 가까우면 그것을 밀어낸다.**
  // 안 그러면 450 과 480 처럼 글자가 겹친다 (실측). 축의 최댓값이 더 쓸모 있으므로
  // 규칙적인 쪽을 버린다.
  const last = yVals[yVals.length - 1]!
  if (last < maxCount) {
    if (maxCount - last < yStep * 0.55) yVals.pop()
    yVals.push(maxCount)
  }

  const pc = readPath(res, b.percentilesPath)
  const percentiles: DistributionVm['percentiles'] = []
  const pLines: DistributionVm['pLines'] = []
  if (pc !== MISSING && pc !== null && typeof pc === 'object') {
    for (const k of ['p50', 'p90', 'p95', 'p99']) {
      const v = (pc as Record<string, unknown>)[k]
      percentiles.push({ k, v: typeof v === 'number' ? nf(v, 2) : NONE_NULL })
      if (typeof v !== 'number') continue
      const bi = buckets.findIndex((r) => v >= r.from_ms && (r.to_ms === null || v < r.to_ms))
      if (bi < 0 || !slotCenter.has(bi)) continue
      pLines.push({ x: slotCenter.get(bi)!, label: `${k} ${nf(v, 1)}` })
    }
  }

  return {
    width: W,
    bars,
    hits,
    breaks,
    xLabels,
    yTicks: yVals.map((v) => ({ y: cy(v) + 3.5, gy: cy(v), label: nf(Math.round(v), 0) })),
    pLines,
    percentiles,
    share: buildShare(b.share, res),
    // 각주는 **실제로 일어난 일**만 적는다 — 읽는 법을 설명하는 문장은 카드에 두지 않는다.
    // 지금은 접지 않으므로(`breakAfterEmptyBuckets: Infinity`) 늘 빈 문자열이다.
    footnote: collapsed > 0 ? `빈 버킷 ${collapsed}칸 접음` : '',
    tipOf: (idx) => {
      const bk = buckets[idx]
      if (bk === undefined) return null
      return {
        head: bk.to_ms === null ? `${bk.from_ms}ms 이상` : `${bk.from_ms}–${bk.to_ms}ms`,
        value: `${nf(bk.count, 0)} 프레임`,
        sub: `전체의 ${nf(total === 0 ? 0 : (bk.count / total) * 100, 2)}%`,
      }
    },
  }
}

/* ══════════════════ 나머지 넷 ══════════════════ */

export interface BarsVm {
  none?: false
  rows: { label: string; value: string; share: string; pct: number; note: string }[]
}

export function buildBars(b: BarsBlock, res: unknown): BarsVm | NoneVm {
  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return none(raw, b.path)

  const rows = raw as Record<string, unknown>[]
  const vals = rows.map((r) => r[b.valueField]).filter((v): v is number => typeof v === 'number')
  const max = b.scaleMax ?? (vals.length > 0 ? Math.max(...vals) : 1)

  // 분모는 **데이터가 말하는 전체**여야 한다. 막대들의 합으로 계산하면 꼬리표처럼 겹치는
  // 값에서 분모가 부풀어 각 비율이 실제보다 작게 나온다.
  const denomRaw = b.percentOfPath === undefined ? MISSING : readPath(res, b.percentOfPath)
  const denom = typeof denomRaw === 'number' && denomRaw > 0 ? denomRaw : null

  return {
    rows: rows.map((r) => {
      const lv = r[b.labelField]
      const v = r[b.valueField]
      const share =
        denom !== null && typeof v === 'number' ? `${nf((v / denom) * 100, 1)}%` : ''
      const label = `${b.labelPrefix}${Array.isArray(lv) ? `CPU ${lv[0]}–${lv[lv.length - 1]}` : String(lv)}`
      return {
        label,
        value: fmtValue(v === undefined ? MISSING : v, b.fmt),
        share,
        pct: typeof v === 'number' && max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0,
        // 모르는 라벨은 설명 없이 개수만 낸다 — 기기가 새 이름을 내도 화면은 그대로 돈다.
        note: b.labelNotes?.[String(lv)] ?? '',
      }
    }),
  }
}

export interface DeltaVm {
  none?: false
  /** `delta` 는 말할 것이 없으면 `NO_DELTA` 다 — 빈칸이 아니다. */
  rows: { label: string; before: string; after: string; delta: string }[]
}

/**
 * 차이 칸에 적을 것이 없을 때. **빈칸으로 두지 않는다** — 빈칸은 렌더가 깨진 것처럼 보이고,
 * 칸이 비면 그 줄만 다른 표처럼 읽힌다.
 */
export const NO_DELTA = '-'

/**
 * **전/후 차이.** 단위는 before·after 와 **같은 포맷터**가 붙인다 — 퍼센트면 `%`, 온도면
 * `°C`, kB 필드면 MB. 여기서 단위를 따로 정하면 한 줄의 세 숫자 중 하나만 다른 단위로
 * 적히는 날이 온다.
 *
 * `NO_DELTA` 가 되는 경우는 셋이고 **전부 "이 칸에 적을 차이가 없다"** 는 한 가지 뜻이다:
 * 안 변했거나(0), 뺄 수 없는 값이거나(`wifi` · `예`), 한쪽을 못 읽었거나(측정 중인 세션의
 * `state_after` 는 `null` 이다).
 *
 * 셋을 한 글자로 합쳐도 규칙 3 을 깨지 않는다 — **바로 왼쪽 두 칸이 이미 셋을 가른다.**
 * `37.1°C → 37.1°C` 는 재 봤더니 그대로이고 `100% → 값 없음` 은 못 읽은 것이다.
 */
function fmtDelta(before: Read, after: Read, f: Fmt | undefined): string {
  if (typeof before !== 'number' || typeof after !== 'number') return NO_DELTA
  const d = after - before
  if (d === 0) return NO_DELTA
  // 음수 부호는 포맷터가 이미 붙인다. 여기서 더하는 것은 양수의 `+` 뿐이다.
  return `${d > 0 ? '+' : ''}${fmtValue(d, f)}`
}

export function buildDelta(b: DeltaBlock, res: unknown): DeltaVm | NoneVm {
  // 객체형 — before/after 가 서로 다른 경로에 있다.
  if (b.keys !== undefined) {
    const before = readPath(res, b.beforePath!)
    const after = readPath(res, b.afterPath!)
    if (before === MISSING && after === MISSING) return none(MISSING, b.beforePath)
    return {
      rows: b.keys.map((k) => {
        const bv = before === MISSING ? MISSING : readPath(before, k.p)
        // 측정 중인 세션은 state_after 가 null 이다 — 0 이 아니다.
        const av = after === MISSING ? MISSING : after === null ? null : readPath(after, k.p)
        return {
          label: k.l,
          before: fmtValue(bv, k.f),
          after: fmtValue(av, k.f),
          delta: fmtDelta(bv, av, k.f),
        }
      }),
    }
  }

  // 배열형인데 path 가 없으면 매니페스트가 잘못 적힌 것이다. 조용히 빈 카드를 그리는 대신
  // 그 사실을 화면에 남긴다 — 데이터가 없는 것과 선언이 틀린 것은 다른 문제다.
  if (b.path === undefined) return { none: true, label: '매니페스트에 path 가 없습니다' }

  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return none(raw, b.path)
  const labelField = b.labelField ?? 'name'
  return {
    rows: (raw as Record<string, unknown>[]).map((r) => {
      const bv = b.beforeField === undefined ? MISSING : ((r[b.beforeField] ?? null) as Read)
      const av = b.afterField === undefined ? MISSING : ((r[b.afterField] ?? null) as Read)
      return {
        label: String(r[labelField]),
        before: fmtValue(bv, b.fmt),
        after: fmtValue(av, b.fmt),
        delta: fmtDelta(bv, av, b.fmt),
      }
    }),
  }
}

export interface PairsVm {
  none?: false
  /** `share` 는 값과 **따로** 낸다. 한 문자열로 붙이면 개수와 비율이 눈에서 섞인다. */
  rows: { label: string; value: string; share: string; wrap: boolean }[]
}

export function buildPairs(b: PairsBlock, res: unknown): PairsVm | NoneVm {
  const raw = readPath(res, b.path)

  if (b.arrayAs === 'warnings') {
    if (raw === MISSING) return none(MISSING, b.path)
    // 빈 배열은 "재 봤더니 없었다" 이므로 `수집 안 함` 이 아니다.
    if (!Array.isArray(raw) || raw.length === 0) return { none: true, label: '경고 없음' }
    return {
      rows: (raw as { code: string; message: string }[]).map((w) => ({
        label: w.code,
        value: w.message,
        share: '',
        wrap: true,
      })),
    }
  }

  if (b.arrayAs === 'freq') {
    if (raw === MISSING || raw === null || isEmptyArray(raw)) return none(raw, b.path)
    // 같은 클러스터의 코어는 주파수가 같다. 8줄을 3줄로 접는다 — 같은 값 8번은 정보가 아니다.
    const groups = new Map<string, { cpus: number[]; f: Record<string, number> }>()
    for (const f of raw as Record<string, number>[]) {
      const key = `${f['min_khz']}/${f['max_khz']}/${f['avg_khz']}`
      if (!groups.has(key)) groups.set(key, { cpus: [], f })
      groups.get(key)!.cpus.push(f['cpu']!)
    }
    return {
      rows: [...groups.values()].map((g) => ({
        label: `CPU ${g.cpus.join(',')}`,
        value:
          `${nf(g.f['avg_khz']! / 1000000, 2)} / ${nf(g.f['max_khz']! / 1000000, 2)} GHz` +
          ` · 표본 ${nf(g.f['samples']!, 0)}`,
        share: '',
        wrap: false,
      })),
    }
  }

  if (raw === MISSING || raw === null) return none(raw, b.path)
  return {
    rows: (b.keys ?? []).map((k) => {
      const v = readPath(raw, k.p)
      const d = k.pct === undefined ? MISSING : readPath(raw, k.pct)
      // 분모를 모르면 비율을 지어내지 않는다. 0 을 분모로 쓰지도 않는다.
      const share =
        typeof v === 'number' && typeof d === 'number' && d > 0
          ? `${nf((v / d) * 100, 1)}%`
          : ''
      return { label: k.l, value: fmtValue(v, k.f), share, wrap: k.f === 'wrap' }
    }),
  }
}

export interface StatVm {
  none?: false
  value: string
  unit: string
  dim: boolean
  /**
   * **값이 없는 이유.** `값 없음` 만 큼직하게 띄우면 읽는 쪽은 도구가 고장 난 줄 안다 —
   * 실제로는 `am start -W` 가 timeout 을 보고해 `TotalTime` 이 안 찍힌 것이고, 그 사실은
   * `metrics.<지표>.reason_code` 에 이미 있다. `full` 은 문장이라 툴팁으로 간다.
   */
  why: { code: string; full: string | null } | null
  sub: string
}

export function buildStat(b: StatBlock, res: unknown): StatVm {
  const v = readPath(res, b.path)
  const dim = v === MISSING || v === null
  // **값이 있을 때는 붙이지 않는다.** `partial` 지표는 값이 나온 필드와 안 나온 필드를 같이
  // 갖는데, 사유를 멀쩡한 숫자 밑에 달면 그 숫자를 의심하게 만든다.
  const st = dim ? metricState(res, b.metric) : null
  return {
    value: fmtValue(v, b.fmt),
    // 값이 없는데 단위를 붙이면 `수집 안 함 ms` 가 된다.
    unit: dim ? '' : (b.unit ?? ''),
    dim,
    why: st?.reasonCode === undefined || st?.reasonCode === null
      ? null
      : { code: st.reasonCode, full: st.reason },
    sub: (b.sub ?? []).map((s) => `${s.l} ${fmtValue(readPath(res, s.p), s.f)}`).join(' · '),
  }
}

/* ══════════════════ 지표 상태 ══════════════════ */

export interface MetricState {
  status: string | null
  reason: string | null
  reasonCode: string | null
}

export function metricState(res: unknown, metric: Block['metric']): MetricState {
  if (metric === undefined) return { status: null, reason: null, reasonCode: null }
  const m = readPath(res, `metrics.${metric}`)
  if (m === MISSING || m === null || typeof m !== 'object') {
    return { status: null, reason: null, reasonCode: null }
  }
  const o = m as Record<string, unknown>
  return {
    status: typeof o['status'] === 'string' ? o['status'] : null,
    reason: typeof o['reason'] === 'string' ? o['reason'] : null,
    reasonCode: typeof o['reason_code'] === 'string' ? o['reason_code'] : null,
  }
}
