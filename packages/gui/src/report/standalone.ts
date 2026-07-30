import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { INLINE_REPORT_GLOBAL } from '../contract/api.js'

/**
 * **보고서를 파일 하나로 만다.** 서버도 인터넷도 없이 열리는 HTML 을 낸다.
 *
 * GUI 의 보고서는 서버에 두 가지로 묶여 있다: 화면이 `/api/runs/:id/report` 로 데이터를
 * 받아 오고, `index.html` 의 자산 경로가 절대경로(`/assets/…`)다. 둘 다 `file://` 에서
 * 깨진다. 여기서 자산을 문서 안으로 들여오고 데이터를 심어 그 둘을 없앤다.
 *
 * **한 파일인 것이 요점이다.** 측정한 사람과 읽는 사람이 다른 경우가 보통이고, 그때
 * "서버를 띄우고 이 포트를 열어라" 는 전달 방법이 못 된다. 첨부해서 보내면 끝나야 한다.
 *
 * 부풀리기는 감수한다 — 글꼴 6개를 base64 로 넣으면 128KB 가 붙는다. 대신 **외부로 나가는
 * 요청이 여전히 0** 이고, 그것이 이 저장소가 글꼴을 자체 호스팅한 이유와 같은 이유다.
 */

export interface StandaloneReportInput {
  /** 빌드된 화면이 있는 자리 (`dist-web`). */
  webRoot: string
  /** `result.json` 을 파싱한 그대로. 화면이 검증 없이 읽는다. */
  report: unknown
  /** 브라우저 탭 제목. */
  title: string
}

/**
 * `<script>` 안에 JSON 을 넣을 때 문서를 깨는 것은 `<` 하나뿐이다 — `</script` 도 `<!--` 도
 * 거기서 시작한다. 전부 `<` 로 바꾸면 JSON 으로서는 같은 문자열이고 파서는 태그의
 * 시작을 보지 못한다.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * 번들 안의 `</script` 를 `<\/script` 로 바꾼다.
 *
 * 미니파이된 JS 에서 그 글자가 나올 수 있는 자리는 문자열·템플릿·정규식뿐이고 셋 다
 * `\/` 가 `/` 와 같은 뜻이라 **의미가 바뀌지 않는다.** 지금 번들에는 하나도 없지만
 * (테스트가 그것을 확인한다) 화면에 문자열 하나 추가하면 생길 수 있는 종류의 사고다.
 */
function embedScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script')
}

const MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * CSS 안의 `url(/assets/…)` 를 data: URI 로 바꾼다. `file://` 에서 절대경로는 디스크
 * 루트를 가리켜 아무것도 못 찾는다 — 글꼴이 조용히 시스템 글꼴로 떨어진다.
 *
 * 아는 확장자만 바꾼다. 모르는 것을 추측해 잘못된 MIME 을 붙이면 브라우저가 거절하는데,
 * 그 실패는 콘솔에만 남아 **보는 사람은 왜 다르게 보이는지 모른다.**
 */
async function inlineCssAssets(css: string, webRoot: string): Promise<string> {
  const refs = [...css.matchAll(/url\(\/assets\/([^)"']+)\)/g)]
  let out = css

  for (const [whole, file] of refs) {
    const ext = file!.slice(file!.lastIndexOf('.'))
    const mime = MIME[ext]
    if (mime === undefined) continue
    const bytes = await readFile(join(webRoot, 'assets', file!))
    const url = `url(data:${mime};base64,${bytes.toString('base64')})`
    out = out.replace(whole, () => url)
  }
  return out
}

/**
 * `index.html` 의 `<script src>` · `<link rel=stylesheet>` 를 내용으로 갈아 끼우고
 * 데이터를 심는다.
 *
 * **`type="module"` 을 떼고 넣는다.** 크롬은 `file://` 에서 모듈 스크립트를 막는데, 지금
 * 번들에는 `import`/`export`/`import.meta` 가 하나도 없어서(테스트가 확인한다) 고전
 * 스크립트로 그대로 돈다. 번들이 모듈 문법을 쓰기 시작하면 그 테스트가 먼저 깨진다.
 */
export async function buildStandaloneReport(input: StandaloneReportInput): Promise<string> {
  const html = await readFile(join(input.webRoot, 'index.html'), 'utf8')

  const jsRef = /<script\b[^>]*\bsrc="\/assets\/([^"]+)"[^>]*><\/script>/.exec(html)
  const cssRef = /<link\b[^>]*\bhref="\/assets\/([^"]+\.css)"[^>]*>/.exec(html)
  if (jsRef === null || cssRef === null) {
    // 자산을 못 찾았는데 조용히 넘어가면 **빈 화면짜리 파일**이 나온다. 그것을 열어 본
    // 사람은 측정이 잘못된 줄 안다.
    throw new Error(
      `보고서 자산을 찾지 못했습니다 — ${join(input.webRoot, 'index.html')} 의 구조가 예상과 다릅니다.`,
    )
  }

  const js = await readFile(join(input.webRoot, 'assets', jsRef[1]!), 'utf8')
  const css = await inlineCssAssets(
    await readFile(join(input.webRoot, 'assets', cssRef[1]!), 'utf8'),
    input.webRoot,
  )
  if (css.includes('</style')) {
    throw new Error('스타일시트에 `</style` 이 들어 있어 문서 안에 넣을 수 없습니다.')
  }

  if (!html.includes('</body>')) {
    throw new Error(`${join(input.webRoot, 'index.html')} 에 </body> 가 없습니다.`)
  }

  // **치환은 전부 함수로 넘긴다.** 문자열로 넘기면 `String.replace` 가 그 안의 `$&` `$'`
  // 를 패턴으로 읽는다 — 미니파이된 번들과 JSON 에는 그 두 글자가 실제로 들어 있고,
  // 실측에서 번들 한복판에 `<script src=…>` 태그가 박히고 문서 꼬리가 24번 복제됐다.
  // 조용히 깨진다는 것이 이 사고의 특징이다: 파일은 만들어지고 크기도 그럴듯하다.
  const scripts =
    `    <script>globalThis.${INLINE_REPORT_GLOBAL}=${embedJson(input.report)}</script>\n` +
    `    <script>${embedScript(js)}</script>\n`

  return html
    .replace(cssRef[0], () => `<style>${css}</style>`)
    // **원래 자리(head)에 두면 안 된다.** 원본은 `type="module"` 이라 기본이 defer 였는데
    // 우리는 그것을 떼고 넣는다(크롬이 file:// 에서 모듈을 막는다). 고전 스크립트는
    // 즉시 실행이라 `<body>` 가 아직 없고, 실측에서 `#root 를 찾지 못했습니다` 로 죽었다.
    // `defer` 는 인라인 스크립트에 붙지 않으므로 **자리를 옮기는 것이 유일한 방법**이다.
    .replace(jsRef[0], () => '')
    .replace('</body>', () => `${scripts}  </body>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(input.title)}</title>`)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}
