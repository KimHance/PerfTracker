import type { AtraceScope } from '../collectors/blocks.js'
import { DIAGNOSE_COPY, fillCopy } from '../copy/diagnose.js'
import { DIAGNOSE_ATRACE_CATEGORIES } from '../perfetto/config.js'

/**
 * 진단 세션 — atrace slice 를 평소 측정과 **갈라서** 기록하는 세션 (기능 문서 diagnostic-mode).
 *
 * 이름이 `diagnostics/` 가 아닌 이유: 그 자리는 이미 `doctor` 다. 진단 세션은 세션의 한 종류라
 * `session/` 아래에 둔다 (brief 정하지 않은 것 12).
 *
 * 평소 세션과 섞지 않는 이유: slice 하나를 남기는 비용(~5µs)은 **앱 프로세스 자신**에게 청구되고
 * `measurement_overhead` 에 잡히지 않는다. 그래서 진단 세션의 수치는 평소 세션과 나란히 놓을 수
 * 없고, 그 사실이 세션 종류로 드러나야 한다.
 */

/** 이 세션이 켠 atrace 범위. 카테고리는 허용 목록 전부, 앱 slice 대상은 대상 앱 하나다 (DM-3). */
export function diagnoseScope(packageName: string): AtraceScope {
  return { categories: [...DIAGNOSE_ATRACE_CATEGORIES], apps: [packageName] }
}

/**
 * **진단 세션의 `--launch` 는 atrace 가 기기에서 켜진 뒤에 앱을 띄운다** (plan D14 — 실기기로 정함).
 * `am start -W` 와 같은 셸 호출 앞에 붙는 셸 조각이다.
 *
 * 왜 기다리나: `perfetto --detach` 는 세션을 연 즉시 돌아오고, atrace 를 켜는 일(traced_probes 가
 * `debug.atrace.*` 속성을 쓰는 것)은 그 뒤에 따로 일어난다. 그 사이에 fork 된 앱은 태그가 꺼진 채로
 * 시작해, 속성 변경 알림이 닿기 전의 slice 를 남기지 못한다. 실측(SM-S901N · YouTube, 기다림 없음)에서
 * 앱 slice 12,042개는 실렸는데 `bindApplication` 은 0개였다 — 그 안쪽 slice(`makeApplication` …)가
 * 깊이 0 으로 남아 바깥 slice 의 시작만 사라진 것이 보였다.
 *
 * 무엇을 보나: atrace 가 켜지면 태그(`enableflags`)와 앱 수(`app_number`)가 둘 다 0 이 아닌 값이 된다.
 * 쓰는 순서에 기대지 않으려고 **둘 다** 본다 — 둘 다 써진 뒤에 fork 되는 앱은 처음부터 태그가 켜져
 * 있다 (실측: 기다린 1회 `bindApplication` 1개 · 68.2 ms). **읽기만 한다** — 되돌리기 · 감시는
 * perfetto 몫이다 (plan D15).
 *
 * 상한 5초(0.1초 × 50). 넘으면 기다리지 않고 띄운다 — 세션을 막을 일이 아니다.
 * 이 조각은 진단 세션에만 붙는다. 평소 세션의 명령은 한 글자도 다르지 않다.
 */
export const ATRACE_READY_WAIT =
  'i=0; while [ $i -lt 50 ]; do ' +
  'f=$(getprop debug.atrace.tags.enableflags); n=$(getprop debug.atrace.app_number); ' +
  '[ -n "$f" ] && [ "$f" != 0 ] && [ -n "$n" ] && [ "$n" != 0 ] && break; ' +
  'sleep 0.1; i=$((i+1)); done; '

/**
 * 이 sdk 부터는 앱이 profileable 이 아니어도 `atrace_apps` 로 앱 slice 가 열린다.
 *
 * 근거: 문서(`profileable-element` — profileable 이 여는 Trace API 는 Android 11 이하 한정) ·
 * 실측 sdk 35 emulator · sdk 36 SM-S901N (profileable 이 아닌 YouTube 에서 15초 앱 slice
 * 23,762–26,479개, 2026-10-07). **sdk 31–34 는 실측이 없다** (기능 문서 열린 질문 2).
 */
export const APP_SLICE_MIN_SDK = 31

/**
 * 앱 slice 가 **실릴 수 있던 조건이었나**. 앱이 실제로 slice 를 남겼나가 아니다 —
 * 그것은 트레이스가 말하고, atrace 마커에 태그가 없어 프레임워크 slice 와 가를 수도 없다
 * (기능 문서 결정 8).
 *
 * `null` 은 "모른다" 다: sdk ≤30 에서 앱 slice 는 debuggable 또는 profileable 앱에만 열리는데
 * profileable 을 읽을 출처가 없다 (열린 질문 3). 여기서 `false` 를 내면 profileable 인 앱을 두고
 * "안 열렸다" 고 말하게 된다.
 */
export type AppSliceOpen = { open: true } | { open: null; debuggable: false | null }

/**
 * 조건 표(기능 문서 「앱 slice 가 열리는 조건」)를 그대로 옮긴 **단 하나의 판정**.
 * doctor(기기 줄) · start(고지 줄) · 화면 · extract 가 전부 이 함수를 부른다 (DM-10) —
 * 출처가 둘이면 doctor 가 "열림" 이라 한 기기에서 보고서가 "모름" 을 낼 수 있다.
 *
 * `debuggable` 은 `target_app.debuggable` 그대로다. 앱을 정하기 전(doctor)이면 `null` 을 준다.
 */
export function appSliceOpen(sdkInt: number, debuggable: boolean | null | undefined): AppSliceOpen {
  if (sdkInt >= APP_SLICE_MIN_SDK) return { open: true }
  if (debuggable === true) return { open: true }
  return { open: null, debuggable: debuggable === false ? false : null }
}

/**
 * `start --diagnose` 의 고지 줄. 조건 표의 "모름" 칸일 때만 문구가 있고, 열리면 `null` 이다.
 * **세션은 막지 않는다** — 프레임워크 slice(am · wm · view · dalvik)는 그대로 실린다.
 */
export function diagnoseNotice(sdkInt: number, debuggable: boolean | null | undefined): string | null {
  const verdict = appSliceOpen(sdkInt, debuggable)
  if (verdict.open === true) return null
  const template =
    verdict.debuggable === false ? DIAGNOSE_COPY.noticeNotDebuggable : DIAGNOSE_COPY.noticeDebuggableUnknown
  return fillCopy(template, { sdk: sdkInt })
}
