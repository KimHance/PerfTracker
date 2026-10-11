import { describe, expect, it } from 'vitest'
import { cpuCollector } from '../../src/collectors/cpu/index.js'
import { networkCollector } from '../../src/collectors/network/index.js'
import {
  COLLECTORS,
  collectSnapshotSpecs,
  collectTraceConfigBlocks,
  supportedCollectors,
  unsupportedReasons,
} from '../../src/collectors/registry.js'
import { hwuiCollector } from '../../src/collectors/hwui/index.js'
import { startupCollector } from '../../src/collectors/startup.js'
import { thermalCollector } from '../../src/collectors/thermal/index.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'
import { diagnoseFtraceBlock, FTRACE_POWER_BLOCK } from '../../src/collectors/blocks.js'
import { diagnoseScope } from '../../src/session/diagnose.js'

const OK = {
  sdkInt: 36,
  dataSources: [
    'linux.process_stats',
    'linux.sys_stats',
    'linux.ftrace',
    'android.log',
    'android.surfaceflinger.frametimeline',
  ],
}
const OLD = { sdkInt: 30, dataSources: [] }

describe('COLLECTORS 레지스트리', () => {
  it('id 가 유일하다 — result.json 의 metrics 키가 되기 때문이다', () => {
    const ids = COLLECTORS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('hwui 와 startup 이 등록되어 있다', () => {
    expect(COLLECTORS).toContain(hwuiCollector)
    expect(COLLECTORS).toContain(startupCollector)
  })

  it('thermal 과 network 가 등록되어 있다 — 배열에 없으면 extract 가 아예 부르지 않는다', () => {
    expect(COLLECTORS).toContain(thermalCollector)
    expect(COLLECTORS).toContain(networkCollector)
  })
})

describe('collectTraceConfigBlocks', () => {
  it('지원되는 collector 의 블록만 모은다', () => {
    expect(collectTraceConfigBlocks(OK)).toEqual(
      expect.arrayContaining(cpuCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })),
    )
    // startup 은 지원되지만 블록을 하나도 안 낸다 — 구형 기기에서는 config 가 빈다.
    expect(collectTraceConfigBlocks(OLD)).toEqual([])
  })

  it('모은 블록은 저부하 불변식을 통과한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) })).not.toThrow()
  })

  it('중복 데이터소스를 접는다 — 두 collector 가 같은 것을 요구해도 블록은 한 번만 나간다', () => {
    const one = cpuCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })
    const doubled = [...one, ...one]
    const config = buildTraceConfig({
      dataSourceBlocks: [...new Set(doubled)],
    })
    expect(config.split('linux.process_stats').length - 1).toBe(1)
  })

  it('두 collector 가 요구하는 linux.process_stats 가 한 번만 나간다', () => {
    const config = buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) })
    expect(config.split('name: "linux.process_stats"').length - 1).toBe(1)
    expect(config.split('name: "linux.sys_stats"').length - 1).toBe(1)
  })

  /**
   * D9. M3 는 데이터소스도 ftrace 이벤트도 늘리지 않는다. 이 단언이 깨진다는 것은
   * 누가 새 데이터소스를 켰다는 뜻이고, 그때 "그것을 읽는 collector 가 어디 있나" 라는
   * 질문이 반드시 따라와야 한다. 개수가 아니라 **이름 집합**으로 고정하는 이유는,
   * 개수만 세면 하나가 늘고 하나가 사라진 경우를 못 잡기 때문이다.
   *
   * M4 가 `android.surfaceflinger.frametimeline` 하나를 늘렸다 — 읽는 collector 는
   * `frame` 이다(`collectors/frame/index.ts`). 알고 늘린 것이라 집합에 그대로 반영한다.
   */
  it('M3 collector 들 + frame(M4) 이 늘린 데이터소스가 이 다섯 개뿐이다', () => {
    const names = collectTraceConfigBlocks(OK).map((b) => /name:\s*"([^"]+)"/.exec(b)?.[1])
    expect(new Set(names)).toEqual(
      new Set([
        'linux.process_stats',
        'linux.sys_stats',
        'linux.ftrace',
        'android.log',
        'android.surfaceflinger.frametimeline',
      ]),
    )
    expect(() =>
      buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) }),
    ).not.toThrow()
  })
})

describe('supportedCollectors / unsupportedReasons', () => {
  it('지원 여부로 거른다', () => {
    expect(supportedCollectors(OK)).toHaveLength(COLLECTORS.length)
    // startup 은 어디서나 지원된다 — 구형 기기에서도 목록이 비지 않는다.
    // thermal 은 sdk 29 하한이라 sdk 30 인 이 기기에서도 지원된다.
    // hwui 는 기기 성질로 막지 않는다 — 값이 안 나오는 것은 앱의 성질이라 extract 의 사유다.
    expect(supportedCollectors(OLD)).toEqual([hwuiCollector, startupCollector, thermalCollector])
  })

  it('sdk 28 기기에서는 thermal 이 미지원이고 사유가 Android 10 을 말한다', () => {
    const reasons = unsupportedReasons({ sdkInt: 28, dataSources: [] })
    expect(reasons.find((r) => r.startsWith('thermal:'))).toContain('Android 10')
  })

  it('sdk 29 기기에서 thermal 은 지원된다 — frame(31)이 안 되는 기기에서도', () => {
    const ids = supportedCollectors({ sdkInt: 29, dataSources: [] }).map((c) => c.id)
    expect(ids).toContain('thermal')
    expect(ids).not.toContain('frame')
  })

  it('sdk 33 기기에서 network 는 미지원이고 thermal 은 지원된다', () => {
    const env = { sdkInt: 33, dataSources: [] }
    const ids = supportedCollectors(env).map((c) => c.id)
    expect(ids).toContain('thermal')
    expect(ids).not.toContain('network')
    expect(unsupportedReasons(env).find((r) => r.startsWith('network:'))).toContain('Android 14')
  })

  it('미지원 항목만 사유와 함께 한국어로 낸다', () => {
    const reasons = unsupportedReasons(OLD)
    expect(reasons.length).toBe(COLLECTORS.length - supportedCollectors(OLD).length)
    expect(reasons.some((r) => r.startsWith('network:'))).toBe(true)
    expect(reasons.join('\n')).toContain('sdk_int=30')
    // 지원되는 항목은 "알 수 없음" 같은 잡음으로 목록을 채우지 않는다.
    expect(reasons.some((r) => r.startsWith('startup:'))).toBe(false)
  })

  it('전부 지원되면 사유가 하나도 없다', () => {
    expect(unsupportedReasons(OK)).toEqual([])
  })
})

describe('collectSnapshotSpecs', () => {
  /**
   * G4. 미지원 기기에 명령이 나가면 원칙 1 의 취지가 무너진다 —
   * 읽지 않을 데이터를 위해 기기를 건드리는 것이기 때문이다.
   */
  it('network 가 미지원인 기기에는 그 스냅샷 명령이 하나도 나가지 않는다', () => {
    expect(collectSnapshotSpecs({ sdkInt: 33, dataSources: [] })).toEqual([])
    expect(collectSnapshotSpecs({ sdkInt: 34, dataSources: [] }).map((s) => s.key)).toEqual([
      'netstats',
      'packages',
    ])
  })

  /**
   * D3. `dumpsys thermalservice` 는 `collectDeviceState()` 가 이미 찍는다. thermal collector 가
   * 그것을 다시 선언하면 같은 명령이 세션당 두 번 나가고, `mergeSnapshotSpecs` 가 던진다.
   */
  it('thermal 은 스냅샷을 하나도 선언하지 않는다 — 원문은 이미 찍히고 있다', () => {
    expect(collectSnapshotSpecs({ sdkInt: 33, dataSources: [] })).toEqual([])
    expect(collectSnapshotSpecs(OK).map((s) => s.key)).not.toContain('thermalservice')
  })
})

/**
 * DM-3. atrace 는 `linux.ftrace` 의 키라 별도 데이터소스로 낼 수 없고, 소스 하나 · 블록 하나
 * 규칙(`mergeTraceConfigBlocks`) 아래에서는 평소의 `FTRACE_POWER_BLOCK` 과 **같은 블록 안**에
 * 있어야 한다. 그래서 진단 세션은 그 블록을 같은 자리에서 진단 블록으로 바꾼다.
 */
describe('collectTraceConfigBlocks — 진단 세션 (DM-3)', () => {
  const PKG = 'com.google.android.youtube'
  const scope = diagnoseScope(PKG)
  const values = (text: string, key: string): string[] =>
    [...text.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, 'g'))].map((m) => m[1]!).sort()
  const NO_SYS_STATS = { sdkInt: 36, dataSources: ['linux.process_stats', 'android.surfaceflinger.frametimeline'] }

  it('DM-3 진단 config 범위 — 카테고리 정확히 {am, wm, view, dalvik} · 앱 slice 대상 하나 · ftrace_events 는 평소와 같은 집합', () => {
    for (const env of [OK, NO_SYS_STATS]) {
      const normal = buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(env) })
      const diag = buildTraceConfig({
        dataSourceBlocks: collectTraceConfigBlocks(env, scope),
        diagnose: { packageName: PKG },
      })

      expect(values(diag, 'atrace_categories')).toEqual(['am', 'dalvik', 'view', 'wm'])
      expect(values(diag, 'atrace_apps')).toEqual([PKG])
      expect(values(diag, 'ftrace_events')).toEqual(values(normal, 'ftrace_events'))
      expect(diag.split('name: "linux.ftrace"').length - 1).toBe(1)
    }
    // cpu 가 미지원인 기기 — 평소에 이벤트가 없으니 진단에도 없다. atrace 는 그래도 실린다.
    expect(values(buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(NO_SYS_STATS) }), 'ftrace_events')).toEqual([])
  })

  it('DM-3 진단 블록은 평소 ftrace 블록의 자리를 그대로 차지한다 — 다른 블록 순서 · 글자 그대로', () => {
    const normal = collectTraceConfigBlocks(OK)
    const diag = collectTraceConfigBlocks(OK, scope)
    expect(diag).toHaveLength(normal.length)
    expect(diag.map((b) => (b === diagnoseFtraceBlock(scope, true) ? FTRACE_POWER_BLOCK : b))).toEqual(normal)
  })

  it('DM-3 진단 블록의 이벤트 부분은 FTRACE_POWER_BLOCK 과 글자까지 같다', () => {
    expect(diagnoseFtraceBlock(scope, true).replace(/atrace_\w+: "[^"]*" /g, '')).toBe(FTRACE_POWER_BLOCK)
  })

  it('DM-3 평소 config 에 atrace 없음 — 어느 기기에서도 atrace 키 0개', () => {
    const envs = [OK, OLD, NO_SYS_STATS, { ...OK, sdkInt: 30 }, { ...OK, sdkInt: 33 }]
    for (const env of envs) {
      expect(collectTraceConfigBlocks(env).join('\n')).not.toMatch(/atrace_/)
      expect(collectTraceConfigBlocks(env, null)).toEqual(collectTraceConfigBlocks(env))
    }
  })
})
