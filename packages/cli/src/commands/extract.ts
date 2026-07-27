import { extractRun } from '@perftracker/core'

/** 기기가 없어도 된다 — 원본만 있으면 언제든 다시 산출한다. */
export async function runExtract(runDir: string, opts: { offline: boolean }): Promise<string> {
  // stop 과 같은 이유로 요약을 찍지 않는다 (commands/stop.ts 참고).
  await extractRun(runDir, { offline: opts.offline })
  return `→ ${runDir}/result.json`
}
