import { describe, expect, it } from 'vitest'
import { createAdbContext, loadLabeledApps, runDoctor } from '@perftracker/core'

/** 실기기가 필요하다. `npm run test:device` 로만 실행된다. */
describe('M0 기기 통합', () => {
  it('doctor 의 모든 항목이 통과한다', async () => {
    const checks = await runDoctor({})
    const failed = checks.filter((c) => !c.ok)
    expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([])
  })

  it('앱 목록에서 라벨이 해석된다', async () => {
    const ctx = await createAdbContext({})
    const apps = await loadLabeledApps(ctx)

    expect(apps.length).toBeGreaterThan(0)
    // 최소 한 개는 패키지명 폴백이 아니라 실제 리소스에서 읽혀야 한다.
    expect(apps.some((a) => a.labelSource === 'apk_resources')).toBe(true)
  })
})
