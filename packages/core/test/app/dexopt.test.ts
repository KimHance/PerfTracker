import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { getAppDetail } from '../../src/app/detail.js'
import {
  baseDexLine,
  compileStateChangeWarning,
  compileStateFields,
  dexoptUnavailable,
  parseDexoptState,
  readDexoptState,
} from '../../src/app/dexopt.js'
import { copyViolations } from '../../src/copy/wordform.js'
import { renderReason } from '../../src/schema/reasons.js'
import { type DexoptLine, TargetAppSchema } from '../../src/schema/result.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

const YT = 'com.google.android.youtube'
const INSTALL = '/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/com.google.android.youtube-_ZCw5JfQvaAuZ5khXQX0GQ=='
const BASE = `${INSTALL}/base.apk`

/**
 * 실기기 원문 셋 (SM-S901N · sdk 36 · YouTube 21.40.161 · 2026-10-11 research `raw-baseline/`):
 *   - `dumpsys-package-dexopt-youtube.txt` — A1 `dumpsys package` 를 줄였다 (Packages 머리 · `Dexopt state` ~
 *     `Profile utilization state` 앞부분 · `Compiler stats` · `HeimdAllFS state`). HeimdAllFS 절에도 `[<pkg>]` 와
 *     `path:` 줄이 있어 절 경계를 시험한다.
 *   - `dumpsys-package-dexopt-restored.txt` — F3 그대로 (speed-profile 로 되돌린 뒤 · 보조 dex 둘이 `location is error`).
 *   - `dumpsys-package-dexopt-reset.txt` — C-state1 의 `--reset` 직후 원문. research 가 `[<pkg>]` 부터 잘라 담아
 *     `Dexopt state:` 머리 한 줄만 붙였다 (그 밖은 바이트 그대로).
 */
describe('parseDexoptState — 실기기 원문', () => {
  it('BP-1 dumpsys Dexopt state 파싱 (A1) — base.apk speed-profile / profile-utilization · 보조 dex 셋 verify / vdex', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT)

    expect(read.reason).toBeNull()
    expect(read.lines).toEqual([
      {
        path: BASE,
        secondary_dex: false,
        abi: 'arm64',
        status: 'speed-profile',
        reason: 'profile-utilization',
        primary_abi: true,
        location: `${INSTALL}/oat/arm64/base.odex`,
      },
      ...[
        '/data/user/0/com.google.android.youtube/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B',
        '/data/user/0/com.google.android.youtube/app_pccache2/5/C261F5452FADA828A0BEBA37A55BDC37FE758C0A',
        '/data/user/0/com.google.android.youtube/app_yqzdkcache/drgd/v',
      ].map((dir) => ({
        path: `${dir}/pcam.jar`,
        secondary_dex: true,
        abi: 'arm64',
        status: 'verify',
        reason: 'vdex',
        primary_abi: true,
        location: `${dir}/oat/arm64/pcam.vdex`,
      })),
    ])
    // 같은 출력의 HeimdAllFS 절 `path: …/split_config.*.apk` 는 Dexopt state 가 아니다.
    expect(read.lines!.some((l) => l.path.includes('split_config'))).toBe(false)
  })

  it('BP-1 dumpsys Dexopt state 파싱 (F3) — location 이 error 원문 그대로', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-restored.txt'), YT)

    expect(read.reason).toBeNull()
    expect(read.lines!.map((l) => [l.status, l.reason, l.location?.endsWith('.odex') || l.location?.endsWith('.vdex') ? 'file' : l.location])).toEqual([
      ['speed-profile', 'cmdline', 'file'],
      ['verify', 'vdex', 'file'],
      ['run-from-apk', 'unknown', 'error'],
      ['run-from-apk', 'unknown', 'error'],
    ])
  })

  it('BP-1 dumpsys Dexopt state 파싱 (C-state1) — 공백 든 location 문장이 원문 그대로', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-reset.txt'), YT)

    expect(read.lines).toEqual([
      {
        path: BASE,
        secondary_dex: false,
        abi: 'arm64',
        status: 'verify',
        reason: 'vdex-dm',
        primary_abi: true,
        location: `primary.vdex mapped directly in memory from ${INSTALL}/base.dm`,
      },
    ])
  })

  it('BP-1 파싱한 줄이 스키마를 그대로 통과한다', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT)
    const app = { package: YT, label: 'YouTube', label_source: 'package_name', version_name: null, version_code: null,
      uid: null, install_source: null, launcher_activity: null, pid: null, ...compileStateFields('start', read) }
    expect(TargetAppSchema.parse(app)).toEqual(app)
  })
})

describe('parseDexoptState — 못 읽으면 null + 이유', () => {
  it('BP-2 Dexopt state 없음 null — 절이 없는 실기기 원문', () => {
    const read = parseDexoptState(fixture('dumpsys-package-release.txt'), 'com.example.streaming')
    expect(read).toEqual({ lines: null, reason: { code: 'dexopt_state_section_missing' } })
  })

  it('BP-2 Dexopt state 대상 패키지 줄 없음 null', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), 'com.example.other')
    expect(read).toEqual({
      lines: null,
      reason: { code: 'dexopt_state_package_missing', detail: { package: 'com.example.other' } },
    })
  })

  /** 결정 12 — 절은 있는데 줄 꼴을 모르면 추측하지 않는다. 한 줄이라도 모르면 상태 전체가 null. */
  it.each([
    ['ABI 줄 꼴이 다름', '      arm64: status=speed-profile reason=install'],
    ['칸이 하나 더', '      arm64: [status=speed] [reason=cmdline] [primary-abi] [extra]'],
    ['모르는 줄', '    something new: 1'],
    ['dex 없이 ABI 줄', null],
  ])('BP-2 줄 꼴 모름 null — %s', (_, extra) => {
    const text =
      extra === null
        ? `Dexopt state:\n  [${YT}]\n      arm64: [status=verify] [reason=vdex] [primary-abi]\n`
        : `Dexopt state:\n  [${YT}]\n    path: ${BASE}\n      arm64: [status=verify] [reason=vdex] [primary-abi]\n${extra}\n`
    const read = parseDexoptState(text, YT)
    expect(read.lines).toBeNull()
    expect(read.reason?.code).toBe('dexopt_state_unparsable')
  })

  it('BP-2 줄 꼴 모름 null — 패키지 줄만 있고 dex 줄이 하나도 없다 ([] 로 채우지 않음)', () => {
    const read = parseDexoptState(`Dexopt state:\n  [${YT}]\n\nSPEG state:\n`, YT)
    expect(read).toEqual({ lines: null, reason: { code: 'dexopt_state_unparsable', detail: { line: null } } })
  })

  it('BP-2 시작 상태 — dumpsys package 가 실패하면 null + dexopt_state_unavailable', async () => {
    const runner = new FakeProcessRunner().onMatch(/dumpsys package/, { code: 1, stderr: 'error: device offline\n' })
    const detail = await getAppDetail(new AdbClient({ adbPath: '/fake/adb', runner }), YT)
    expect(detail.compileState).toEqual(dexoptUnavailable('start', 'command_failed', 1))
  })

  it('BP-2 끝 상태 — 실행기가 던져도 null + dexopt_state_unavailable (stop 을 죽이지 않는다)', async () => {
    const adb = new AdbClient({
      adbPath: '/fake/adb',
      runner: {
        run: () => {
          throw new Error('spawn adb ENOENT')
        },
      },
    })
    expect(await readDexoptState(adb, YT)).toEqual(dexoptUnavailable('end', 'command_failed'))
  })

  it('BP-2 새 사유 문장은 단어형이다 — 평가 · 권유 낱말 0 (DM-15 규칙)', () => {
    const reasons = [
      { code: 'dexopt_state_section_missing' as const },
      { code: 'dexopt_state_package_missing' as const, detail: { package: YT } },
      { code: 'dexopt_state_unparsable' as const, detail: { line: '    x: 1' } },
      { code: 'dexopt_state_unparsable' as const, detail: { line: null } },
      ...(['start', 'end'] as const).flatMap((phase) =>
        (['command_failed', 'session_running', 'not_recorded'] as const).map((cause) => dexoptUnavailable(phase, cause, 1).reason!),
      ),
    ]
    for (const r of reasons) {
      const text = renderReason(r)!
      expect(text, r.code).not.toBe(r.code)
      expect(copyViolations(text), text).toEqual([])
    }
  })
})

const line = (over: Partial<DexoptLine>): DexoptLine => ({
  path: BASE,
  secondary_dex: false,
  abi: 'arm64',
  status: 'speed-profile',
  reason: 'profile-utilization',
  primary_abi: true,
  location: null,
  ...over,
})

describe('compileStateChangeWarning — 세션 중 바뀐 사실', () => {
  it('BP-3 상태 바뀜 경고 — 실기기 A1 → F3 (reason profile-utilization → cmdline)', () => {
    const start = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT).lines
    const end = parseDexoptState(fixture('dumpsys-package-dexopt-restored.txt'), YT).lines
    const w = compileStateChangeWarning(start, end)

    expect(w?.code).toBe('compile_state_changed')
    expect(w?.message).toContain('status speed-profile → speed-profile')
    expect(w?.message).toContain('reason profile-utilization → cmdline')
    // 관측된 사건 — 평가 낱말 0.
    expect(copyViolations(w!.message)).toEqual([])
  })

  it('BP-3 상태 바뀜 경고 — 보조 dex 만 바뀌면 경고 0 (기준은 base.apk 줄)', () => {
    const start = [line({}), line({ path: '/data/user/0/x/pcam.jar', secondary_dex: true, status: 'verify' })]
    const end = [line({}), line({ path: '/data/user/0/x/pcam.jar', secondary_dex: true, status: 'run-from-apk' })]
    expect(compileStateChangeWarning(start, end)).toBeNull()
    expect(compileStateChangeWarning(start, [line({ status: 'speed' })])?.code).toBe('compile_state_changed')
  })

  it('BP-3 ABI 줄 여럿이면 primary-abi 줄로', () => {
    const start = [line({ abi: 'arm', primary_abi: false, status: 'verify' }), line({ abi: 'arm64' })]
    const sameOnPrimary = [line({ abi: 'arm', primary_abi: false, status: 'speed' }), line({ abi: 'arm64' })]
    expect(baseDexLine(start)?.abi).toBe('arm64')
    // primary 가 아닌 ABI 줄만 바뀌었다 — 경고 0.
    expect(compileStateChangeWarning(start, sameOnPrimary)).toBeNull()
    // primary 줄이 바뀌었다 — 경고.
    const changed = [line({ abi: 'arm', primary_abi: false, status: 'verify' }), line({ abi: 'arm64', reason: 'bg-dexopt' })]
    expect(compileStateChangeWarning(start, changed)?.code).toBe('compile_state_changed')
    // 여럿인데 primary 표시가 없으면 고르지 않는다 (순서로 고르지 않음) — 경고 0.
    const noPrimary = [line({ abi: 'arm', primary_abi: false }), line({ abi: 'arm64', primary_abi: false })]
    expect(baseDexLine(noPrimary)).toBeNull()
    expect(compileStateChangeWarning(noPrimary, [line({ status: 'speed' })])).toBeNull()
  })

  it('BP-3 null 이면 경고 없음 — 시작 · 끝 어느 쪽이든', () => {
    expect(compileStateChangeWarning(null, [line({})])).toBeNull()
    expect(compileStateChangeWarning([line({})], null)).toBeNull()
    expect(compileStateChangeWarning(undefined, [line({ status: 'speed' })])).toBeNull()
    expect(compileStateChangeWarning([line({})], [line({})])).toBeNull()
  })
})
