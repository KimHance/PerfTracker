import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type ActiveSession,
  baseDexLine,
  createAdbContext,
  type DexoptLine,
  parseDexoptState,
  readActiveSession,
  type Result,
  shellQuote,
} from '@perftracker/core'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'
import { DEVICE_OPTS, DEVICE_TARGET_APP } from './target.js'

/**
 * **컴파일 상태를 실기기에서** (기능 문서 baseline-profile BP-9 · 결정 1).
 *
 * (a) 평소 `--launch` → (b) `--compile speed` → (c) `--compile reset` → (d) 진단 + `--compile speed` →
 * (e) (b) 가 낸 되돌림 줄을 **그대로** 셸에 넘긴다. 이 순서가 한 바퀴이고 앞 회의 끝이 뒤 회의 "바꾸기 전" 이다.
 *
 * **이 스펙은 기기 상태를 영구히 바꾼다** (plan B7 · B12 — 받아들인 대가). 되돌려도 base.apk `reason` 은
 * `cmdline` 으로 남는다 — (e) 가 그 사실을 단언한다. 중간에 실패해 (e) 에 닿지 못하면 `afterAll` 이 잡아 둔
 * 되돌림 줄을 대신 돌린다 (기기를 `speed` · `verify` 로 두고 떠나지 않으려고).
 *
 * 창 밖 읽기(`dumpsys package`)와 스와이프는 adb 를 직접 부른다 — 측정 창 래치 밖의 사람 몫과 같다.
 * 창 안 기기 접촉 0 은 회마다 `adb_commands_during_session` 으로 본다.
 *
 * 대상은 기능 문서의 앱(YouTube) 하나다 — 다른 앱이면 전체를 건너뜀으로 남긴다 (그 앱의 컴파일 상태를 몰래
 * 바꾸지 않는다). 수의 크기는 단언하지 않고 관계와 기기 낱말만 단언한다. `[BP-9]` 줄은 시험 기록용이다.
 */

/** 기능 문서 BP-9 · 결정 1 의 앱. */
const BP9_APP = 'com.google.android.youtube'

/** speed 컴파일 실측 67.5초 + 세션 · extract. 기본 훅 한도(60초)로는 끊긴다. */
const COMPILE_HOOK_MS = 600_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Run {
  active: ActiveSession
  startOutput: string
  stopOutput: string
  result: Result
}

/** 창 밖에서 `dumpsys package <pkg>` 한 번 — 도구를 거치지 않는다. */
async function readStateOutside(): Promise<DexoptLine[]> {
  const ctx = await createAdbContext(DEVICE_OPTS)
  const read = parseDexoptState(await ctx.adb.tryShell(`dumpsys package ${DEVICE_TARGET_APP}`), DEVICE_TARGET_APP)
  expect(read.lines, `창 밖 dumpsys 를 못 읽었다: ${JSON.stringify(read.reason)}`).not.toBeNull()
  return read.lines!
}

function base(lines: readonly DexoptLine[] | null | undefined): DexoptLine {
  const b = baseDexLine(lines)
  expect(b, 'base.apk 줄을 고르지 못했다').not.toBeNull()
  return b!
}

/** 보조 dex 줄의 `path status/reason` — 기록용. */
const secondary = (lines: readonly DexoptLine[]) =>
  lines.filter((l) => l.secondary_dex).map((l) => `${l.path.split('/').slice(-2).join('/')} ${l.status}/${l.reason}`)

const log = (label: string, v: unknown) => console.log(`[BP-9] ${label} ${JSON.stringify(v)}`)

/** `wm size` 에서 화면 크기 — Override 가 있으면 그것. */
function screenSize(wm: string): { w: number; h: number } {
  const m = /Override size:\s*(\d+)x(\d+)/.exec(wm) ?? /Physical size:\s*(\d+)x(\d+)/.exec(wm)
  if (m === null) throw new Error(`wm size 를 읽지 못했다: ${wm}`)
  return { w: Number(m[1]), h: Number(m[2]) }
}

/** 출력에서 호스트가 그대로 받는 되돌림 명령 줄 (BP-5 꼴) — 앞 들여쓰기만 떼고 글자 그대로. */
function revertCommands(output: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^adb -s \S+ shell cmd package compile /.test(l))
}

/** start → (스와이프) → stop. 화면 크기는 start **전에** 읽는다 — 창이 열린 뒤에는 도구가 기기에 묻지 않는다. */
async function runSession(
  name: string,
  out: string,
  opts: { compile?: string; diagnose?: boolean; swipes?: number },
): Promise<Run> {
  const ctx = await createContext(DEVICE_OPTS)
  const { w, h } = screenSize(await ctx.adb.tryShell('wm size'))
  const startOutput = await runStart(ctx, {
    app: DEVICE_TARGET_APP,
    name,
    launch: true,
    out,
    force: false,
    ...(opts.diagnose ? { diagnose: true } : {}),
    ...(opts.compile !== undefined ? { compile: opts.compile } : {}),
  })
  const active = await readActiveSession(ctx.serial)
  expect(active, '세션 포인터가 없다').not.toBeNull()

  await sleep(3_000)
  const swipe = ['-s', ctx.serial, 'shell', 'input', 'swipe',
    String(Math.round(w / 2)), String(Math.round(h * 0.73)),
    String(Math.round(w / 2)), String(Math.round(h * 0.3)), '300']
  for (let i = 0; i < (opts.swipes ?? 0); i++) {
    execFileSync(ctx.adb.adbPath, swipe, { stdio: 'ignore' })
    await sleep(1_500)
  }

  const stopOutput = await runStop(await createContext(DEVICE_OPTS), { offline: false })
  expect(await readActiveSession(ctx.serial)).toBeNull()
  const result = JSON.parse(readFileSync(join(active!.runDir, 'result.json'), 'utf8')) as Result
  log(`${name} runDir`, active!.runDir)
  return { active: active!, startOutput, stopOutput, result }
}

describe.skipIf(DEVICE_TARGET_APP !== BP9_APP)('BP-9 실기기 — YouTube 컴파일 상태 (a → e 한 바퀴)', () => {
  const out = mkdtempSync(join(tmpdir(), 'pt-bp9-'))
  /** 이 스펙이 기기를 건드리기 전의 상태 — (e) 의 "처음 값". */
  let initial: DexoptLine[]
  /** (b) 가 낸 되돌림 줄 — (e) 가 그대로 돌린다. */
  let revert: string[] = []
  let reverted = false
  /** 도구가 찾은 adb 의 폴더 — 되돌림 줄의 `adb` 가 같은 바이너리로 가게. */
  let adbDir: string

  beforeAll(async () => {
    adbDir = dirname((await createAdbContext(DEVICE_OPTS)).adb.adbPath)
    initial = await readStateOutside()
    log('처음 base', base(initial))
    log('처음 보조 dex', secondary(initial))
  })

  afterAll(() => {
    // (e) 에 닿지 못했으면 잡아 둔 되돌림 줄을 대신 돌린다 — 실패한 스펙이 기기를 바꾼 채 떠나지 않게.
    if (!reverted && revert.length > 0) for (const line of revert) runHostLine(line)
  }, COMPILE_HOOK_MS)

  /** 되돌림 줄 하나를 호스트 셸에 글자 그대로. `adb` 는 도구가 찾은 그 adb 다. */
  function runHostLine(line: string): string {
    return execFileSync('/bin/sh', ['-c', line], {
      encoding: 'utf8',
      timeout: COMPILE_HOOK_MS,
      env: { ...process.env, PATH: `${adbDir}:${process.env['PATH'] ?? ''}` },
    })
  }

  describe('(a) start --launch → stop', () => {
    let before: DexoptLine[]
    let a: Run
    let after: DexoptLine[]

    beforeAll(async () => {
      before = await readStateOutside()
      a = await runSession('bp9-a', out, {})
      after = await readStateOutside()
    }, COMPILE_HOOK_MS)

    it('BP-9 (a) 시작 · 끝 base.apk status · reason 이 같은 순간 창 밖 dumpsys 와 같다 · 창 안 adb 0', () => {
      const r = a.result
      expect(r.measurement_overhead.adb_commands_during_session).toBe(0)
      expect(r.session.compile, '--compile 없는 세션인데 바꾼 기록이 있다').toBeUndefined()
      const start = base(r.target_app.compile_state_start)
      const end = base(r.target_app.compile_state_end)
      expect({ status: start.status, reason: start.reason }).toEqual({ status: base(before).status, reason: base(before).reason })
      expect({ status: end.status, reason: end.reason }).toEqual({ status: base(after).status, reason: base(after).reason })
      // 줄 수를 줄이지 않는다 (BP-1) — 같은 순간 dumpsys 의 dex 줄 전부.
      expect(r.target_app.compile_state_start).toEqual(before)
      expect(r.target_app.compile_state_end).toEqual(after)
      log('(a) 시작 · 끝 base', { start: `${start.status}/${start.reason}`, end: `${end.status}/${end.reason}` })
    })

    describe('(b) start --launch --compile speed', () => {
      let b: Run

      beforeAll(async () => {
        b = await runSession('bp9-b', out, { compile: 'speed' })
        revert = revertCommands(b.startOutput)
        log('(b) 되돌림 줄', revert)
        // 명령 대신 낸 사실 줄(보조 dex 끼리 다름 등)까지 — start 출력의 Compile 줄부터 끝까지.
        log('(b) start 출력 (Compile 줄부터)', b.startOutput.slice(b.startOutput.indexOf('Compile')).split('\n'))
      }, COMPILE_HOOK_MS)

      it('BP-9 (b) 시작 상태 speed / cmdline · 바꾸기 전 = (a) 끝 · TotalTime 있음 · 창 안 adb 0', () => {
        const r = b.result
        expect(r.measurement_overhead.adb_commands_during_session).toBe(0)
        const start = base(r.target_app.compile_state_start)
        expect({ status: start.status, reason: start.reason }).toEqual({ status: 'speed', reason: 'cmdline' })

        const rec = r.session.compile
        expect(rec, '--compile 세션인데 바꾼 기록이 없다').toBeDefined()
        expect(rec!.value).toBe('speed')
        // 실측 꼴 그대로 · 범위 옵션 없음 (결정 9). 패키지는 core 가 셸 인용해 보낸다.
        expect(rec!.command).toBe(`cmd package compile -m speed -f ${shellQuote(DEVICE_TARGET_APP)}`)
        const prior = base(rec!.compile_state_before)
        const aEnd = base(a.result.target_app.compile_state_end)
        expect({ status: prior.status, reason: prior.reason }).toEqual({ status: aEnd.status, reason: aEnd.reason })

        const startup = r.metrics.startup?.data as { total_time_ms: number | null } | null | undefined
        expect(startup?.total_time_ms, 'TotalTime 이 없다').toEqual(expect.any(Number))
        log('(b) 바꾼 기록', { before: `${prior.status}/${prior.reason}`, after: `${start.status}/${start.reason}`, elapsed_ms: rec!.elapsed_ms, total_time_ms: startup!.total_time_ms })
      })

      it('BP-9 (b) 되돌림 줄 — start · stop 이 같은 줄을 낸다 · base 는 바꾸기 전 status 로', () => {
        expect(revert.length, 'start 출력에 되돌림 줄이 없다').toBeGreaterThan(0)
        expect(revertCommands(b.stopOutput)).toEqual(revert)
        const prior = base(b.result.session.compile!.compile_state_before)
        expect(revert[0]).toBe(`adb -s ${b.active.serial} shell cmd package compile -m ${prior.status} -f ${DEVICE_TARGET_APP}`)
      })

      describe('(c) start --launch --compile reset', () => {
        let c: Run

        beforeAll(async () => {
          c = await runSession('bp9-c', out, { compile: 'reset' })
        }, COMPILE_HOOK_MS)

        it('BP-9 (c) 시작 상태 verify · reason 은 기록만 · 창 안 adb 0', () => {
          const r = c.result
          expect(r.measurement_overhead.adb_commands_during_session).toBe(0)
          expect(r.session.compile?.command).toBe(`cmd package compile --reset ${shellQuote(DEVICE_TARGET_APP)}`)
          const start = base(r.target_app.compile_state_start)
          expect(start.status).toBe('verify')
          log('(c) 시작 base', { status: start.status, reason: start.reason, location: start.location })
          log('(c) 시작 보조 dex', secondary(r.target_app.compile_state_start!))
        })

        describe('(d) 진단 + start --launch --compile speed', () => {
          let d: Run

          beforeAll(async () => {
            d = await runSession('bp9-d', out, { compile: 'speed', diagnose: true, swipes: 4 })
          }, COMPILE_HOOK_MS)

          it('BP-9 (d) 컴파일 상태 slice 의 base 줄 filter speed · JIT slice 수 null 아님 · 접은 뒤 표 행 수 · 창 안 adb 0', () => {
            const r = d.result
            expect(r.measurement_overhead.adb_commands_during_session).toBe(0)
            expect(r.session.options.diagnose).toBe(true)
            const diag = r.diagnose!
            expect(diag.atrace_categories).toContain('dalvik')

            const start = base(r.target_app.compile_state_start)
            expect(start.status).toBe('speed')
            const slices = diag.target_process_compile_state_slices
            expect(slices, `컴파일 상태 slice null: ${diag.target_process_compile_state_slices_reason ?? ''}`).not.toBeNull()
            // base 줄 = dumpsys 의 base.apk 줄과 같은 location 을 연 slice.
            const baseSlice = slices!.filter((s) => s.location === start.location)
            expect(baseSlice.length, `location ${start.location} 의 slice 가 없다`).toBeGreaterThan(0)
            expect(baseSlice.map((s) => s.filter)).toEqual(baseSlice.map(() => 'speed'))
            expect(diag.target_process_jit_slices, `JIT 수 null: ${diag.target_process_jit_slices_reason ?? ''}`).not.toBeNull()

            const rows = diag.target_process_slice_names
            expect(rows).not.toBeNull()
            log('(d) ART', {
              base_slice: baseSlice,
              jit_slices: diag.target_process_jit_slices,
              names_unfolded: diag.target_process_slice_names_unfolded,
              table_rows: rows!.length,
              class_descriptor_rows: rows!.filter((x) => x.name === 'L*;').length,
              status: diag.status,
              reason_code: diag.reason_code,
            })
          })

          it('BP-9 (e) 되돌림 줄을 그대로 실행하면 base.apk status 가 처음 값 · reason 은 cmdline', async () => {
            expect(revert.length, '(b) 되돌림 줄이 없다').toBeGreaterThan(0)
            const outputs = revert.map((line) => runHostLine(line).trim())
            reverted = true
            log('(e) 실행 출력', outputs)

            const now = await readStateOutside()
            const b0 = base(initial)
            const b1 = base(now)
            log('(e) 끝 base', b1)
            log('(e) 끝 보조 dex', secondary(now))
            // 보조 dex 는 단언하지 않는다 — 기기(bg-dexopt)가 세션 사이에 바꿀 수 있고, 되돌림 줄은 바꾸기 전 보조 dex 의
            // status 가 모두 같을 때만 낸다 (BP-5). 처음과 같은지만 기록한다.
            log('(e) 보조 dex 처음과 같음', JSON.stringify(secondary(now)) === JSON.stringify(secondary(initial)))
            expect(b1.status).toBe(b0.status)
            expect(b1.reason).toBe('cmdline')
          }, COMPILE_HOOK_MS)
        })
      })
    })
  })
})
