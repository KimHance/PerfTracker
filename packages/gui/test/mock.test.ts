import { describe, expect, it } from 'vitest'
import { diagnoseDoctorCheck, diagnoseNotice } from '@perftracker/core'
import type { StartRequest } from '../src/contract/api.js'
import { createMockClient } from '../src/web/api/mock.js'

/**
 * **`?mock` 의 진단 상태.** 측정 화면 6상태(디자인 문서 `## 상태`)가 서버 · 기기 없이 클릭으로
 * 닿아야 한다 — 다음 단위가 이 목업으로 사진을 찍는다.
 *
 * 목업은 core 를 import 하지 않으므로(규칙 4) core 의 문장과 판정을 글자로 다시 적었다.
 * 그 사본이 core 와 어긋나면 목업 화면이 실제와 다른 줄을 보여 준다 — 그래서 여기서
 * core 의 `diagnoseDoctorCheck` · `diagnoseNotice` 와 직접 대조한다.
 */

const SDK36 = 'R5CT0000001'
const SDK30 = 'R38M20ABCDE'

const mock = () => createMockClient({ latencyMs: 0 })

function startReq(serial: string, packageName: string, diagnose: boolean): StartRequest {
  return {
    serial,
    packageName,
    name: null,
    launch: true,
    force: true,
    ...(diagnose ? { diagnose: true as const } : {}),
  }
}

describe('?mock 진단 상태', () => {
  it('DM-10 ?mock doctor-sdk30 — 진단 줄이 capability 맨 끝에 있고 core 의 줄과 같다', async () => {
    const api = mock()

    for (const [serial, sdk] of [
      [SDK36, 36],
      [SDK30, 30],
    ] as const) {
      const checks = await api.doctor(serial)
      const core = diagnoseDoctorCheck(sdk)

      expect(checks.at(-1)).toEqual({ name: core.name, ok: core.ok, detail: core.detail, kind: core.kind })
      // 실제 doctor 처럼 지표 판정 줄 뒤다 — "capability 끝에".
      expect(checks.filter((c) => c.kind === 'capability').at(-1)?.name).toBe(core.name)
    }
    expect((await api.doctor(SDK30)).at(-1)?.ok).toBe(false)
  })

  it('DM-10 ?mock — 기기를 모르면 진단 줄을 지어내지 않는다', async () => {
    const checks = await mock().doctor(null)

    expect(checks.map((c) => c.name)).not.toContain(diagnoseDoctorCheck(36).name)
  })

  it('DM-10 ?mock running-unknown — sdk 30 기기의 진단 세션 고지가 core 의 고지와 같다', async () => {
    const api = mock()
    // 목업의 debuggable: `.debug` 로 끝나면 true · 시험 앱 하나는 모름(null) · 나머지 false.
    const cases = [
      { serial: SDK30, pkg: 'com.airbnb.android', notice: diagnoseNotice(30, false) },
      { serial: SDK30, pkg: 'com.streamlive.blur.test', notice: diagnoseNotice(30, null) },
      { serial: SDK30, pkg: 'com.example.streaming.debug', notice: diagnoseNotice(30, true) },
      { serial: SDK36, pkg: 'com.airbnb.android', notice: diagnoseNotice(36, false) },
    ]

    for (const c of cases) {
      const started = await api.start(startReq(c.serial, c.pkg, true))
      expect(started.diagnose).toEqual({ notice: c.notice })
      await api.stop(c.serial, { offline: false })
    }
    // 위 넷 중 고지가 실제로 나오는 것은 sdk 30 · debuggable 아님 / 모름 둘이다.
    expect(cases.filter((c) => c.notice !== null)).toHaveLength(2)
  })

  it('DM-12 ?mock running — 진단 세션은 세션 목록에서도 진단 칸을 지키고, 평소 세션엔 없다', async () => {
    const api = mock()
    const diag = await api.start(startReq(SDK36, 'com.airbnb.android', true))
    const plain = await api.start(startReq(SDK30, 'com.airbnb.android', false))

    expect(diag.command).toContain('perftracker start --diagnose --app')
    expect(plain.command).not.toContain('--diagnose')
    expect(Object.keys(plain)).not.toContain('diagnose')

    const sessions = await api.sessions()
    expect(sessions.find((s) => s.serial === SDK36)?.diagnose).toEqual({ notice: null })
    expect(Object.keys(sessions.find((s) => s.serial === SDK30)!)).not.toContain('diagnose')
  })

  it('DM-12 ?mock drawer — 기록에 진단 run 과 평소 run 이 같이 있고, 진단 세션을 정지하면 진단 기록이 생긴다', async () => {
    const api = mock()

    const before = (await api.runs()).runs
    expect(before.some((r) => r.diagnose === true)).toBe(true)
    expect(before.some((r) => !('diagnose' in r))).toBe(true)

    await api.start(startReq(SDK36, 'com.airbnb.android', true))
    const diag = (await api.stop(SDK36, { offline: false })).run
    await api.start(startReq(SDK36, 'com.airbnb.android', false))
    const plain = (await api.stop(SDK36, { offline: false })).run

    expect(diag.diagnose).toBe(true)
    expect(Object.keys(plain)).not.toContain('diagnose')
  })

  it('DM-12 ?mock — 버린 진단 세션은 다음 세션에 진단 칸을 남기지 않는다', async () => {
    const api = mock()
    await api.start(startReq(SDK36, 'com.airbnb.android', true))
    await api.abort(SDK36)
    await api.start(startReq(SDK36, 'com.airbnb.android', false))

    expect(Object.keys((await api.sessions())[0]!)).not.toContain('diagnose')
  })
})
