import { existsSync } from 'node:fs'
import { startGuiServer, webRoot } from '@perftracker/gui'
import { openInBrowser } from './open.js'

/**
 * 로컬 GUI 를 띄운다. 서버가 정적 프론트엔드와 JSON API 를 함께 서빙한다 —
 * 브라우저에서 adb 를 부를 수 없으므로 서버 계층이 필수다.
 *
 * **이 명령은 끝나지 않는다.** Ctrl-C 로 끊을 때까지 붙잡고 있는 것이 정상 동작이고,
 * 그래서 다른 명령과 달리 문자열을 돌려주지 않는다.
 */
export async function runGui(opts: {
  port?: string
  out: string
  open: boolean
  adb?: string
}): Promise<void> {
  if (!existsSync(webRoot())) {
    // 화면이 없는데 서버만 띄우면 사용자는 빈 페이지를 보고 원인을 모른다.
    // 저장소에서 직접 `node .../index.js gui` 를 부른 경우에만 여기 온다 —
    // `npm run gui` 는 빌드를 포함하므로 이 문장을 볼 일이 없다.
    throw new Error(
      '화면이 아직 빌드되지 않았습니다.\n' +
        `  기대한 경로  ${webRoot()}\n` +
        'npm run gui 로 실행하세요 (빌드까지 함께 합니다).',
    )
  }

  const server = await startGuiServer({
    ...(opts.adb !== undefined ? { adb: opts.adb } : {}),
    outDir: opts.out,
    version: '0.1.0',
    ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
  })

  console.log(
    `PerfTracker GUI 를 열었습니다.\n` +
      `  ${server.url}\n` +
      `  결과 저장  ${opts.out}\n\n` +
      `이 창을 닫거나 Ctrl-C 를 누르면 서버가 멈춥니다.\n` +
      `측정 중에는 기기에 어떤 명령도 보내지 않습니다.`,
  )

  if (opts.open) openInBrowser(server.url)

  // Ctrl-C 로 끊길 때 열려 있던 세션을 건드리지 않는다 — 측정 중이었다면 그 세션은 여전히
  // 유효하고, `perftracker stop` 으로 이어서 끝낼 수 있다. 서버만 닫는다.
  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 서버가 살아 있는 동안 프로세스를 붙잡아 둔다.
  await new Promise<never>(() => {})
}
