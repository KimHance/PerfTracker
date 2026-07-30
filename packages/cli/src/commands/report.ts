import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findRun } from '@perftracker/core'
import { buildStandaloneReport, webRoot } from '@perftracker/gui'
import { openInBrowser } from './open.js'

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
  opts: { out: string; file?: string; open: boolean },
): Promise<string> {
  if (!existsSync(webRoot())) {
    // `gui` 와 같은 문장이다 — 원인도 해법도 같다.
    throw new Error(
      '화면이 아직 빌드되지 않았습니다.\n' +
        `  기대한 경로  ${webRoot()}\n` +
        'npm run build 를 먼저 실행하세요.',
    )
  }

  const run = await findRun(opts.out, id)
  if (run === null) {
    throw new Error(`기록을 찾지 못했습니다: ${id}\n  perftracker runs list -o ${opts.out}`)
  }

  const resultPath = join(run.runDir, 'result.json')
  if (!existsSync(resultPath)) {
    // 정지는 됐는데 산출이 실패한 run 이다. 빈 보고서를 내면 읽는 쪽은 측정이 잘못된 줄 안다.
    throw new Error(
      `이 기록에는 result.json 이 없습니다: ${resultPath}\n` +
        `  perftracker extract ${run.runDir} 로 다시 산출할 수 있습니다.`,
    )
  }

  const html = await buildStandaloneReport({
    webRoot: webRoot(),
    report: JSON.parse(await readFile(resultPath, 'utf8')),
    title: `${run.name} · PerfTracker`,
  })

  const target = opts.file ?? join(run.runDir, 'report.html')
  await writeFile(target, html, 'utf8')
  if (opts.open) openInBrowser(pathToFileURL(target).href)

  // 다른 명령과 같다 — 한 줄만 낸다. 어느 지표를 앞에 둘지 자체가 이미 판단이다.
  return `→ ${target}`
}
