import { fmtValue, fmtWhen } from './format.js'
import { KNOWN_METRICS, MANIFEST, NOT_DRAWN_METRICS, SCHEMA_MAJOR } from './manifest.js'
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
 */

export interface HeaderVm {
  id: string
  name: string
  stateLabel: string
  running: boolean
  meta: { k: string; v: string }[]
  /** 이 화면이 아는 스키마 메이저와 파일이 다른가. 값이 아니라 화면의 한계다. */
  schemaMismatch: boolean
  footerTool: string
  footerSchema: string
  footerIgnored: string
  /** 매니페스트에 없어서 안 그린 지표. 조용히 버리면 새 지표가 생겨도 아무도 모른다. */
  ignored: string[]
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
    // 측정 중이면 길이가 없다. 0 이 아니고, "세션 길이" 라고 부르지도 않는다.
    { k: 'duration', v: running ? '측정 중' : fmtValue(dur, 'ms0') },
    { k: '옵션', v: readPath(res, 'session.options.launch') === true ? '--launch' : 'attach' },
  ]

  return {
    id: fmtValue(readPath(res, 'session.id'), 'raw'),
    name: fmtValue(readPath(res, 'session.name'), 'raw'),
    stateLabel: running ? '측정 중' : fmtValue(state, 'raw'),
    running,
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
