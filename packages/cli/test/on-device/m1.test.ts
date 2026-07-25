import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractRun, readActiveSession } from '@perftracker/core'
import { createContext } from '../../src/context.js'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'

/** 실기기가 필요하다. `npm run test:device` 로만 실행된다. */
describe('M1 end-to-end', () => {
  it('start → stop → result.json 이 완주한다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-e2e-'))
    const ctx = await createContext({})

    await runStart(ctx, {
      name: 'e2e',
      launch: true,
      video: false,
      out,
      force: true,
    })

    const active = await readActiveSession(ctx.serial)
    expect(active).not.toBeNull()

    // 실제 조작 대신 앱이 몇 프레임이라도 그릴 시간을 준다.
    await new Promise((r) => setTimeout(r, 10_000))

    const stopCtx = await createContext({})
    const summary = await runStop(stopCtx, { offline: false })

    expect(summary).toContain('Frame')
    expect(await readActiveSession(ctx.serial)).toBeNull()

    // 원본이 남아 있으므로 기기 없이 재산출된다.
    const again = await extractRun(active!.runDir, {})
    expect(again.schema_version).toBe('1.0.0')
  })
})
