// 시안 사진 · 글자 측정 — 상태 × 폭 (1440 · 390). 레포 의존성을 들이지 않는다 (RR 결정 13):
// playwright-core 와 Chrome 경로를 환경 변수로 받는다.
//
//   PW=<playwright-core 디렉토리> CHROME=<chrome 실행 파일> \
//   node labs/report-readability-design/v1/shoot.mjs <base URL> <사진 폴더> [before]
//
// base URL 이 `…/Report Readability.dc.html` 이면 `?state=<상태>` 로, `before` 면 `<base>/<파일>.html` + 탭 클릭으로 연다.
// 결과: <사진 폴더>/report-<상태>-<폭>.png (fullPage) · <사진 폴더>/measure.json (상태-폭마다 measure.js 결과)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(join(process.env.PW, 'index.mjs'))
const [base, outDir, mode] = process.argv.slice(2)
const MEASURE = readFileSync(join(here, 'measure.js'), 'utf8').replace(/^\/\/.*$/gm, '')

// 상태 · 실렌더 표본 파일 · 탭 (gen_samples.py STATES 와 같은 순서)
const STATES = [
  ['summary', 'summary', '요약'], ['missing', 'missing', '요약'], ['compile', 'compile', '요약'],
  ['end-null', 'end-null', '요약'], ['legacy', 'legacy', '요약'], ['device', 'summary', '기기'],
  ['diag', 'diag', '진단'], ['diag-noapp', 'diag-noapp', '진단'],
]

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const out = {}
for (const w of [1440, 390]) {
  await page.setViewportSize({ width: w, height: 900 })
  for (const [state, file, tab] of STATES) {
    const url = mode === 'before' ? `${base}/${file}.html` : `${base}?state=${state}&shot`
    await page.goto(url)
    await page.waitForTimeout(700)
    if (mode === 'before' && tab !== '요약') {
      await page.locator('.rp-tab', { hasText: tab }).first().click()
      await page.waitForTimeout(300)
    }
    out[`${state}-${w}`] = await page.evaluate(`(${MEASURE})()`)
    await page.screenshot({ path: join(outDir, `report-${state}-${w}.png`), fullPage: true })
  }
}
writeFileSync(join(outDir, 'measure.json'), JSON.stringify(out, null, 1) + '\n')
await browser.close()
for (const [k, v] of Object.entries(out)) {
  console.log(`${k.padEnd(16)} 글자 ${String(v.chars).padStart(6)} · <12px ${String(v.under12_pct).padStart(5)}% · <4.5 ${String(v.under45_pct).padStart(5)}% · 최소 ${v.min_px}px ${v.min_ratio} · 층 ${JSON.stringify(v.layers)} · 넘침 ${v.overflow_x}`)
}
