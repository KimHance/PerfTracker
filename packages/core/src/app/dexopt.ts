import type { AdbClient } from '../adb/client.js'
import { shellQuote } from '../adb/shell.js'
import { type MetricReason, renderReason } from '../schema/reasons.js'
import type { DexoptLine, TargetApp, Warning } from '../schema/result.js'

/**
 * `dumpsys package <pkg>` 의 `Dexopt state` 절 — 앱이 **어떤 컴파일 상태로 돌았나**(기능 문서 BP-1).
 *
 * 실측 꼴은 하나뿐이다 (SM-S901N · sdk 36 · YouTube 21.40.161):
 * ```
 * Dexopt state:
 *   [com.google.android.youtube]
 *     path: /data/app/~~…/base.apk
 *       arm64: [status=speed-profile] [reason=profile-utilization] [primary-abi]
 *         [location is /data/app/~~…/oat/arm64/base.odex]
 *     known secondary dex files:
 *       /data/user/0/com.google.android.youtube/app_pccache2/5/…/pcam.jar
 *         arm64: [status=verify] [reason=vdex] [primary-abi]
 *           [location is /data/user/0/…/oat/arm64/pcam.vdex]
 *         class loader context: PCL[];PCL[…]
 * ```
 * **형식을 추측하지 않는다** (결정 12). 위 꼴 밖의 줄이 하나라도 있으면 상태 전체가 null 이고
 * `dexopt_state_unparsable` 이 그 줄을 남긴다 — 모르는 줄을 건너뛰면 그 줄이 무엇을 말했는지
 * 모른 채 "이것이 전부" 라고 내보내게 된다.
 *
 * `status` · `reason` · `location` 은 **원문 문자열 그대로**다 (결정 2). 문서 표에 없는 값
 * (`profile-utilization` · `vdex-dm` · `run-from-apk` · `unknown`)이 실측됐고, enum 으로 좁히면
 * 다음 기기의 값이 거부된다. `location` 은 `[location is ` 뒤 문자열 전부 — `error` 도,
 * 공백 든 문장(`primary.vdex mapped directly in memory from …/base.dm`)도 그대로.
 *
 * 같은 출력의 다른 절(`HeimdAllFS state` 등)에도 `[<pkg>]` · `path:` 줄이 있다. 절의 끝은
 * **0칸 들여쓴 다음 줄**이고, 그 뒤는 보지 않는다.
 */
export type DexoptRead = { lines: DexoptLine[]; reason: null } | { lines: null; reason: MetricReason }

const SECTION = 'Dexopt state:'
const SECONDARY_HEAD = 'known secondary dex files:'
const ABI_LINE = /^(\S+): \[status=([^\]]*)\] \[reason=([^\]]*)\]( \[primary-abi\])?$/
const LOCATION_LINE = /^\[location is (.*)\]$/
const CLASS_LOADER_CONTEXT = /^class loader context: /

const indent = (line: string): number => line.length - line.trimStart().length

function unparsable(line: string | null): DexoptRead {
  return { lines: null, reason: { code: 'dexopt_state_unparsable', detail: { line } } }
}

export function parseDexoptState(text: string, pkg: string): DexoptRead {
  const all = text.split(/\r?\n/)
  const head = all.findIndex((l) => l.trimEnd() === SECTION)
  if (head < 0) return { lines: null, reason: { code: 'dexopt_state_section_missing' } }

  const section: string[] = []
  for (const line of all.slice(head + 1)) {
    if (line.trim() !== '' && indent(line) === 0) break
    section.push(line)
  }

  const at = section.findIndex((l) => l.trim() === `[${pkg}]`)
  if (at < 0) return { lines: null, reason: { code: 'dexopt_state_package_missing', detail: { package: pkg } } }

  // 패키지 블록 = 머리보다 깊게 들여쓴 줄들. 같은 깊이의 다음 줄이 다음 패키지다.
  const pkgIndent = indent(section[at]!)
  const block: string[] = []
  for (const line of section.slice(at + 1)) {
    if (line.trim() !== '' && indent(line) <= pkgIndent) break
    block.push(line)
  }

  const lines: DexoptLine[] = []
  let dex: { path: string; secondary: boolean } | null = null
  let secondary = false
  for (const raw of block) {
    const line = raw.trim()
    if (line === '') continue

    if (line.startsWith('path: ') && !secondary) {
      dex = { path: line.slice('path: '.length), secondary: false }
      continue
    }
    if (line === SECONDARY_HEAD) {
      secondary = true
      dex = null
      continue
    }
    if (secondary && line.startsWith('/')) {
      dex = { path: line, secondary: true }
      continue
    }
    const abi = ABI_LINE.exec(line)
    if (abi !== null && dex !== null) {
      lines.push({
        path: dex.path,
        secondary_dex: dex.secondary,
        abi: abi[1]!,
        status: abi[2]!,
        reason: abi[3]!,
        primary_abi: abi[4] !== undefined,
        location: null,
      })
      continue
    }
    const location = LOCATION_LINE.exec(line)
    const last = lines.at(-1)
    if (location !== null && last !== undefined && last.location === null && dex?.path === last.path) {
      last.location = location[1]!
      continue
    }
    if (secondary && dex !== null && CLASS_LOADER_CONTEXT.test(line)) continue

    return unparsable(raw)
  }

  // 패키지 줄은 있는데 dex 줄이 하나도 없다 — "dex 가 없다" 인지 꼴이 다른지 가를 수 없다.
  if (lines.length === 0) return unparsable(null)
  return { lines, reason: null }
}

/** 기기에서 읽지 못했을 때. `cause` 가 문장을 가른다 (`renderReason`). */
export function dexoptUnavailable(
  phase: 'start' | 'end',
  cause: 'command_failed' | 'session_running' | 'not_recorded',
  exitCode?: number,
): DexoptRead {
  return {
    lines: null,
    reason: {
      code: 'dexopt_state_unavailable',
      detail: { phase, cause, ...(exitCode !== undefined ? { exit_code: exitCode } : {}) },
    },
  }
}

/** 시작 · 끝 상태의 `target_app` 칸 셋. 못 읽었으면 칸은 null 이고 코드 · 문장이 함께 실린다. */
export function compileStateFields(phase: 'start' | 'end', read: DexoptRead): Partial<TargetApp> {
  const code = read.reason?.code ?? null
  const text = renderReason(read.reason)
  return phase === 'start'
    ? { compile_state_start: read.lines, compile_state_start_reason_code: code, compile_state_start_reason: text }
    : { compile_state_end: read.lines, compile_state_end_reason_code: code, compile_state_end_reason: text }
}

/**
 * 끝 상태 — `stop` 이 측정 창을 닫고 원본을 회수한 **뒤** 한 번 (BP-1). 시작 상태는 이 명령을
 * 따로 보내지 않는다: `getAppDetail` 이 이미 보내는 같은 `dumpsys package` 출력에서 읽는다.
 *
 * 던지지 않는다 — 이 줄은 트레이스를 회수 · 삭제한 뒤에 나가므로, 여기서 던지면 정본을 지운 채
 * stop 이 실패한다. 못 읽으면 null + `dexopt_state_unavailable` 이다.
 */
export async function readDexoptState(adb: AdbClient, pkg: string): Promise<DexoptRead> {
  try {
    const r = await adb.raw(['shell', `dumpsys package ${shellQuote(pkg)}`])
    return r.code === 0 ? parseDexoptState(r.stdout, pkg) : dexoptUnavailable('end', 'command_failed', r.code)
  } catch {
    return dexoptUnavailable('end', 'command_failed')
  }
}

/**
 * 비교 · 되돌림의 기준 줄 — base.apk 의 dex 줄 (결정 12). 경로가 `/base.apk` 로 끝나는 비보조 dex 이고,
 * 그 dex 에 ABI 줄이 여럿이면 `[primary-abi]` 가 붙은 줄이다. 그 줄을 하나로 못 고르면 null —
 * 순서로 고르지 않는다.
 */
export function baseDexLine(lines: readonly DexoptLine[] | null | undefined): DexoptLine | null {
  if (lines == null) return null
  const base = lines.filter((l) => !l.secondary_dex && l.path.endsWith('/base.apk'))
  const path = base[0]?.path
  const same = base.filter((l) => l.path === path)
  if (same.length === 1) return same[0]!
  const primary = same.filter((l) => l.primary_abi)
  return primary.length === 1 ? primary[0]! : null
}

/**
 * 세션 중 base.apk 줄의 `status` 또는 `reason` 문자열이 달라졌다는 **사실** (BP-3). 어느 쪽이 낫다는
 * 말은 없다 — 두 문자열을 그대로 옮긴다. 어느 쪽이든 기준 줄을 못 고르면 경고 0.
 */
export function compileStateChangeWarning(
  start: readonly DexoptLine[] | null | undefined,
  end: readonly DexoptLine[] | null | undefined,
): Warning | null {
  const a = baseDexLine(start)
  const b = baseDexLine(end)
  if (a === null || b === null) return null
  if (a.status === b.status && a.reason === b.reason) return null
  return {
    code: 'compile_state_changed',
    message:
      `세션 중 base.apk 컴파일 상태가 바뀌었음 — status ${a.status} → ${b.status} · ` +
      `reason ${a.reason} → ${b.reason} (target_app.compile_state_start · compile_state_end)`,
  }
}
