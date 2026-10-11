import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **보고서 글자 바닥** (report-readability RR-1 · RR-2 · RR-3 · RR-5 · 결정 8 · 11).
 *
 * 보고서 CSS 를 글자 그대로 읽어 본다 — 이 레포에는 브라우저 시험이 없다(결정 13). 렌더한 글자의
 * 크기 · 대비는 레포 밖 수동 글자 측정(`labs/report-readability-design/v1/measure.js`)이 맡고,
 * 여기는 그 숫자가 나오게 하는 **선언**이 바닥 위에 있는지를 본다.
 *
 * 토큰 값은 고치지 않는다(결정 11) — 측정 화면이 같은 토큰 · 공유 스타일시트를 싣는다. 그래서
 * 보고서 규칙이 `.rp-` 밖으로 새지 않는지, 공유 규칙이 보고서 글자를 바닥 아래로 내리지 않는지도 본다.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const REPORT_CSS = read('../src/web/report/report.css')
const APP_CSS = read('../src/web/styles/app.css')
const TOKENS_CSS = read('../src/web/styles/tokens.css')

interface Rule {
  selectors: string[]
  decls: Map<string, string>
}

/** 주석을 지우고 가장 안쪽 `선택자 { 선언 }` 만 뽑는다 — `@media` 안 규칙도 같은 줄로 나온다. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.trim().split(',').map((s) => s.trim()).filter(Boolean)
    const decls = new Map<string, string>()
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim())
    }
    out.push({ selectors, decls })
  }
  return out
}

const REPORT = rules(REPORT_CSS)
const sel = (r: Rule): string => r.selectors.join(', ')

/** 한 선택자의 선언 — 같은 선택자 규칙이 여럿이면 마지막 것이 이긴다. */
function decl(selector: string, prop: string): string | undefined {
  let v: string | undefined
  for (const r of REPORT) if (r.selectors.includes(selector) && r.decls.has(prop)) v = r.decls.get(prop)
  return v
}

/** `13px` → 13 · `clamp(26px, 2.2vw, 32px)` → 26 (최솟값). 그 밖의 꼴은 NaN — 시험이 잡는다. */
function minPx(v: string): number {
  const clamp = /^clamp\(\s*([\d.]+)px\s*,/.exec(v)
  if (clamp) return Number(clamp[1])
  const px = /^([\d.]+)px$/.exec(v)
  return px ? Number(px[1]) : Number.NaN
}

function sizeOf(selector: string): number {
  const v = decl(selector, 'font-size')
  if (v === undefined) throw new Error(`${selector} 에 font-size 가 없다`)
  return minPx(v)
}

// ── 토큰 · 대비 (WCAG 2.x) ────────────────────────────────────
const TOKENS = new Map<string, string>()
for (const m of TOKENS_CSS.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) TOKENS.set(m[1]!, m[2]!)

function hex(token: string): string {
  const v = TOKENS.get(token)
  if (!v) throw new Error(`tokens.css 에 ${token} 의 hex 값이 없다`)
  return v
}

function luminance(h: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/**
 * 바탕을 따로 칠하지 않은 글자가 놓이는 바탕 — 페이지 · 카드 · 그 위 겹침(배지 · 막대 트랙 · 표식 칩) 가운데
 * 가장 밝은 것으로 잰다 (RR-2 「가장 밝은 바탕」).
 */
const PLAIN_GROUNDS = ['--color-bg', '--color-surface', '--color-neutral-200']

const tokenOf = (v: string | undefined): string | undefined => /^var\((--[\w-]+)\)$/.exec(v ?? '')?.[1]

/** 글자 색 선언 — `color` 전부와 SVG 글자(눈금)의 `fill`. 막대 · 선 · 점의 `fill` · `stroke` 는 그림이다. */
interface TextColor {
  rule: Rule
  value: string
}
const TEXT_COLORS: TextColor[] = REPORT.flatMap((rule) => {
  const out: TextColor[] = []
  const color = rule.decls.get('color')
  if (color !== undefined) out.push({ rule, value: color })
  const fill = rule.decls.get('fill')
  if (fill !== undefined && rule.selectors.some((s) => s.includes('rp-tick'))) out.push({ rule, value: fill })
  return out
})

/** 본문 층의 그릇 — 표 · slice 표 · 전/후 표 · 값 없음 · 막대 줄 · 앱 시작 아래 줄 · 머리 메타 값 · 라벨 단어 줄 · 타일 단어 줄. */
const BODY = [
  '.rp-table', '.rp-slice', '.rp-delta', '.rp-none', '.rp-bar-row', '.rp-stat-title', '.rp-stat-sub', '.rp-meta',
  '.rp-lbl', '.rp-tile-word',
]
const inBody = (selector: string): boolean =>
  BODY.some((c) => new RegExp(`${c.replace('.', '\\.')}(?![\\w-])`).test(selector))

/**
 * 선택자 특정도 (id, class, type). `:where()` 는 0, `:not()` · `:is()` 는 안의 것을 센다 — 이 파일이 쓰는 꼴만.
 */
function specificity(selector: string): [number, number, number] {
  let s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  s = s.replace(/:(?:not|is)\(((?:[^()]|\([^()]*\))*)\)/g, ' $1')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  const types = (s.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+|#[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length
  return [ids, classes, types]
}
const beats = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

describe('보고서 글자 바닥 — report.css', () => {
  it('RR-1 보고서 스타일시트 font-size 바닥', () => {
    const sizes = REPORT.filter((r) => r.decls.has('font-size'))
    expect(sizes.length).toBeGreaterThan(40)
    const low = sizes
      .map((r) => ({ at: sel(r), v: r.decls.get('font-size')!, px: minPx(r.decls.get('font-size')!) }))
      .filter((s) => !(s.px >= 12))
    expect(low).toEqual([])

    // `font` 줄임은 크기를 몰래 바꿀 수 있다 — 물려받기만 쓴다.
    const shorthand = REPORT.filter((r) => r.decls.has('font') && r.decls.get('font') !== 'inherit').map(sel)
    expect(shorthand).toEqual([])

    // 표 · 카드 본문 · 값 · 라벨 단어 줄은 13px 이상 (결정 8 · 디자인 문서 `## 크기` 본문 층).
    // 그릇만 보면 셀(`.rp-table td`) · 자손 규칙이 12px 로 내려도 초록이다 — 본문 그릇 클래스가 선택자
    // 어디에든 들어간 규칙의 font-size 를 전부 본다 (`.rp-meta-item` 같은 다른 클래스는 안 걸림).
    const body = REPORT.filter((r) => r.decls.has('font-size') && r.selectors.some(inBody))
    expect(body.length).toBeGreaterThanOrEqual(8)
    const lowBody = body
      .map((r) => ({ at: sel(r), px: minPx(r.decls.get('font-size')!) }))
      .filter((s) => !(s.px >= 13))
    expect(lowBody).toEqual([])

    // 시계열 눈금은 viewBox 300 단위 — 카드 폭만큼 커져 RR-1 측정 폭에서 렌더 1440 ≈ 14.8 · 390 ≈ 13.1.
    // ≈ 362px 미만 창(360 ≈ 11.9)은 측정 폭 밖이다. 렌더 크기는 수동 글자 측정으로 본다 (결정 13).
    expect(sizeOf('.rp-series .rp-tick')).toBeGreaterThanOrEqual(12)
  })

  it('RR-1 보고서 규칙은 .rp- 안 — 측정 화면 글자에 닿지 않는다', () => {
    // report.css 는 측정 화면과 한 번들로 실린다(main.tsx). 선택자가 전부 `.rp-` 를 거쳐야 이 파일을
    // 고쳐도 측정 화면 규칙의 font-size 가 그대로다.
    const leaked = REPORT.flatMap((r) => r.selectors).filter((s) => !s.includes('.rp-'))
    expect(leaked).toEqual([])
  })

  it('RR-1 공유 스타일시트가 보고서 글자를 바닥 아래로 내리지 않는다', () => {
    // 보고서 DOM 이 공유 스타일시트에서 받는 것: 전역 규칙(요소 · `*` · 의사 요소)과 `.mono` · `.num`.
    const SHARED_CLASSES = ['.mono', '.num']
    const reach = rules(APP_CSS).filter((r) =>
      r.selectors.some((s) => !s.includes('.') || SHARED_CLASSES.includes(s)),
    )
    expect(reach.length).toBeGreaterThan(0)
    const low = reach
      .filter((r) => r.decls.has('font-size') || r.decls.has('font'))
      .map((r) => ({ at: sel(r), px: minPx(r.decls.get('font-size') ?? r.decls.get('font')!) }))
      .filter((s) => !(s.px >= 13))
    expect(low).toEqual([])
  })

  it('RR-2 보고서 글자 색 토큰 대비', () => {
    expect(TEXT_COLORS.length).toBeGreaterThan(40)
    const fails: string[] = []
    for (const { rule, value } of TEXT_COLORS) {
      if (value === 'inherit' || value === 'currentColor') continue
      const fg = tokenOf(value)
      if (!fg) {
        fails.push(`${sel(rule)} — 토큰이 아닌 글자 색 ${value}`)
        continue
      }
      // 자기 바탕을 칠한 규칙(배지 · 고른 탭 · 상태 pill)은 그 바탕과, 아니면 가장 밝은 바탕과 잰다.
      const own = tokenOf(rule.decls.get('background'))
      const grounds = own ? [own] : PLAIN_GROUNDS
      for (const bg of grounds) {
        const c = contrast(hex(fg), hex(bg))
        if (c < 4.5) fails.push(`${sel(rule)} — ${fg} on ${bg} ${c.toFixed(2)}`)
      }
    }
    expect(fails).toEqual([])
  })

  it('RR-2 neutral-500 이하는 글자에 없다 — 그림에만', () => {
    // 토큰 값 그대로 · 보고서가 글자에 쓰는 토큰만 고른다 (결정 11). 500 은 bg 4.27 · surface 3.82.
    const dim = TEXT_COLORS.filter(({ value }) => /--color-neutral-[1-5]00\b/.test(value)).map(({ rule }) => sel(rule))
    expect(dim).toEqual([])
  })

  it('RR-1 키/값 표 라벨 열 규칙은 표 자기 클래스 규칙에 진다 (특정도)', () => {
    // 라벨 열 45% · 위 정렬은 키/값 표 기본값이다. 진단 dex 표(시안 `.rp-dex thead th { width:auto;
    // vertical-align:bottom }`)처럼 표가 자기 클래스로 정하면 그쪽이 이겨야 한다 — 뒤 단위가 시안 규칙을
    // 그대로 옮겨도 머리 칸이 45% 로 늘어나지 않게.
    const owners = REPORT.filter((r) => r.decls.get('width') === '45%').flatMap((r) => r.selectors)
    expect(owners.length).toBeGreaterThan(0)
    for (const o of owners) {
      expect(o.endsWith('th'), o).toBe(true)
      expect(beats(specificity(o), specificity('.rp-dex thead th')), o).toBe(false)
      expect(beats(specificity(o), specificity('.rp-dex th')), o).toBe(false)
    }
    // 계산기 자체 — 고쳐지기 전 꼴은 이겼다.
    expect(specificity('.rp-table:not(.rp-delta):not(.rp-slice) th')).toEqual([0, 3, 1])
    expect(specificity('.rp-dex thead th')).toEqual([0, 1, 2])
  })

  it('RR-3 위계 크기 순서', () => {
    const section = sizeOf('.rp-section-head')
    const title = sizeOf('.rp-card-title')
    const body = sizeOf('.rp-table')
    expect(section).toBeGreaterThan(title)
    expect(title).toBeGreaterThan(body)
    expect(section - title).toBeGreaterThanOrEqual(2)
    expect(title - body).toBeGreaterThanOrEqual(2)
    // 섹션 제목이 본문보다 작은 곳 0 — 본문 층 어느 것도 섹션 제목보다 크지 않다.
    for (const s of ['.rp-none', '.rp-bar-row', '.rp-stat-sub', '.rp-meta', '.rp-slice .rp-slice-name']) {
      expect(sizeOf(s), s).toBeLessThan(section)
    }
  })

  it('RR-3 요약 타일 값 > 섹션 제목', () => {
    // 들어가는 자리(RR-4)의 숫자가 화면에서 가장 크다 — clamp 최솟값이 섹션 제목보다 크다 (26 > 18).
    expect(sizeOf('.rp-tile-value')).toBeGreaterThan(sizeOf('.rp-section-head'))
    // 값이 없는 타일(`값 없음` · 코드)은 섹션 제목보다 크지 않다 — 큰 `값 없음` 은 고장으로 읽힌다 (디자인 결정 2).
    expect(sizeOf('.rp-tile-none')).toBeLessThanOrEqual(sizeOf('.rp-section-head'))
    // 타일 단어 줄 · 라벨 단어 줄은 본문 층, 경로 줄은 보조 층 (12).
    expect(sizeOf('.rp-tile-word')).toBe(sizeOf('.rp-table'))
    expect(sizeOf('.rp-lbl')).toBe(sizeOf('.rp-table'))
    expect(sizeOf('.rp-lbl-path')).toBe(12)
    expect(sizeOf('.rp-tile-path')).toBe(12)
  })

  it('RR-7 줄바꿈은 break-word — anywhere · break-all 없음', () => {
    // 줄바꿈 자리는 구분자 뒤 `<wbr>` 이고, 토막이 칸보다 넓을 때만 그 안에서 끊는다 (결정 5). `anywhere` 는
    // 토막 가운데서 먼저 끊어 `HomeA / ctivity` 를 만들었고, `break-all` 은 모든 글자 사이를 끊는다.
    const wraps = REPORT.filter((r) => r.decls.has('overflow-wrap') || r.decls.has('word-break'))
    expect(wraps.length).toBeGreaterThanOrEqual(6)
    const bad = wraps
      .filter((r) => r.decls.get('overflow-wrap') === 'anywhere' || r.decls.get('word-break') === 'break-all')
      .map(sel)
    expect(bad).toEqual([])
    for (const s of ['.rp-table th', '.rp-table td', '.rp-wrap', '.rp-lbl-path', '.rp-slice .rp-slice-name', '.rp-tile-path']) {
      expect(decl(s, 'overflow-wrap'), s).toBe('break-word')
    }
    // ellipsis · 자름 0.
    expect(REPORT.filter((r) => r.decls.get('text-overflow') === 'ellipsis').map(sel)).toEqual([])
  })

  it('RR-2 HANDOFF 글자 바닥 표 = report.css', () => {
    // HANDOFF §5 「글자 바닥」 표가 크기 · 글자 색을 숫자로 말한다 — 코드와 어긋나면 문서가 조용히 낡는다.
    const handoff = read('../../../docs/design/report/HANDOFF.md')
    const at = handoff.indexOf('### 글자 바닥')
    expect(at).toBeGreaterThan(0)
    const rows = [...handoff.slice(at).matchAll(/^\| [^|]+ \| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/gm)]
    expect(rows.length).toBeGreaterThanOrEqual(15)
    const off: string[] = []
    for (const [, selector, size, color] of rows) {
      const s = size!.trim()
      const c = color!.trim()
      if (s !== '—' && decl(selector!, 'font-size') !== s) off.push(`${selector} 크기 ${s} ≠ ${decl(selector!, 'font-size')}`)
      if (c !== '—' && decl(selector!, 'color') !== `var(${c.replace(/`/g, '')})`) {
        off.push(`${selector} 색 ${c} ≠ ${decl(selector!, 'color')}`)
      }
    }
    expect(off).toEqual([])
  })

  it('RR-5 글자 색은 중립 토큰', () => {
    // 계열색(`--color-alt-*`)은 그림(막대)에만. 글자는 `--color-text` · `--color-neutral-*`
    // (고른 탭 · 호버 값 · 세션 id 의 accent 글자는 계열색이 아니다 — 지금 그대로).
    const alt = TEXT_COLORS.filter(({ value }) => value.includes('--color-alt-')).map(({ rule }) => sel(rule))
    expect(alt).toEqual([])
    // 렌더 카드 막대의 계열색은 그대로다 (예외 아님 — 그림).
    expect(decl('.rp-card-alt .rp-bar-track i', 'background')).toBe('var(--color-alt-500)')
  })
})
