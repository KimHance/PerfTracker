import { spawn } from 'node:child_process'

/**
 * 브라우저로 연다. **실패해도 조용히 넘어간다** — 부르는 쪽이 주소나 경로를 이미 찍었으므로
 * 사람이 직접 열 수 있고, 여기서 던지면 이미 끝난 일(서버가 떴거나 파일이 쓰였거나)이
 * 실패한 것처럼 보인다.
 */
export function openInBrowser(target: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(command, [target], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    }).unref()
  } catch {
    // 무시한다.
  }
}
