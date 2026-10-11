import type { ActiveSession, DexoptLine, SessionCompile, TargetApp } from '@perftracker/core'
import { CompileAppliedError, CompileFailedError, SessionStateError } from '@perftracker/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `runStart` · `runStop` 이 core 를 부르는 **순서와 이음매** (BP-4 · BP-5). core 의 세션 함수는 기기를 부르므로
 * 여기서만 가짜로 바꾼다 — 줄 꼴은 `compile.test.ts` 가 순수 함수로 본다. 이 파일이 보는 것은
 * (1) 거부가 옛 세션 정리 · 앱 해석보다 먼저인가 (2) compile 실패 두 종류가 되돌림 줄을 달고 나가는가
 * (3) 성공 · stop 이 `--compile` 세션에만 줄을 붙이는가.
 */
const core = vi.hoisted(() => ({
  beginStart: vi.fn(),
  resolveTargetApp: vi.fn(),
  startSession: vi.fn(),
  readCaptureManifest: vi.fn(),
  readActiveSession: vi.fn(),
  stopSession: vi.fn(),
  extractRun: vi.fn(),
}))
vi.mock('@perftracker/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@perftracker/core')>()),
  ...core,
}))

const { runStart } = await import('../../src/commands/start.js')
const { runStop } = await import('../../src/commands/stop.js')

const SERIAL = 'R5CT0000001'
const PKG = 'com.google.android.youtube'
const BASE = '/data/app/~~x==/com.google.android.youtube-y==/base.apk'
const line = (status: string): DexoptLine =>
  ({ path: BASE, secondary_dex: false, public_dex: false, abi: 'arm64', status, reason: 'x', location: null, primary_abi: true }) as DexoptLine

const APP = { package: PKG, label: 'YouTube', compile_state_start: [line('speed-profile')] } as unknown as TargetApp
const COMPILE = {
  value: 'speed',
  command: `cmd package compile -m speed -f '${PKG}'`,
  elapsed_ms: 67_500,
  compile_state_before: [line('speed-profile')],
  compile_state_before_reason_code: null,
  compile_state_before_reason: null,
} as SessionCompile
const REVERT = `  adb -s ${SERIAL} shell cmd package compile -m speed-profile -f ${PKG}`

const session = (over: Partial<ActiveSession> = {}): ActiveSession =>
  ({
    version: 1,
    id: 'a1b2c3',
    name: 'youtube-speed',
    serial: SERIAL,
    packageName: PKG,
    runDir: '/runs/r',
    startedAt: '2026-10-11T07:40:12.000Z',
    configuredDurationMs: 1_800_000,
    options: { launch: true },
    startup: null,
    ...over,
  }) as ActiveSession

const ctx = { adb: {}, serial: SERIAL } as unknown as Parameters<typeof runStart>[0]
const opts = (compile?: string, launch = true) => ({
  app: PKG,
  launch,
  out: 'runs',
  force: false,
  ...(compile !== undefined ? { compile } : {}),
})

beforeEach(() => {
  for (const f of Object.values(core)) f.mockReset()
  core.resolveTargetApp.mockResolvedValue(APP)
  core.readCaptureManifest.mockResolvedValue({ target_app: { compile_state_start: [line('speed')] } })
})

describe('BP-4 --launch 없으면 거부 (흐름)', () => {
  it('BP-4 --launch 없으면 거부 — beginStart · 앱 해석 · startSession 0', async () => {
    await expect(runStart(ctx, opts('speed', false))).rejects.toThrow('--compile 은 --launch 와만 · 기기 명령 0')
    expect(core.beginStart).not.toHaveBeenCalled()
    expect(core.resolveTargetApp).not.toHaveBeenCalled()
    expect(core.startSession).not.toHaveBeenCalled()
  })

  it('BP-4 허용 밖 값 거부 — beginStart · 앱 해석 · startSession 0', async () => {
    await expect(runStart(ctx, opts('quicken'))).rejects.toThrow('--compile quicken · 받는 값')
    expect(core.beginStart).not.toHaveBeenCalled()
    expect(core.resolveTargetApp).not.toHaveBeenCalled()
  })
})

describe('BP-5 실패 두 종류에서도 되돌림 줄 (흐름)', () => {
  it('BP-5 실패 두 종류에서도 되돌림 줄 — startSession 이 CompileFailedError 를 던지면 되돌림 줄을 단 오류', async () => {
    core.startSession.mockRejectedValue(new CompileFailedError('speed', COMPILE.command, 1, false, '', 10))
    const err = (await runStart(ctx, opts('speed')).catch((e: unknown) => e)) as Error & { code: string }
    expect(err.code).toBe('COMPILE_FAILED')
    expect(err.message).toContain('Compile   speed · base.apk 바꾸기 전 speed-profile · 지금 모름')
    expect(err.message.split('\n').at(-1)).toBe(REVERT)
    // 실패 뒤 바꾼 뒤 상태를 읽으러 가지 않는다 (호스트 파일도).
    expect(core.readCaptureManifest).not.toHaveBeenCalled()
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — CompileAppliedError 도', async () => {
    core.startSession.mockRejectedValue(new CompileAppliedError(COMPILE, new SessionStateError('force-stop 실패')))
    const err = (await runStart(ctx, opts('speed')).catch((e: unknown) => e)) as Error
    expect(err.message.split('\n')[0]).toBe('force-stop 실패')
    expect(err.message.split('\n').at(-1)).toBe(REVERT)
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — compile 과 무관한 실패는 그 오류 그대로', async () => {
    const original = new SessionStateError('perfetto 실패')
    core.startSession.mockRejectedValue(original)
    await expect(runStart(ctx, opts())).rejects.toBe(original)
  })
})

describe('BP-5 되돌림 줄 — start · stop · 호스트 꼴 (흐름)', () => {
  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: start 성공은 capture.json 의 바꾼 뒤 상태로 컴파일 줄 + 되돌림', async () => {
    core.startSession.mockResolvedValue(session({ compile: COMPILE }))
    const out = await runStart(ctx, opts('speed'))
    expect(core.readCaptureManifest).toHaveBeenCalledWith('/runs/r')
    expect(out).toContain('Compile   speed · base.apk speed-profile → speed · 67,500 ms')
    expect(out).toContain(REVERT)
  })

  it('BP-5 --compile 없으면 출력 그대로 — start 는 capture.json 을 읽지 않는다', async () => {
    core.startSession.mockResolvedValue(session())
    const out = await runStart(ctx, opts())
    expect(core.readCaptureManifest).not.toHaveBeenCalled()
    expect(out).not.toMatch(/Compile|되돌림/)
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: stop 은 --compile 세션에만 · stop 의 기기 호출은 그대로 하나', async () => {
    core.extractRun.mockResolvedValue(undefined)
    core.stopSession.mockResolvedValue({ runDir: '/runs/r', state: 'completed' })

    core.readActiveSession.mockResolvedValue(session({ compile: COMPILE }))
    const withCompile = await runStop(ctx, { offline: true })
    expect(withCompile.split('\n').slice(-3)).toEqual(['', '되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음', REVERT])

    core.readActiveSession.mockResolvedValue(session())
    expect((await runStop(ctx, { offline: true })).split('\n')).toHaveLength(2)
    expect(core.stopSession).toHaveBeenCalledTimes(2)
  })
})
