import { COMPILE_REPORT_COPY } from './compile-copy.js'
import { DIAGNOSE_REPORT_COPY, fillReportCopy } from './diagnose-copy.js'
import { fmtValue, fmtWhen } from './format.js'
import { KNOWN_METRICS, MANIFEST, NOT_DRAWN_METRICS, SCHEMA_MAJOR, type TabId, TABS } from './manifest.js'
import { READABILITY_COPY } from './readability-copy.js'
import { MISSING, readPath } from './read.js'

/**
 * 헤더 · 푸터. 전부 순수 함수다.
 *
 * **요약 플래그 줄은 없다.** 한때 `debuggable` · `미수집` · `경고` 를 알약으로 늘어놓았는데,
 * 그 사실들은 전부 **화면 안에 이미 제자리가 있었다** — 같은 것을 두 번 말하면 둘 중 하나는
 * 언젠가 낡는다. 지금 각각은 이렇게 닿는다:
 *
 * | 사실 | 어디에 |
 * | --- | --- |
 * | 경고(`warnings[]`) | 맥락 섹션의 블록 — 데이터라서 매니페스트가 그린다 |
 * | `debuggable` | 기기 탭의 앱 표 |
 * | 미수집 지표 | 카드마다 상태 배지 + 레일의 탭 개수 |
 * | 주사율 `null` | 기기 탭의 화면 표 |
 * | 매니페스트에 없는 지표 | 푸터 |
 * | 스키마 메이저 불일치 | 푸터 (`schema_version` 이 이미 거기 있다) |
 * | 진단 세션 | 상태 pill 옆 `진단` pill + 레일의 `진단` 탭 — 세션의 종류라 플래그가 아니다 |
 */

/**
 * **진단 세션인가.** 기준은 `session.options.diagnose === true` 하나다 — core 가 진단 세션에만
 * `true` 로 싣고(`false` 로 싣는 일은 없다) 기록 목록 · 측정 화면도 같은 칸을 본다. 진단 블록의
 * 유무로 가르지 않는다: 같은 사실을 두 칸이 말하면 둘이 갈리는 날 화면마다 답이 달라진다.
 *
 * 평소 세션 · 옛 문서는 키가 없고, 그 "없음" 이 곧 진단 세션이 아니라는 뜻이다 (README).
 */
export function isDiagnoseSession(res: unknown): boolean {
  return readPath(res, 'session.options.diagnose') === true
}

/** 레일에 세울 탭. `진단` 은 진단 세션에만 — 평소 보고서는 탭이 둘 그대로다. */
export function tabsFor(res: unknown): { id: TabId; label: string }[] {
  const diagnose = isDiagnoseSession(res)
  return TABS.filter((t) => t.onlyDiagnose !== true || diagnose).map(({ id, label }) => ({ id, label }))
}

export interface HeaderVm {
  id: string
  name: string
  stateLabel: string
  running: boolean
  /** 상태 pill 옆 pill. 진단 세션이 아니면 `null` 이고 아무것도 그리지 않는다. */
  diagnosePill: string | null
  meta: { k: string; v: string }[]
  /** 이 화면이 아는 스키마 메이저와 파일이 다른가. 값이 아니라 화면의 한계다. */
  schemaMismatch: boolean
  footerTool: string
  footerSchema: string
  footerIgnored: string
  /** 매니페스트에 없어서 안 그린 지표. 조용히 버리면 새 지표가 생겨도 아무도 모른다. */
  ignored: string[]
}

/**
 * 머리 `옵션` 칸 — `--launch` 또는 `attach`, `--compile` 세션이면 뒤에 `--compile <값>` (baseline-profile BP-8 ·
 * 결정 16). 기준은 `session.options.compile` 이 문자열인가 하나 — 바꾼 기록(`session.compile`)의 유무로 가르지
 * 않는다 (옵션은 사람이 준 것 · 기록은 기기가 한 것).
 */
function optionsLine(res: unknown): string {
  const head = readPath(res, 'session.options.launch') === true ? '--launch' : 'attach'
  const compile = readPath(res, 'session.options.compile')
  return typeof compile === 'string'
    ? `${head} ${fillReportCopy(COMPILE_REPORT_COPY.headOption, { value: compile })}`
    : head
}

export function buildHeader(res: unknown): HeaderVm {
  const metricsObj = readPath(res, 'metrics')
  const presentKeys =
    metricsObj === MISSING || metricsObj === null || typeof metricsObj !== 'object'
      ? []
      : Object.keys(metricsObj)

  // 매니페스트가 그리는 것 + **일부러 안 그리기로 한 것**. 후자를 빼지 않으면 이유가 있어
  // 뺀 지표가 매번 경고로 뜨고, 그러면 진짜 신호(아무도 안 넣은 새 지표)가 묻힌다.
  const accounted = new Set([
    ...MANIFEST.map((b) => b.metric).filter((x) => x !== undefined),
    ...NOT_DRAWN_METRICS,
  ])
  const ignored = presentKeys.filter((k) => !accounted.has(k as (typeof KNOWN_METRICS)[number]))

  // 스키마 메이저가 다르면 이 화면이 필드를 잘못 읽을 수 있다. 값이 아니라 **이 화면의
  // 한계**라서 데이터 블록이 아니라 푸터에 적는다.
  const schemaVer = readPath(res, 'schema_version')
  const major = typeof schemaVer === 'string' ? Number(schemaVer.split('.')[0]) : null
  const schemaMismatch = major !== null && major !== SCHEMA_MAJOR

  const state = readPath(res, 'session.state')
  const running = state === 'running'
  const dur = readPath(res, 'session.duration_ms')

  const meta = [
    {
      k: '앱',
      v: [
        fmtValue(readPath(res, 'target_app.label'), 'raw'),
        fmtValue(readPath(res, 'target_app.package'), 'raw'),
        fmtValue(readPath(res, 'target_app.version_name'), 'raw'),
      ].join(' · '),
    },
    {
      k: '기기',
      v:
        `${fmtValue(readPath(res, 'device.static.model'), 'raw')} · ` +
        `${fmtValue(readPath(res, 'device.serial'), 'raw')} · ` +
        `Android ${fmtValue(readPath(res, 'device.static.android_release'), 'raw')} ` +
        `(sdk ${fmtValue(readPath(res, 'device.static.sdk_int'), 'int')})`,
    },
    { k: '시작', v: fmtWhen(readPath(res, 'session.started_at')) },
    // 측정 중이면 길이가 없다. 0 이 아니고, "세션 길이" 라고 부르지도 않는다. 라벨은 우리말 — 영어 필드
    // 이름(`duration`)을 머리에 쓰지 않는다 (RR-6 · HANDOFF 와 같은 `길이`).
    { k: READABILITY_COPY.headDuration, v: running ? '측정 중' : fmtValue(dur, 'ms0') },
    { k: '옵션', v: optionsLine(res) },
  ]

  return {
    id: fmtValue(readPath(res, 'session.id'), 'raw'),
    name: fmtValue(readPath(res, 'session.name'), 'raw'),
    stateLabel: running ? '측정 중' : fmtValue(state, 'raw'),
    running,
    diagnosePill: isDiagnoseSession(res) ? DIAGNOSE_REPORT_COPY.headPill : null,
    meta,
    schemaMismatch,
    footerTool:
      `${fmtValue(readPath(res, 'tool.name'), 'raw')} ${fmtValue(readPath(res, 'tool.version'), 'raw')}` +
      ` · ${fmtValue(readPath(res, 'tool.host.os'), 'raw')}/${fmtValue(readPath(res, 'tool.host.arch'), 'raw')}` +
      ` · node ${fmtValue(readPath(res, 'tool.host.node'), 'raw')}`,
    footerSchema: `schema_version ${fmtValue(schemaVer, 'raw')}`,
    footerIgnored:
      ignored.length === 0 ? '' : `무시한 지표 ${ignored.length}개: ${ignored.join(', ')}`,
    ignored,
  }
}
