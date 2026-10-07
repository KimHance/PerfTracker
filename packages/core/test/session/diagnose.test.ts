import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIAGNOSE_COPY, fillCopy } from '../../src/copy/diagnose.js'
import { diagnoseDoctorCheck, hasBlockingFailure, runDoctor } from '../../src/diagnostics/doctor.js'
import { appSliceOpen, diagnoseNotice, diagnoseScope } from '../../src/session/diagnose.js'
import { computeStatus } from '../../src/session/status.js'
import type { ActiveSession } from '../../src/session/state.js'
import { SERIAL, tempDirs } from '../support/fakeDevice.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

/**
 * 앱 slice 가 열리는 조건 (기능 문서 diagnostic-mode 「앱 slice 가 열리는 조건」 표).
 * 이 표 하나를 doctor · start · 화면 · extract 가 같이 쓴다 (DM-10 「판정 출처 하나」).
 */
describe('appSliceOpen — 조건 표 (DM-10 판정)', () => {
  it('DM-10 판정 — sdk ≥31 이면 debuggable 과 무관하게 열림', () => {
    for (const sdk of [31, 34, 35, 36]) {
      for (const debuggable of [true, false, null, undefined]) {
        expect(appSliceOpen(sdk, debuggable), `${sdk} ${debuggable}`).toEqual({ open: true })
      }
    }
  })

  it('DM-10 판정 — sdk ≤30 · debuggable true 면 열림', () => {
    expect(appSliceOpen(30, true)).toEqual({ open: true })
    expect(appSliceOpen(29, true)).toEqual({ open: true })
  })

  /**
   * "모름" 은 false 가 아니다 — sdk ≤30 에서는 profileable 앱에도 열리는데 profileable 을 읽을
   * 출처가 없다 (열린 질문 3). false 를 내면 profileable 앱을 두고 "안 열렸다" 고 말하게 된다.
   */
  it('DM-10 판정 — sdk ≤30 · debuggable false 또는 모름이면 null (false 가 아님)', () => {
    expect(appSliceOpen(30, false)).toEqual({ open: null, debuggable: false })
    expect(appSliceOpen(30, null)).toEqual({ open: null, debuggable: null })
    expect(appSliceOpen(30, undefined)).toEqual({ open: null, debuggable: null })
    expect(appSliceOpen(29, false)).toEqual({ open: null, debuggable: false })
  })

  it('DM-3 범위 — 카테고리 am · wm · view 와 대상 앱 하나', () => {
    expect(diagnoseScope('com.google.android.youtube')).toEqual({
      categories: ['am', 'wm', 'view'],
      apps: ['com.google.android.youtube'],
    })
  })
})

describe('DM-10 doctor 진단 줄', () => {
  it('DM-10 doctor 진단 줄 — sdk ≥31 ✓ · sdk ≤30 ✗ · 둘 다 capability', () => {
    expect(diagnoseDoctorCheck(36)).toEqual({
      name: 'diagnose: app slice',
      ok: true,
      kind: 'capability',
      detail: 'sdk 36 · 열림',
    })
    expect(diagnoseDoctorCheck(30)).toEqual({
      name: 'diagnose: app slice',
      ok: false,
      kind: 'capability',
      detail: 'sdk 30 · debuggable 앱만 열림',
    })
  })

  /** sdk 는 고칠 수 없는 사실이다 — ✗ 여도 doctor 의 종료 코드는 0 이다. */
  it('DM-10 doctor 진단 줄 — ✗ 여도 종료 코드를 바꾸지 않는다', () => {
    expect(hasBlockingFailure([diagnoseDoctorCheck(30)])).toBe(false)
  })

  it('DM-10 doctor 진단 줄 — runDoctor 가 capability 끝에 한 줄 낸다', async () => {
    const { home } = tempDirs()
    const r = new FakeProcessRunner()
      .on('devices -l', { stdout: `List of devices attached\n${SERIAL}\tdevice usb:0-1 model:SM_S901N\n` })
      .on('version', { stdout: 'Android Debug Bridge version 1.0.41\n' })
      .on(`-s ${SERIAL} shell which perfetto`, { stdout: '/system/bin/perfetto\n' })
      .on(`-s ${SERIAL} shell getprop ro.build.version.sdk`, { stdout: '30\n' })

    const checks = await runDoctor({ adb: process.execPath, runner: r, home })
    const capabilities = checks.filter((c) => c.kind === 'capability')

    expect(capabilities.at(-1)).toEqual(diagnoseDoctorCheck(30))
    expect(checks.filter((c) => c.name === 'diagnose: app slice')).toHaveLength(1)
  })
})

/**
 * doctor 가 ✓ 라 한 기기에서 start 가 "모름" 을 내는 일이 없어야 한다. 둘이 같은 함수를 부르는지를
 * 결과(격자 전체)와 구조(조건 표의 sdk 경계가 한 파일에만 있다) 두 쪽에서 본다.
 */
describe('DM-10 판정 출처 하나', () => {
  it('DM-10 판정 출처 하나 — doctor · start 고지가 sdk × debuggable 격자 전체에서 appSliceOpen 과 같다', () => {
    for (let sdk = 26; sdk <= 37; sdk += 1) {
      expect(diagnoseDoctorCheck(sdk).ok, `doctor ${sdk}`).toBe(appSliceOpen(sdk, null).open === true)
      for (const debuggable of [true, false, null, undefined]) {
        expect(diagnoseNotice(sdk, debuggable) === null, `start ${sdk} ${debuggable}`).toBe(
          appSliceOpen(sdk, debuggable).open === true,
        )
      }
    }
  })

  it('DM-10 판정 출처 하나 — sdk 경계(APP_SLICE_MIN_SDK)는 session/diagnose.ts 에만 있다', () => {
    const src = join(import.meta.dirname, '../../src')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
      })
    const users = files(src).filter((f) => readFileSync(f, 'utf8').includes('APP_SLICE_MIN_SDK'))
    expect(users.map((f) => f.slice(src.length + 1))).toEqual(['session/diagnose.ts'])

    expect(readFileSync(join(src, 'diagnostics/doctor.ts'), 'utf8')).toContain('appSliceOpen(')
    expect(readFileSync(join(src, 'session/start.ts'), 'utf8')).toContain('diagnoseNotice(')
  })
})

describe('DM-10 start 고지 문구', () => {
  it('DM-10 start 고지 — "모름" 칸의 두 갈래가 문구 모음의 줄을 sdk 로 채운 것이다', () => {
    expect(diagnoseNotice(30, false)).toBe(fillCopy(DIAGNOSE_COPY.noticeNotDebuggable, { sdk: 30 }))
    expect(diagnoseNotice(30, null)).toBe(fillCopy(DIAGNOSE_COPY.noticeDebuggableUnknown, { sdk: 30 }))
    expect(diagnoseNotice(36, false)).toBeNull()
  })
})

describe('fillCopy', () => {
  it('자리표시를 값으로 채운다', () => {
    expect(fillCopy('sdk {sdk} · 열림', { sdk: 31 })).toBe('sdk 31 · 열림')
  })

  /** 빈 문자열로 지우면 `sdk  · 열림` 처럼 사실과 다른 말이 되는데 알아챌 방법이 없다. */
  it('값이 없는 자리는 지우지 않고 남긴다', () => {
    expect(fillCopy('sdk {sdk} · {x}', { sdk: 30 })).toBe('sdk 30 · {x}')
  })
})

describe('DM-17 — status 의 최대 시간 넘음은 세션의 상한을 따른다', () => {
  const session = (configuredDurationMs: number): ActiveSession => ({
    version: 1,
    id: 'abc123',
    name: 'n',
    serial: SERIAL,
    packageName: 'com.x',
    runDir: '/tmp/x',
    perfettoKey: 'perftracker_abc123',
    remoteTracePath: '/data/misc/perfetto-traces/perftracker_abc123.pftrace',
    startedAt: '2026-10-08T00:00:00.000Z',
    configuredDurationMs,
    options: { launch: false },
    startup: null,
  })

  it('DM-17 computeStatus — 진단 세션(10분)은 10분을 넘으면 넘음 · 평소(30분)는 아직 아님', () => {
    const at = new Date('2026-10-08T00:10:01.000Z')
    expect(computeStatus(session(600_000), at).durationExceeded).toBe(true)
    expect(computeStatus(session(1_800_000), at).durationExceeded).toBe(false)
    expect(computeStatus(session(600_000), new Date('2026-10-08T00:09:59.000Z')).durationExceeded).toBe(false)
  })
})
