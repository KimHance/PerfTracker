import { extractRun } from '@perftracker/core'
import { formatSummary } from '../format/summary.js'

/** 기기가 없어도 된다 — 원본만 있으면 언제든 다시 산출한다. */
export async function runExtract(runDir: string, opts: { offline: boolean }): Promise<string> {
  const result = await extractRun(runDir, { offline: opts.offline })
  return `${formatSummary(result)}\n\n→ ${runDir}/result.json`
}
