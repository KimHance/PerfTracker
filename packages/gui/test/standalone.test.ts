import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildStandaloneReport } from '../src/report/standalone.js'

/**
 * **한 파일짜리 보고서.** 서버도 인터넷도 없이 열려야 한다 — 측정한 사람과 읽는 사람이
 * 다른 경우가 보통이고, 그때 "포트를 열어라" 는 전달 방법이 못 된다.
 */

const HTML =
  '<!doctype html>\n<html lang="ko">\n  <head>\n' +
  '    <title>PerfTracker</title>\n' +
  '    <script type="module" crossorigin src="/assets/app.js"></script>\n' +
  '    <link rel="stylesheet" crossorigin href="/assets/app.css">\n' +
  '  </head>\n  <body><div id="root"></div></body>\n</html>\n'

async function fixture(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pt-standalone-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), HTML)
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(root, 'assets', name), body)
  }
  return root
}

describe('한 파일짜리 보고서', () => {
  it('스크립트·스타일·글꼴을 문서 안으로 들여온다 — 남는 참조가 없다', async () => {
    const webRoot = await fixture({
      'app.js': 'console.log(1)',
      'app.css': '@font-face{src:url(/assets/f.woff2)}',
      'f.woff2': Buffer.from([1, 2, 3]),
    })
    const html = await buildStandaloneReport({ webRoot, report: { a: 1 }, title: 't' })

    // 하나라도 남으면 `file://` 에서 그 자산은 디스크 루트를 가리켜 조용히 실패한다.
    expect(html).not.toContain('/assets/')
    expect(html).toContain('<style>')
    expect(html).toContain('console.log(1)')
    expect(html).toContain('url(data:font/woff2;base64,AQID)')
  })

  it('데이터를 심는다 — 화면이 서버를 부를 일이 없다', async () => {
    const webRoot = await fixture({ 'app.js': '', 'app.css': '' })
    const report = { schema_version: '1.1.0', metrics: {} }
    const html = await buildStandaloneReport({ webRoot, report, title: 't' })

    const m = /globalThis\.__PERFTRACKER_REPORT__=([\s\S]*?)<\/script>/.exec(html)
    expect(JSON.parse(m![1]!)).toEqual(report)
  })

  /**
   * **이 저장소에서 실제로 터진 사고다.** 치환을 문자열로 넘겼더니 `String.replace` 가
   * 번들 안의 `$&` 를 패턴으로 읽어, 번들 한복판에 `<script src=…>` 태그가 박히고 문서
   * 꼬리가 24번 복제됐다. 조용히 깨지는 것이 특징이다 — 파일은 만들어지고 크기도 그럴듯하다.
   */
  it('번들의 `$&` `$\'` 를 치환 패턴으로 읽지 않는다', async () => {
    const js = "x.replace(/a/,`$&$'$\\`$$`)"
    const css = "a::after{content:\"$&$'\"}"
    const webRoot = await fixture({ 'app.js': js, 'app.css': css })
    const html = await buildStandaloneReport({ webRoot, report: {}, title: 't' })

    expect(html).toContain(js)
    expect(html).toContain(css)
  })

  it('데이터의 `$&` 도 마찬가지다', async () => {
    const webRoot = await fixture({ 'app.js': '', 'app.css': '' })
    const report = { name: "$&$'$` 그리고 </script>" }
    const html = await buildStandaloneReport({ webRoot, report, title: 't' })

    const m = /globalThis\.__PERFTRACKER_REPORT__=([\s\S]*?)<\/script>/.exec(html)
    expect(JSON.parse(m![1]!)).toEqual(report)
  })

  /** JSON 안의 `</script` 가 문서를 끊으면 그 뒤 전부가 본문으로 새어 나온다. */
  it('데이터 안의 `<` 를 이스케이프한다', async () => {
    const webRoot = await fixture({ 'app.js': '', 'app.css': '' })
    const html = await buildStandaloneReport({
      webRoot,
      report: { s: '</script><h1>주입</h1>' },
      title: 't',
    })
    expect(html).not.toContain('<h1>주입</h1>')
  })

  it('번들의 `</script` 를 끊기지 않게 넣는다', async () => {
    const webRoot = await fixture({ 'app.js': 'var s="</script>"', 'app.css': '' })
    const html = await buildStandaloneReport({ webRoot, report: {}, title: 't' })
    expect(html).toContain('var s="<\\/script>"')
  })

  /**
   * **실측에서 여기서 죽었다** — `Uncaught Error: #root 를 찾지 못했습니다`.
   * 원본은 `type="module"` 이라 기본이 defer 였는데 우리는 그것을 뗀다(크롬이 `file://`
   * 에서 모듈을 막는다). 고전 스크립트는 즉시 실행이라 `<head>` 에 두면 `<body>` 가 아직
   * 없다. **`defer` 는 인라인 스크립트에 붙지 않아** 자리를 옮기는 것이 유일한 방법이다.
   */
  it('스크립트를 #root 뒤에 둔다 — head 에 두면 즉시 실행돼 죽는다', async () => {
    const webRoot = await fixture({ 'app.js': 'BUNDLE', 'app.css': '' })
    const html = await buildStandaloneReport({ webRoot, report: {}, title: 't' })

    expect(html.indexOf('BUNDLE')).toBeGreaterThan(html.indexOf('id="root"'))
    expect(html.indexOf('__PERFTRACKER_REPORT__')).toBeGreaterThan(html.indexOf('id="root"'))
    // 데이터가 번들보다 먼저여야 한다 — 나중이면 번들이 이미 읽고 지나간 뒤다.
    expect(html.indexOf('__PERFTRACKER_REPORT__')).toBeLessThan(html.indexOf('BUNDLE'))
    // 원래 자리에는 아무것도 남지 않는다.
    expect(html).not.toContain('<script type="module"')
  })

  it('제목을 바꾼다', async () => {
    const webRoot = await fixture({ 'app.js': '', 'app.css': '' })
    const html = await buildStandaloneReport({ webRoot, report: {}, title: 'Stream · PerfTracker' })
    expect(html).toContain('<title>Stream · PerfTracker</title>')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  /**
   * 자산을 못 찾았는데 조용히 넘어가면 **빈 화면짜리 파일**이 나온다. 그것을 열어 본
   * 사람은 측정이 잘못된 줄 안다.
   */
  it('자산을 못 찾으면 빈 화면을 내지 않고 던진다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pt-standalone-'))
    await writeFile(join(root, 'index.html'), '<html><body></body></html>')
    await expect(buildStandaloneReport({ webRoot: root, report: {}, title: 't' })).rejects.toThrow(
      /자산을 찾지 못했습니다/,
    )
  })
})

/**
 * **빌드 산출물에 대한 단언이다.** 여기 깔린 가정이 깨지면 한 파일 보고서가 조용히 안 뜬다.
 * `npm run build` 를 한 뒤에만 의미가 있어 산출물이 없으면 건너뛴다.
 */
describe('빌드된 번들이 한 파일로 말 수 있는 모양인가', () => {
  const distWeb = fileURLToPath(new URL('../dist-web', import.meta.url))

  it('모듈 문법이 없다 — 크롬은 file:// 에서 모듈 스크립트를 막는다', async () => {
    let names: string[]
    try {
      names = await readdir(join(distWeb, 'assets'))
    } catch {
      return // 아직 안 빌드했다.
    }
    const js = await readFile(join(distWeb, 'assets', names.find((n) => n.endsWith('.js'))!), 'utf8')

    // 하나라도 있으면 `<script type="module">` 로 넣어야 하고, 그러면 file:// 에서 안 뜬다.
    expect(js).not.toMatch(/(^|[;}\s])export[{ ]/)
    expect(js).not.toMatch(/(^|[;}\s])import[{("'`]/)
    expect(js).not.toContain('import.meta')
  })
})
