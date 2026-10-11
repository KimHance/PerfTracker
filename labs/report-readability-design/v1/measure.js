// 「글자 측정」 (docs/spec/report-readability.md 머리 문단) — playwright `page.evaluate(MEASURE)` 로 부른다.
// main 안 텍스트 노드마다 렌더 글자 크기 · 글자 색 · 겹친 바탕으로 WCAG 2.x 대비를 내고 글자 수로 가중한다.
// SVG 글자는 font-size × (렌더 폭 / viewBox 폭) — getComputedStyle 은 SVG 축소를 반영하지 않는다 (RR 결정 13).
// 돌려주는 것: 글자 수 · 12px 미만 % · 4.5:1 미만 % · 최소 크기 · 최소 대비 · 걸린 자리 앞 12 · 층 크기 (RR-3).
() => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const bgOf = (el) => {
    const stack = []
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor)
      if (c && c.a > 0) stack.push(c)
      if (c && c.a >= 1) break
    }
    let base = { r: 29, g: 31, b: 32, a: 1 } // --color-bg
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o }
  const root = document.querySelector('main') || document.body
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0, small = 0, low = 0, minSize = 99, minRatio = 99
  const hits = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, '')
    if (!text) continue
    const el = n.parentElement
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) continue
    let size = parseFloat(cs.fontSize)
    const svg = el.closest('svg')
    let fg = parse(svg ? cs.fill : cs.color)
    if (svg) {
      const vb = svg.viewBox && svg.viewBox.baseVal
      if (vb && vb.width > 0) size = size * (svg.getBoundingClientRect().width / vb.width)
    }
    if (!fg) continue
    const bg = bgOf(el)
    fg = over({ ...fg, a: fg.a * opacityOf(el) }, bg)
    const r = ratio(fg, bg)
    const w = text.length
    total += w
    if (size < 11.95) small += w
    if (r < 4.5) low += w
    minSize = Math.min(minSize, size)
    minRatio = Math.min(minRatio, r)
    if (size < 11.95 || r < 4.5) hits.push(`${size.toFixed(1)}px ${r.toFixed(2)} ${el.className || el.tagName} «${text.slice(0, 24)}»`)
  }
  const sizeOf = (sel) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : null }
  return {
    chars: total,
    under12_pct: +(100 * small / Math.max(1, total)).toFixed(1),
    under45_pct: +(100 * low / Math.max(1, total)).toFixed(1),
    min_px: +minSize.toFixed(1),
    min_ratio: +minRatio.toFixed(2),
    layers: {
      tile_value: sizeOf('.rp-tile-value') ?? sizeOf('.rp-stat-value'),
      section: sizeOf('.rp-section-head'),
      card_title: sizeOf('.rp-card-title'),
      body: sizeOf('.rp-table td') ?? sizeOf('.rp-table'),
    },
    overflow_x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hits: [...new Set(hits)].slice(0, 12),
  }
}
