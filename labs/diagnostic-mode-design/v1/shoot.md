# 시안 사진 찍는 법 (v1)

Claude Design 프로젝트 `성능 측정 CLI GUI 도구` (9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) 의 `diagnostic-mode/` 를
`claude-design/` 로 export 하고 Claude Design 런타임 주입 두 줄(`<style|script data-omelette-injected>`)을 지운 뒤, 로컬 정적 서버 + playwright 로 상태 × 폭마다 찍는다. 기기 접촉 없음.

```bash
# 1. 정적 서버 (레포 루트에서)
python3 -m http.server 8766 --bind 127.0.0.1 --directory labs/diagnostic-mode-design/v1/claude-design
```

```js
// 2. playwright (browser_run_code) — 사진 24장 + 390 가로 넘침 값
async (page) => {
  const base = 'http://127.0.0.1:8766/diagnostic-mode'
  const out = 'labs/diagnostic-mode-design/v1/shots'
  const measure = ['toggle-off', 'toggle-on', 'doctor-sdk30', 'running', 'running-unknown', 'drawer']
  const report = ['summary', 'diag', 'sorted', 'open-null', 'no-process', 'failed']
  for (const [w, h] of [[1440, 900], [924, 700]]) {
    await page.setViewportSize({ width: w, height: h })
    for (const s of measure) {
      await page.goto(`${base}/Measure.html?state=${s}&shot`)
      await page.waitForTimeout(400)
      // 924 는 창이 낮아 04 가 아래에 걸린다 (드로어가 열리면 한 단) — 토글 · 드로어 상태는 04 로 스크롤
      if (w === 924 && (s === 'toggle-off' || s === 'toggle-on' || s === 'drawer'))
        await page.evaluate(() => document.getElementById('sec-04')?.scrollIntoView({ block: 'center' }))
      // 환경 점검 새 줄은 목록 끝 — 다이얼로그 목록을 끝까지 내린다
      if (s === 'doctor-sdk30')
        await page.evaluate(() => document.querySelectorAll('.dialog div').forEach((d) => { if (d.scrollHeight > d.clientHeight + 4) d.scrollTop = d.scrollHeight }))
      await page.screenshot({ path: `${out}/measure-${s}-${w}.png` })
    }
  }
  const overflow = []
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 })
    for (const s of report) {
      await page.goto(`${base}/Report.html?state=${s}&shot`)
      await page.waitForTimeout(400)
      if (w === 390) overflow.push(`${s} ${await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)}`)
      await page.screenshot({ path: `${out}/report-${s}-${w}.png`, fullPage: true })
    }
  }
  return overflow.join('\n')   // → shots/overflow-390.txt
}
```

```js
// 2-1. (고침 1) reason 문장 자리 · 원본 라벨 · 정렬 뒤 스크롤 → shots/reason-titles.txt
//   상태 diag · open-null · no-process · failed 마다: .rp-card-title[title] 개수 · .rp-badge[title] 개수 ·
//   tr[title] 의 (라벨=문장) · .diag-pairs th 라벨 목록. 그리고 diag 에서 .diag-scroll.scrollTop = 300 →
//   메인 스레드 합 ms 머리 클릭 → scrollTop 이 0 인지.
```

```bash
# 3. 검사
python3 labs/diagnostic-mode-design/v1/check_shots.py
```

fullPage 사진(보고서)은 세로 스크롤 막대 10px 만큼 좁게 찍힌다 (1430 · 380) — 검사는 폭 −10px 까지 받는다.
