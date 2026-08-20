import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findRun, PerfTrackerError, SessionStateError } from '@perftracker/core'
import { buildStandaloneReport, webRoot } from '@perftracker/gui'
import { openInBrowser } from './browser.js'

/**
 * 기록 하나를 **파일 하나짜리 HTML** 로 낸다.
 *
 * **기기에 접촉하지 않는다** — `createContext` 를 부르지 않는 것이 그 증거다. 이미 호스트에
 * 있는 `result.json` 을 화면과 함께 말아 넣을 뿐이다.
 *
 * `gui` 와 같은 화면을 쓰지만 서버가 필요 없다. 측정한 사람과 읽는 사람이 다른 경우가
 * 보통이고, 그때 "서버를 띄우고 이 포트를 열어라" 는 전달 방법이 못 된다 — 첨부해서
 * 보내면 끝나야 한다. 자세한 것은 `packages/gui/src/report/standalone.ts`.
 */
export async function runReport(
  id: string,
  opts: { out: string; file?: string; browser: boolean },
): Promise<string> {
  const run = await findRun(opts.out, id)
  if (run === null) {
    // **id 오타는 예상된 일이다.** 평범한 `Error` 로 던지면 진입점이 그것을 "예상치 못한
    // 오류" 로 분류해 스택트레이스와 함께 "이슈로 알려주세요" 를 찍는다 — 같은 실수를
    // `runs rename` 은 한 문장으로 답하는데. `stop` 이 이 명령을 안내하게 된 뒤로는
    // 오타로 여기 닿는 일이 더 흔해졌다.
    throw new SessionStateError(
      `기록을 찾지 못했습니다: ${id}\n  perftracker runs list -o ${opts.out}`,
    )
  }

  // 다른 명령과 같다 — 한 줄만 낸다. 어느 지표를 앞에 둘지 자체가 이미 판단이다.
  return `→ ${await writeStandaloneReport(run.runDir, `${run.name} · PerfTracker`, opts)}`
}

/**
 * run 디렉토리 하나를 HTML 파일 하나로 쓰고 그 경로를 낸다.
 *
 * **`report` 와 `stop --report` 가 나눠 쓴다.** 두 곳에 적으면 한쪽만 고쳐진 채로 남는데,
 * 그 어긋남은 "같은 기록인데 어느 명령으로 냈느냐에 따라 다른 보고서" 로 나타난다.
 */
export async function writeStandaloneReport(
  runDir: string,
  title: string,
  opts: { file?: string; browser: boolean },
): Promise<string> {
  if (!existsSync(webRoot())) {
    // `gui` 와 같은 문장이다 — 원인도 해법도 같다.
    throw new PerfTrackerError(
      'WEB_NOT_BUILT',
      '화면이 아직 빌드되지 않았습니다.\n' +
        `  기대한 경로  ${webRoot()}\n` +
        'npm run build 를 먼저 실행하세요.',
    )
  }

  const resultPath = join(runDir, 'result.json')
  if (!existsSync(resultPath)) {
    // 정지는 됐는데 산출이 실패한 run 이다. 빈 보고서를 내면 읽는 쪽은 측정이 잘못된 줄 안다.
    throw new SessionStateError(
      `이 기록에는 result.json 이 없습니다: ${resultPath}\n` +
        `  perftracker extract ${runDir} 로 다시 산출할 수 있습니다.`,
    )
  }

  const html = await buildStandaloneReport({
    webRoot: webRoot(),
    report: JSON.parse(await readFile(resultPath, 'utf8')),
    title,
  })

  const target = opts.file ?? join(runDir, 'report.html')
  await writeFile(target, html, 'utf8')
  if (opts.browser) openInBrowser(pathToFileURL(target).href)
  return target
}
