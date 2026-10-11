import type { FrameTimelineDto } from '../../contract/api.js'
import type { Mark } from './axis.js'
import { fillReportCopy } from './diagnose-copy.js'
import type { Fmt } from './format.js'
import {
  BADGED_STATUS,
  clock,
  fmtAxis,
  fmtValue,
  niceMax,
  nf,
  NONE_MISSING,
  NONE_NULL,
  STATUS_LABEL,
} from './format.js'
import type {
  BarsBlock,
  Block,
  DeltaBlock,
  DistributionBlock,
  FrameTimelineBlock,
  GaugeSpec,
  PairsBlock,
  SeriesBlock,
  StatBlock,
  TabId,
  TileSpec,
} from './manifest.js'
import { SECTIONS, TILES } from './manifest.js'
import { READABILITY_COPY as RC } from './readability-copy.js'
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

/**
 * **차트 카드의 `[]` — 재 봤더니 0건** (report-readability B22). 목록 카드의 `크래시 없음` 처럼 `<무엇> 없음` 을
 * 그린다 — `값 없음`(null 글자)으로 그리면 못 잰 것처럼 읽히고 레일 배지가 센다. 배열이 아닌 것 · `null` ·
 * 필드 없음은 그대로 `none` 이 가른다 (규칙 3 — 세 상태).
 */
function emptyOr(raw: Read, path: string | undefined, word: string): NoneVm {
  return Array.isArray(raw) && raw.length === 0 ? { none: true, label: word } : none(raw, path)
}

/* ══════════════════ 시계열 ══════════════════ */

export const SW = 300
export const SH = 118
/**
 * 왼쪽 여백 46 — 12 단위 눈금 `3,000` 이 여백 안에 든다 (36 이면 카드 안쪽 여백으로 흘렀다 · report-readability
 * `## 크기` · rr-type 이 `overflow: visible` 로 먼저 막음).
 */
export const SPAD = { l: 46, r: 8, t: 10, b: 26 }

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

/**
 * **시간축 눈금.** 개수를 먼저 정하고 거기서 간격을 고른다 — 세션이 길어져도 라벨 수가
 * 늘지 않는다. 예전에는 간격이 30초에서 멈춰서 5분짜리 세션이면 눈금이 12개가 됐고,
 * 폭 256px 에 `300s` `330s` 가 겹쳐 뭉개졌다 (실측).
 *
 * 후보는 사람이 시간으로 읽는 값들이다 — 47초 같은 간격은 자동으로 나오지만 축으로는
 * 못 쓴다. 다 넘치면(9시간 넘는 세션) 그때만 계산한 값을 쓴다.
 */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
/** 눈금 사이 칸 수. 라벨은 이보다 하나 많다 (0초부터 세므로). */
const MAX_INTERVALS = 6

/**
 * **마지막은 항상 세션 끝이다.** 축의 오른쪽 끝이 몇 초인지 안 적히면 그래프 전체의
 * 가로 폭이 무슨 뜻인지 알 수 없다.
 *
 * 끝 눈금이 바로 앞 눈금에 붙으면 앞의 것을 버린다 — 규칙적인 간격보다 **끝을 아는 것**이
 * 쓸모 있다. 분포의 y축 꼭대기 눈금과 같은 판단이다.
 */
export function timeTicks(maxT: number): number[] {
  const step = TICK_STEPS.find((s) => maxT / s <= MAX_INTERVALS) ?? Math.ceil(maxT / MAX_INTERVALS)

  const xs: number[] = []
  for (let t = 0; t <= maxT; t += step) xs.push(t)

  const last = xs[xs.length - 1]!
  if (last === maxT) return xs
  // 남은 자리가 축의 14% 미만이면 글자가 겹친다 (`300s` 가 폭 256px 에서 그만큼 먹는다).
  if (xs.length > 1 && (maxT - last) / maxT < 0.14) xs.pop()
  xs.push(maxT)
  return xs
}

export function buildSeries(
  b: SeriesBlock,
  res: unknown,
  maxT: number,
  marks: Mark[],
  hoverT: number | null,
): SeriesVm | NoneVm {
  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return emptyOr(raw, b.path, RC.emptySeries)

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
  const xs = timeTicks(maxT)

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
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return emptyOr(raw, b.path, RC.emptyFrames)

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
    // 각주는 **실제로 일어난 일**만 단어로 적는다 — 읽는 법을 설명하는 문장은 카드에 두지 않는다 (RR-5 ·
    // 결정 3). 프레임 수를 못 읽었으면 그 토막을 뺀다 — 0 이나 버킷 합으로 지어내지 않는다.
    footnote: distFootnote(readPath(res, b.framesPath ?? ''), buckets.length, collapsed),
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

/** 분포 각주 — `{frames} 프레임 · 버킷 {buckets}칸` (+ 접었으면 `빈 버킷 N칸 접음`). */
function distFootnote(frames: Read, buckets: number, collapsed: number): string {
  const head =
    typeof frames === 'number'
      ? fillReportCopy(RC.distFootnote, { frames: nf(frames, 0), buckets: nf(buckets, 0) })
      : // 프레임 수 토막만 뺀다 — 같은 모음의 뒤 토막 그대로.
        fillReportCopy(RC.distFootnote.slice(RC.distFootnote.indexOf('버킷')), { buckets: nf(buckets, 0) })
  return collapsed > 0 ? `${head} · 빈 버킷 ${collapsed}칸 접음` : head
}

/* ══════════════════ 프레임 시간축 ══════════════════ */

export const FH = 178
export const FPAD = { l: 42, r: 12, t: 18, b: 28 }

/**
 * **Android Vitals 의 느린 프레임 임계값.** 우리가 정한 값이 아니다 —
 * Play Console 「과도하게 느린 프레임」의 정의에 나오는 16ms 다.
 *
 * **이 값으로 프레임을 분류하지 않는다** (규칙 2). 가로선 하나를 긋고 출처를 툴팁에 다는
 * 것이 전부다. 앱 시작 게이지(`GaugeSpec.source`)와 같은 선례 안에 있다.
 *
 * 같은 문서가 정의에서는 "기기의 드로잉 기한"(주사율 의존), 설명에서는 "16ms 초과" 라고 써서
 * 고주사율 기기에서 8ms 인지 16ms 고정인지 확정할 수 없다. 그래서 **그 프레임의 실제 마감은
 * 툴팁에 따로 적는다** — 실측 기기의 마감은 8.33ms 였고 같은 세션에서 41.67ms 로 바뀌었다.
 */
export const VITALS_SLOW_FRAME_MS = 16

export const VITALS_SLOW_FRAME_SOURCE =
  'Android Vitals — 느린 프레임 기준 16ms (Play Console 「과도하게 느린 프레임」)'

/**
 * **`0.00ms` 가 아니라 이 말이 나가야 한다.** 표시 시간이 `null` 인 것은 짝을 못 찾았다는
 * 뜻이고(`--stop` 이 앱이 그린 뒤 화면에 나가기 전에 트레이스를 끊은 경우), 0 으로 적으면
 * "0ms 만에 합성됐다" 는 없던 사실이 된다 (규칙 3).
 */
const UNKNOWN = '모름'

/**
 * 세로축 상한의 바닥. 조용한 세션에서 4ms 프레임이 화면 꼭대기까지 차 보이는 것을 막는다 —
 * 축이 데이터에만 맞으면 **모든 세션이 똑같이 꽉 찬 그림**이 되어 눈이 크기를 못 읽는다.
 */
const FLOOR_MS = 24

export interface FrameBarVm {
  /** 트레이스 시작부터 흐른 시각(ms). 가로 위치가 이 값이다. */
  tMs: number
  /** 같은 순간의 초. 화면 전체가 공유하는 `hoverT` 가 초 단위라 여기서 맞춰 둔다. */
  tSec: number
  appMs: number
  /** **`null` 은 0 이 아니다** — 짝을 못 찾은 프레임이다. 위 칸을 아예 그리지 않는다. */
  presentMs: number | null
  /** 그린 칸의 합. 표시 시간을 모르면 앱 시간뿐이다 — 모르는 값을 0 으로 더하지 않는다. */
  totalMs: number
  /** **그 프레임의** 마감. 세션 중에도 바뀐다 — 고정 예산이 아니다. */
  deadlineMs: number | null
  /** 마감에서 나온 주사율. 마감이 없으면 `null` 이다 — 60 으로 추측하지 않는다. */
  hz: number | null
  x: number
  w: number
  /** 아래 칸(앱이 그린 시간). */
  app: { y: number; h: number }
  /** 위 칸(화면에 나가기까지). `presentMs` 가 `null` 이면 `null` 이다. */
  present: { y: number; h: number } | null
}

export interface FrameTimelineVm {
  none?: false
  /** SVG 폭. 카드보다 넓으면 컨테이너 안에서 가로로 스크롤된다. */
  width: number
  bars: FrameBarVm[]
  /**
   * 화면 x(0~1) → 막대 번호. **막대마다 히트 영역을 두지 않는다** — 프레임이 5,000장이면
   * 투명 사각형이 5,000개 붙고 마우스를 움직일 때마다 그만큼이 다시 그려진다. 대신 덮개
   * 하나를 깔고 여기서 가장 가까운 막대를 찾는다. 막대에서 멀면 `null` 이다.
   */
  idxAt: (ratio: number) => number | null
  /** **참고선 하나.** 이 선으로 막대를 분류하지 않는다 (규칙 2). */
  guide: { ms: number; y: number; source: string }
  yTicks: { y: number; gy: number; label: string }[]
  xTicks: { x: number; anchor: 'start' | 'middle' | 'end'; label: string }[]
  markLines: { x: number; hot: boolean; label: string }[]
  /** 표본을 뽑았다는 사실. 전부 실었으면 `null` 이고 그때는 각주가 없다. */
  note: string | null
  /** 막대 · 두 칸 · 가로가 무엇인지 — 단어 각주 (RR-5). 고정 문구라 수를 싣지 않는다. */
  footnote: string
  tipOf: (idx: number) => { head: string; value: string; lines: string[] } | null
}

/**
 * **막대 하나가 프레임 한 장이고, 가로는 경과 시각이다.**
 *
 * 두 칸으로 쌓는 것은 두 시간이 겹치지 않기 때문이다 — 실측 SM-F936N 에서 앱 0.00~6.30ms,
 * 표시 7.11~15.08ms 로 앱이 그린 뒤에 화면에 나간다. 겹치는 값이었다면 쌓는 순간 합이
 * 거짓말이 된다.
 *
 * **가로축은 ms 다.** `marks` 의 `t` 는 초라서 1000 을 곱해 옮긴다 — 안 그러면 모든 마크가
 * 왼쪽 끝에 쌓여 "세션 시작 직후에 다 찍혔다" 로 읽힌다. 두 값이 같은 0초(트레이스 시작)를
 * 쓰는 것은 core 의 SQL 이 `trace_bounds.start_ts` 를 원점으로 맞춰 둔 덕이다.
 */
export function buildFrameTimeline(
  b: FrameTimelineBlock,
  res: unknown,
  maxT: number,
  marks: Mark[],
  hoverT: number | null,
): FrameTimelineVm | NoneVm {
  const raw = readPath(res, b.path)
  if (raw === MISSING || raw === null || typeof raw !== 'object') return none(raw, b.path)

  const d = raw as Partial<FrameTimelineDto>
  // 표본이 `[]` 면 재 봤더니 0장이다 — `프레임 없음` (B22 · 배지에 안 셈). 표본 칸 자체가 배열이 아니면
  // 못 읽은 것이라 `값 없음` 그대로.
  if (!Array.isArray(d.samples)) return none(null, b.path)
  const rows = d.samples
  if (rows.length === 0) return { none: true, label: RC.emptyFrames }

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  interface Row { tMs: number; appMs: number; presentMs: number | null; deadlineMs: number | null }
  const parsed: Row[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const tMs = num(row[0])
    const appMs = num(row[1])
    if (tMs === null || appMs === null) continue
    parsed.push({ tMs, appMs, presentMs: num(row[2]), deadlineMs: num(row[3]) })
  }
  if (parsed.length === 0) return none(null, b.path)

  const totalOf = (r: Row): number => r.appMs + (r.presentMs ?? 0)

  // **세로축** 상한은 데이터 최댓값까지 간다. 상한을 우리가 고르면 그 순간 무엇이 튄 것인지
  // 우리가 정하게 되고(규칙 2), 잘린 막대는 실제 값을 화면에서 지운다.
  //
  // 이 공식이라 어떤 막대도 **세로로는** 축을 넘을 수 없다 — 가로는 다른 이야기이고
  // 바로 아래 `spanMs` 가 그 자리다. **이 줄을 고정 상한(예: `Math.min(60, ...)`)으로
  // 바꾸는 순간 조용한 클리핑이 생긴다.** 상한을 건드리려는 사람은 클리핑 표시나 그것을
  // 막는 테스트를 함께 넣을 것.
  const yMax = Math.max(FLOOR_MS, ...parsed.map(totalOf))

  const W = Math.max(360, parsed.length * 3)
  const plot = W - FPAD.l - FPAD.r

  // **가로축은 `maxT` 를 그대로 쓸 수 없다.** `axis.ts` 의 `maxT` 는 **마지막 온전한 초**에서
  // 멈춘다(`floor(trace_span_ms / 1000) - 1`). 초 단위 집계는 온전히 덮인 초에서만 값이
  // 나오므로 시계열에는 그 규칙이 맞다. **프레임은 초로 접히지 않는다** — `t_ms` 는
  // `trace_span_ms` 끝까지 간다. 20.4초 트레이스면 `maxT = 19` 라 19초 뒤의 마지막 1.4초
  // (120Hz 면 170장 남짓)가 `viewBox` 밖으로 밀려 **말없이 잘린다.** 게다가 `yMax` 는 그
  // 안 보이는 막대까지 세므로, 잘린 꼬리에 스파이크가 있으면 **아무 막대도 닿지 않는
  // 높이로 축이 선다** — 축이 데이터를 설명하지 않게 된다. `frame` 이 한 번 접힌 이유가
  // 정확히 "파일에 있는 것과 화면에 있는 것이 다르다" 였다.
  //
  // 그래서 이 차트만 자기 데이터 끝까지 축을 늘린다. `maxT` 는 **마크를 겹쳐 얹는 데만**
  // 쓴다 — 마크도 프레임도 0초가 같으므로(트레이스 시작) 같은 `px` 하나로 옮겨지면
  // 두 축의 폭이 달라도 이 차트 안에서는 정확히 같은 자리에 선다.
  const dataEndMs = Math.max(...parsed.map((r) => r.tMs))
  const spanMs = Math.max(maxT > 0 ? maxT * 1000 : 1, dataEndMs, 1)
  const px = (ms: number): number => FPAD.l + (ms / spanMs) * plot
  const py = (v: number): number => FH - FPAD.b - (v / yMax) * (FH - FPAD.t - FPAD.b)

  const slot = plot / parsed.length
  const bw = Math.max(2, Math.min(6, slot * 0.7))

  const bars: FrameBarVm[] = parsed.map((r) => {
    const total = totalOf(r)
    const x = px(r.tMs) - bw / 2
    return {
      tMs: r.tMs,
      tSec: Math.round(r.tMs / 1000),
      appMs: r.appMs,
      presentMs: r.presentMs,
      totalMs: total,
      deadlineMs: r.deadlineMs,
      // 마감이 0 이하면 나눗셈이 무한대를 낸다. 모르는 것으로 둔다 — 지어내지 않는다.
      hz: r.deadlineMs === null || r.deadlineMs <= 0 ? null : Math.round(1000 / r.deadlineMs),
      x,
      w: bw,
      app: { y: py(r.appMs), h: py(0) - py(r.appMs) },
      present: r.presentMs === null ? null : { y: py(total), h: py(r.appMs) - py(total) },
    }
  })

  const yStep = niceMax(yMax / 4)
  const yVals: number[] = []
  for (let v = 0; v <= yMax + 0.001; v += yStep) yVals.push(v)
  const last = yVals[yVals.length - 1]!
  if (last < yMax) {
    // 꼭대기(축의 실제 상한)가 더 쓸모 있다 — 붙어 버리는 쪽은 규칙적인 눈금이라도 버린다.
    if (yMax - last < yStep * 0.55) yVals.pop()
    yVals.push(yMax)
  }

  // 눈금도 이 차트의 축(`spanMs`)에서 뽑는다 — `maxT` 로 뽑으면 마지막 눈금이 축의 끝이
  // 아닌 자리에 서서 "그래프의 오른쪽 끝이 몇 초인가" 에 답하지 못한다. **내림**이라
  // 어떤 눈금도 축 밖으로 나가지 않는다.
  const xs = timeTicks(Math.max(1, Math.floor(spanMs / 1000)))
  const seen = typeof d.frames_seen === 'number' ? `${nf(d.frames_seen, 0)}장 중 ` : ''
  const bucket = typeof d.bucket_ms === 'number' ? `${nf(d.bucket_ms, 0)}ms ` : ''

  return {
    width: W,
    bars,
    idxAt: (ratio) => {
      const x = ratio * W
      const cx = (i: number): number => bars[i]!.x + bw / 2
      let lo = 0
      let hi = bars.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cx(mid) < x) lo = mid + 1
        else hi = mid
      }
      const i = lo > 0 && Math.abs(cx(lo - 1) - x) < Math.abs(cx(lo) - x) ? lo - 1 : lo
      // 막대에서 멀면 아무것도 안 짚는다 — 빈 자리에서 엉뚱한 프레임의 툴팁이 뜨면
      // 그 시각에 프레임이 있었다는 없던 사실이 된다.
      return Math.abs(cx(i) - x) > Math.max(6, slot) ? null : i
    },
    guide: { ms: VITALS_SLOW_FRAME_MS, y: py(VITALS_SLOW_FRAME_MS), source: VITALS_SLOW_FRAME_SOURCE },
    yTicks: yVals.map((v) => ({ y: py(v) + 3.5, gy: py(v), label: fmtAxis(v) })),
    xTicks: xs.map((t, i) => ({
      x: px(t * 1000),
      anchor: i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle',
      label: `${t}s`,
    })),
    // **초를 ms 로 옮긴다.** 이 축만 ms 이고 나머지 차트는 전부 초다.
    markLines: marks.map((mk) => ({ x: px(mk.t * 1000), hot: hoverT === mk.t, label: mk.label })),
    // **조용히 자르지 않는다.** 표본을 뽑았으면 몇 장 중 몇 장인지 화면에 남는다.
    //
    // **세는 대상을 이름에 붙인다.** 같은 「렌더」 섹션의 한 탭 옆에서 `hwui` 가
    // 「프레임 수」로 `total_frames` 를 내는데, 두 수는 **다른 모집단**이다 — 이쪽은
    // 화면에 나간 프레임이고 그쪽은 앱이 그린 프레임이다. 그냥 `12,400장` 이라고 적으면
    // 한 세션에 프레임 수가 두 개 있는 것으로 읽히고, 그 구분은 README 와 스키마에만 있어
    // 화면을 보는 사람에게 닿지 않는다. 읽는 법을 해설하는 것이 아니라 **명사를 정확히
    // 부르는 것**이라 「카드에 읽는 법을 설명하지 않는다」와 부딪히지 않는다.
    note:
      d.sampling !== 'max_per_bucket'
        ? null
        : `화면에 나간 프레임 ${seen}${nf(bars.length, 0)}장 표본 ` +
          `(${bucket}구간마다 가장 오래 걸린 한 장)`,
    footnote: RC.timelineFootnote,
    tipOf: (idx) => {
      const bar = bars[idx]
      if (bar === undefined) return null
      return {
        head: `경과 ${nf(bar.tMs / 1000, 3)}초`,
        value: `${nf(bar.totalMs, 2)}ms`,
        lines: [
          `앱 ${nf(bar.appMs, 2)}ms · 표시 ` +
            (bar.presentMs === null ? UNKNOWN : `${nf(bar.presentMs, 2)}ms`),
          bar.deadlineMs === null
            ? `마감 ${UNKNOWN}`
            : `마감 ${nf(bar.deadlineMs, 2)}ms` + (bar.hz === null ? '' : ` · ${nf(bar.hz, 0)}Hz`),
        ],
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
  if (raw === MISSING || raw === null || isEmptyArray(raw)) return emptyOr(raw, b.path, RC.emptyBars)

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

export interface PairsRowVm {
  /** 라벨 — 경로 라벨이면 경로 원문 그대로(⌘F 가 닿는다). */
  label: string
  /** 경로 라벨의 단어 줄 (RR-6). 있으면 라벨이 두 줄 — 단어 위 · 경로 아래. 기기 원문 라벨에는 없다. */
  word?: string
  value: string
  /** `share` 는 값과 **따로** 낸다. 한 문자열로 붙이면 개수와 비율이 눈에서 섞인다. */
  share: string
  /** 기계 이름 값 — 구분자 뒤에서 줄바꿈한다 (`<wbr>` · RR-7). 숫자 칸은 아니다 (`1,234` 가 쉼표에서 끊기지 않게). */
  wrap: boolean
  /** 기계값(경로) — 등폭으로 쓴다. */
  mono?: true
  /** 값이 `null` 인 이유 코드 (`why` 를 선언한 키만). 값이 있으면 없다. */
  code?: string
  /** 그 이유의 문장 — 행 툴팁. */
  title?: string
}

export interface PairsVm {
  none?: false
  rows: PairsRowVm[]
}

export function buildPairs(b: PairsBlock, res: unknown): PairsVm | NoneVm {
  const raw = readBlockRoot(res, b.path)

  if (b.arrayAs === 'list') {
    // 세 상태를 가른다: 필드가 없다 / 못 읽었다(null) / 재 봤더니 없었다([]).
    if (raw === MISSING || raw === null) return none(raw, b.path)
    if (!Array.isArray(raw) || raw.length === 0) {
      return { none: true, label: b.emptyLabel ?? '없음' }
    }
    const f = b.listFields ?? { label: 'code', value: 'message' }
    return {
      rows: (raw as Record<string, unknown>[]).map((row) => ({
        label: String(row[f.label] ?? ''),
        value: String(row[f.value] ?? ''),
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
      const row: PairsRowVm = {
        label: k.l,
        value: fmtValue(v, k.f),
        share,
        wrap: WRAP_FMTS.includes(k.f),
      }
      if (k.w !== undefined) row.word = k.w
      // 등폭은 기계값에만 — `값 없음` 은 문장이라 본문 글꼴 그대로다.
      if (k.f === 'path' && v !== null && v !== MISSING) row.mono = true
      // **값이 없을 때만** 이유를 단다 — stat 카드와 같은 관례다. 값이 있는데 사유를 달면 멀쩡한
      // 값까지 의심하게 된다.
      if (v === null && k.why !== undefined) {
        const code = readPath(raw, k.why.code)
        const reason = readPath(raw, k.why.reason)
        if (typeof code === 'string') row.code = code
        if (typeof reason === 'string') row.title = reason
      }
      return row
    }),
  }
}

/** 기계 이름을 내는 포맷 — 값이 구분자 뒤에서 줄바꿈한다 (RR-7). 숫자 포맷은 넣지 않는다. */
const WRAP_FMTS: Fmt[] = ['wrap', 'path', 'list', 'dots']

/**
 * **블록 `path` 를 읽는다.** 빈 문자열은 문서 루트다 — 서로 다른 갈래의 값을 한 카드에 모으는
 * 카드(진단 탭의 `원본`)가 라벨을 루트 경로 그대로 쓰게 하려는 것이다.
 */
function readBlockRoot(res: unknown, path: string): Read {
  return path === '' ? (res ?? MISSING) : readPath(res, path)
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
  /** 기준선 막대. 값이 없으면 `null` 이고 그때는 아무것도 그리지 않는다. */
  gauge: GaugeVm | null
}

export interface GaugeVm {
  /** 0~1. `max` 를 넘으면 1 이다 — 막대는 축 밖으로 나갈 수 없다. */
  fill: number
  /** 구간 번호. 색만 정하고 이름도 점수도 붙이지 않는다. */
  level: number
  /** 마지막 경계를 넘었나. */
  over: boolean
  /**
   * 잰 값으로 그린 막대인가. `false` 면 `worstWhen` 이 걸린 것이고, 그때 막대는 **잰 적 없는
   * 사실**을 그린 것이라 렌더러가 빗금으로 구분한다. 색과 길이는 그대로 최대다.
   */
  measured: boolean
  axisLabel: string
  source: string
}

/**
 * 구간은 **넘긴 경계의 개수**다. 경계와 같은 값은 위 구간에 넣는다(1,000ms 는 1구간) —
 * 구글의 문장이 "5초를 넘으면 느린 시작" 이라 마지막 경계도 같은 방향으로 읽는다.
 *
 * **값이 없으면 원칙적으로 막대도 없다.** 빈 막대를 그리면 읽는 쪽이 `0ms` 로 읽고,
 * 그것이 규칙 3 이 화면에서 깨지는 자리다.
 *
 * 예외는 `worstWhen` 하나다. `am start -W` 가 timeout 을 낸 세션은 **"못 쟀다" 와 "오래
 * 걸렸다" 가 같은 사건**이라 — ActivityManager 가 기다리다 포기한 것이다 — 빈 자리로 두면
 * 세션에서 가장 나쁜 소식이 화면에서 가장 조용해진다. 그때만 마지막 구간을 꽉 채우고,
 * 잰 값이 아니라는 것은 `measured: false` 와 축 라벨(`타임아웃 · …`)이 말한다.
 */
export function buildGauge(
  spec: GaugeSpec,
  raw: unknown,
  reasonCode: string | null = null,
): GaugeVm | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    const w = spec.worstWhen
    if (w === undefined || reasonCode === null || !w.codes.includes(reasonCode)) return null
    return {
      fill: 1,
      level: spec.bands.length,
      over: true,
      measured: false,
      axisLabel: `${w.label} · ${spec.axisLabel}`,
      source: spec.source,
    }
  }
  const over = raw >= spec.max
  return {
    fill: Math.max(0, Math.min(1, raw / spec.max)),
    level: spec.bands.filter((b) => raw >= b).length,
    over,
    measured: true,
    axisLabel: over ? `넘김 · ${spec.axisLabel}` : spec.axisLabel,
    source: spec.source,
  }
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
    sub: (b.subline ?? []).map((s) => `${s.l} ${fmtValue(readPath(res, s.p), s.f)}`).join(' · '),
    gauge: b.gauge === undefined ? null : buildGauge(b.gauge, v, st?.reasonCode ?? null),
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
  return shellState(res, `metrics.${metric}`)
}

/** `status` · `reason` · `reason_code` 껍데기 하나를 읽는다. 메트릭과 진단 블록이 같은 모양이다. */
function shellState(res: unknown, path: string): MetricState {
  const m = readPath(res, path)
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

/**
 * 블록 하나의 상태 — 지표면 `metrics.<id>`, 아니면 `statePath` 의 껍데기. 둘 다 없으면 상태가 없다
 * (기기 정보 · 오버헤드 카드).
 */
export function blockState(res: unknown, b: Block): MetricState {
  if (b.metric !== undefined) return metricState(res, b.metric)
  if (b.statePath !== undefined) return shellState(res, b.statePath)
  return { status: null, reason: null, reasonCode: null }
}

/**
 * 카드 제목 줄의 상태 배지. `unsupported` · `skipped` · `failed` 에만 — **`partial` 은 달지 않는다**
 * (`format.ts` 의 `BADGED_STATUS`). 이유 문장은 배지가 없어도 제목 툴팁으로 닿는다.
 */
export function badgeOf(state: MetricState): string | null {
  if (state.status === null || !BADGED_STATUS.includes(state.status)) return null
  return STATUS_LABEL[state.status] ?? state.status
}

/**
 * 카드 단위. 값이 단위를 정하는 카드(stat · slice 표)는 뷰모델의 것을, 나머지는 매니페스트의 것을
 * 쓴다. **진단 세션이면 `diagnoseUnit` 이 이긴다** — 평소 세션에는 그 단위가 붙지 않는다.
 */
export function cardUnit(b: Block, vm: unknown, diagnose: boolean): string {
  const isNone = (vm as NoneVm | null)?.none === true
  if (!isNone && (b.kind === 'stat' || b.kind === 'slicetable')) return (vm as { unit: string }).unit
  if (diagnose && b.diagnoseUnit !== undefined) return b.diagnoseUnit
  return b.unit ?? ''
}

/* ══════════════════ 블록 하나 · 레일 배지 ══════════════════ */

/**
 * 매니페스트의 `kind` 하나가 빌더 하나로 간다. 지표 이름은 어디에도 안 나온다.
 * `slicetable` 은 문서가 바뀔 때만 만들어 화면이 따로 넘긴다 (`ReportPage` 의 `sliceVms`).
 */
export function buildBlock(
  b: Exclude<Block, { kind: 'slicetable' }>,
  res: unknown,
  maxT: number,
  marks: Mark[],
  hoverT: number | null,
  distW: number,
): unknown {
  switch (b.kind) {
    case 'series': return buildSeries(b, res, maxT, marks, hoverT)
    case 'distribution': return buildDistribution(b, res, distW)
    case 'frametimeline': return buildFrameTimeline(b, res, maxT, marks, hoverT)
    case 'bars': return buildBars(b, res)
    case 'delta': return buildDelta(b, res)
    case 'pairs': return buildPairs(b, res)
    case 'stat': return buildStat(b, res)
    default: {
      // **exhaustiveness 체크.** `Block` 에 새 `kind` 가 늘거나 여기서 하나가 빠지면
      // `b` 가 `never` 로 좁혀지지 않아 컴파일이 깨진다 — case 를 빠뜨려도 테스트를
      // 전부 통과하며 카드가 조용히 사라지는 사고(2번 지적 사항)를 빌드 시점에 잡는다.
      const _exhaustive: never = b
      return _exhaustive
    }
  }
}

/**
 * **카드가 값 자리에 그린 빈 칸 글자.** 값이 없는 카드의 `NoneBody` 글자(`label`)이거나, 값이 없는
 * stat 카드의 큰 글자(`value`)다. 값을 그린 카드는 `null`.
 *
 * 레일 배지는 이 글자로 센다 — 렌더러가 그리는 바로 그 필드를 읽으니 셈과 그림이 다른 규칙을 쓸 수 없다.
 */
function placeholderOf(b: Block, vm: unknown): string | null {
  const v = vm as { none?: unknown; label?: unknown; dim?: unknown; value?: unknown } | null
  if (v === null || typeof v !== 'object') return null
  if (v.none === true) return typeof v.label === 'string' ? v.label : null
  if (b.kind === 'stat' && v.dim === true) return typeof v.value === 'string' ? v.value : null
  return null
}

/**
 * **레일 배지가 세는 블록인가** (RR-8) — `수집 안 함` · `값 없음` 을 그린 블록.
 *
 * 재 봤더니 없음(`[]`)으로 `없음` 을 그린 블록(`크래시 없음` · `ANR 없음` · `경고 없음` · 차트의 `표본 없음` ·
 * `프레임 없음` · `항목 없음`)은 세지 않는다 — 그것은 잰 0 이다(규칙 3 · B22). 그 밖의 글자(`바꾸지 않음` 같은
 * 사실 문장)도 같은 이유로 세지 않는다.
 * 요약 타일은 블록이 아니라 이 셈에 들어오지 않는다 — 같은 값의 카드가 이미 센다 (RR 결정 12).
 */
export function isUncollected(b: Block, vm: unknown): boolean {
  const p = placeholderOf(b, vm)
  return p !== null && (p === NONE_NULL || p.startsWith(NONE_MISSING))
}

/** 탭 하나의 레일 배지 수 — 그 탭 섹션의 블록 가운데 `isUncollected` 인 것. `0` 이면 배지를 안 그린다. */
export function tabBadgeCount(items: readonly { block: Block; vm: unknown }[], tab: TabId): number {
  return items.filter(
    (x) => SECTIONS.find((s) => s.id === x.block.section)?.tab === tab && isUncollected(x.block, x.vm),
  ).length
}

/* ══════════════════ 요약 타일 ══════════════════ */

/**
 * 타일 하나 (RR-4). **값이 바뀌어도 모양이 같다** — 색 · 굵기 · 아이콘을 정하는 칸이 없고, 클래스는 값이
 * 있느냐 없느냐로만 갈린다(디자인 결정 2). 순위 · 등급 · 기준 비교 0.
 */
export interface TileVm {
  metric: TileSpec['metric']
  /** 단어 줄 (`앱 시작` …). */
  word: string
  /** 경로 줄 — 필드 경로 원문 (⌘F 가 닿는다). */
  path: string
  /** 카드와 같은 배지 — unsupported · skipped · failed 만 (partial 은 배지 없이 `title`). */
  badge: string | null
  /** 지표 `reason` 문장 — 툴팁. */
  title: string | null
  /**
   * 값 — **아래 카드의 같은 값과 같은 문자열** (`1,234 ms` · `12.3 MB` · `NONE (0)`). 값이 없으면 `null` 이고
   * 그때는 `none` 이 선다.
   */
  value: string | null
  /** 그 문자열을 큰 숫자 · 작은 단위로 나눈 것 — 렌더만 쓴다. 이어 붙이면 `value` (+ 덧단위). */
  big: string
  small: string
  /** 값 자리에 서는 말 — `값 없음` · `수집 안 함` · 배지 상태면 `reason_code`. 값이 있으면 `null`. */
  none: string | null
  /** `값 없음` 아래 코드 줄. */
  code: string | null
}

/**
 * 포맷된 값 끝의 영문 단위를 떼어 낸다 — `1,234 ms` → [`1,234`, `ms`]. 숫자 뒤 단위가 아니면 그대로
 * (`NONE (0)` · `collected`). 글자는 하나도 바꾸지 않는다: 큰 글자 · 작은 글자로 나눌 뿐이다.
 */
export function splitUnit(s: string): [string, string] {
  const m = /^(.*\d) ([A-Za-z]+)$/.exec(s)
  return m === null ? [s, ''] : [m[1]!, m[2]!]
}

/**
 * 타일 경로 읽기. `readPath` 는 중간이 `null` 이면 그 아래를 `MISSING` 으로 읽는데, 타일은 **아래 카드와 같은
 * 상태**를 말해야 한다 — `cpu.data.app` 이 `null` 이면 `앱 CPU 시간` 카드가 `값 없음` 을 그리므로 타일도
 * `값 없음` 이다 (`수집 안 함` 이면 필드가 없는 옛 세션처럼 읽힌다). 위가 `null` 이면 `null`, 위가 없으면 `MISSING`.
 */
function readTilePath(res: unknown, path: string): Read {
  const v = readPath(res, path)
  if (v !== MISSING) return v
  const segs = path.split('.')
  for (let i = 1; i < segs.length; i++) if (readPath(res, segs.slice(0, i).join('.')) === null) return null
  return MISSING
}

export function buildTile(t: TileSpec, res: unknown): TileVm {
  const st = metricState(res, t.metric)
  const badge = badgeOf(st)
  const base = { metric: t.metric, word: t.word, path: t.path, badge, title: st.reason }
  const empty = { value: null, big: '', small: '' }
  // 카드와 같은 관례 (디자인 결정 3) — 배지가 서면 값 자리에 그 이유 코드.
  if (badge !== null) return { ...base, ...empty, none: st.reasonCode ?? NONE_NULL, code: null }
  const v = readTilePath(res, t.path)
  if (v === MISSING) return { ...base, ...empty, none: NONE_MISSING, code: null }
  if (v === null) return { ...base, ...empty, none: NONE_NULL, code: st.reasonCode }
  const value = fmtValue(v, t.fmt)
  const [big, unit] = splitUnit(value)
  return { ...base, value, big, small: t.unit ?? unit, none: null, code: null }
}

/** 요약 탭 첫 섹션의 타일 8 — `TILES` 순서 그대로 (값으로 고르거나 다시 세우지 않는다). */
export function buildTiles(res: unknown): TileVm[] {
  return TILES.map((t) => buildTile(t, res))
}
