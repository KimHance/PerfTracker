import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APP_UID_STATS_HEADER,
  networkCollector,
  parseAppUidStats,
  parsePackageUids,
} from '../../src/collectors/network.js'
import type { BaseExtractContext, ExtractOutcome } from '../../src/collectors/types.js'
import type { MetricReason } from '../../src/schema/reasons.js'
import type { NetworkData } from '../../src/schema/result.js'

/**
 * 픽스처는 에뮬레이터(sdk_gphone64_arm64 / API 35)의 `dumpsys netstats`(플래그 없음) 출력의
 * 절 순서·들여쓰기·머리글을 그대로 옮기고 숫자와 uid 만 합성한 것이다.
 * 이 파서가 넘어질 수 있는 지점은 전부 그 구조에 있다 — 그래서 미끼 셋이 픽스처에 있다:
 *   1. `BPF map status:` 절의 `mAppUidStatsMap: OK` (내용 절이 아니다)
 *   2. `BPF map content:` 라는 머리가 두 번 (`InterfaceMapHelper:` 아래에 하나)
 *   3. 인접 표(`mStatsMapB` / `mIfaceStatsMap`)의 같은 모양 숫자 행 + 중복 uid 행
 */
const read = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), 'utf8')

const NETSTATS = read('dumpsys-netstats.txt')
const PACKAGES = read('pm-list-packages-u.txt')

/** before 대비 rx +5,000 / tx +1,000 / 패킷 +10, +5. 중복 행이라 `replaceAll` 이어야 한다. */
const NETSTATS_AFTER = NETSTATS.replaceAll(
  '10388 1200000 1119 431000 871',
  '10388 1205000 1129 432000 876',
)

describe('parseAppUidStats', () => {
  it('mAppUidStatsMap 절의 행을 uid 로 읽는다', () => {
    const d = parseAppUidStats(NETSTATS)
    expect(d.found).toBe(true)
    expect(d.header).toBe(APP_UID_STATS_HEADER)
    expect(d.byUid.get(10388)).toEqual({
      uid: 10388,
      rxBytes: 1_200_000,
      rxPackets: 1119,
      txBytes: 431_000,
      txPackets: 871,
    })
  })

  /** 미끼 1. `BPF map status:` 절에 `mAppUidStatsMap: OK` 가 먼저 나온다. */
  it('`mAppUidStatsMap: OK` 상태 줄에 앵커를 걸지 않는다', () => {
    expect(parseAppUidStats(NETSTATS).byUid.size).toBeGreaterThan(0)
  })

  /** 미끼 2. `BPF map content:` 머리가 두 번 나온다 (InterfaceMapHelper 아래에 하나). */
  it('InterfaceMapHelper 의 IfaceIndexNameMap 을 읽어 오지 않는다', () => {
    expect([...parseAppUidStats(NETSTATS).byUid.keys()]).not.toContain(15)
  })

  /** 미끼 3. 절의 끝을 못 잡으면 뒤따르는 표의 행이 섞인다. */
  it('다음 절(mStatsMapA)에서 멈춘다 — 인접한 표의 행을 먹지 않는다', () => {
    const uids = [...parseAppUidStats(NETSTATS).byUid.keys()].sort((a, b) => a - b)
    expect(uids).toEqual([1000, 1051, 10134, 10388])
  })

  /**
   * 미끼 3 의 **진짜** 계약을 여기서 못박는다.
   *
   * 계획서는 "인접 표(`mStatsMapB` / `mIfaceStatsMap`)에도 같은 5열 숫자 행이 있다" 고 썼는데
   * **사실이 아니다.** 두 표의 행은 전부 두 번째 열이 인터페이스 이름(`lo` / `wlan0`)이라
   * 5열 숫자 행이 아니다. 그래서 절의 끝을 안 잡아도(= `break` 를 `continue` 로 바꿔도)
   * 커밋된 픽스처만으로는 **한 건도 실패하지 않는다** — 위의 단언이 그대로 통과한다.
   * (실제로 확인했다: 그 변형에서 30개 테스트가 전부 그린이었다.)
   *
   * 아직 원문을 본 적 없는 실기기(sdk 36)의 이 절 아래에 무엇이 있을지 모르므로,
   * 픽스처의 우연에 기대지 않고 계약 자체를 직접 겨눈다.
   */
  it('절이 끝난 뒤에 나오는 5열 숫자 행은 먹지 않는다', () => {
    const text = NETSTATS.replace(
      '    1 lo 408126 8104 408126 8104\n',
      '    1 lo 408126 8104 408126 8104\n    99999 1 2 3 4\n',
    )
    expect([...parseAppUidStats(text).byUid.keys()]).not.toContain(99999)
  })

  it('같은 uid 가 같은 값으로 두 번 나오면 충돌로 치지 않는다', () => {
    expect(parseAppUidStats(NETSTATS).conflictingUids).toEqual([])
  })

  it('같은 uid 가 다른 값으로 두 번 나오면 마지막을 쓰고 그 사실을 남긴다', () => {
    const text = NETSTATS.replace(
      '    10388 1200000 1119 431000 871\n    1000',
      '    10388 999 9 99 9\n    1000',
    )
    const d = parseAppUidStats(text)
    expect(d.conflictingUids).toEqual([10388])
    expect(d.byUid.get(10388)?.rxBytes).toBe(1_200_000)
  })

  /**
   * G1 의 실행. AOSP 의 `StatsMapValue` 자바 필드 순서는 `rxPackets, rxBytes, txPackets,
   * txBytes` 로 **덤프 헤더와 다르다.** 헤더에 고정하지 않으면 파서가 조용히 바이트와
   * 패킷을 뒤바꾼 채 통과할 수 있다. 실기기(sdk 36) 원문은 아직 본 적이 없다.
   */
  it('헤더가 기대와 다르면 행을 읽지 않고 원문 줄을 남긴다 — 컬럼 순서를 추측하지 않는다', () => {
    const text = NETSTATS.replace(
      'uid rxBytes rxPackets txBytes txPackets',
      'uid rxPackets rxBytes txPackets txBytes',
    )
    const d = parseAppUidStats(text)
    expect(d.found).toBe(true)
    expect(d.byUid.size).toBe(0)
    expect(d.header).toBe('uid rxPackets rxBytes txPackets txBytes')
  })

  it('절 자체가 없으면 found=false 다 (Android 13 이하의 출력)', () => {
    const d = parseAppUidStats('Active interfaces:\n  iface=wlan0\n')
    expect(d.found).toBe(false)
    expect(d.header).toBeNull()
  })

  it('절은 있는데 행이 없으면 found=true / 빈 맵이다 — 없는 것과 비어 있는 것은 다르다', () => {
    const d = parseAppUidStats(
      'BPF map content:\n  mAppUidStatsMap:\n    uid rxBytes rxPackets txBytes txPackets\n  mStatsMapA:\n',
    )
    expect(d.found).toBe(true)
    expect(d.byUid.size).toBe(0)
    expect(d.header).toBe(APP_UID_STATS_HEADER)
  })
})

describe('parsePackageUids', () => {
  it('같은 uid 를 쓰는 패키지를 전부 모은다 (시스템 포함)', () => {
    expect(parsePackageUids(PACKAGES, 10388)).toEqual([
      'com.nhn.android.webtoon',
      'com.example.sibling',
    ])
    expect(parsePackageUids(PACKAGES, 1000)).toHaveLength(2)
  })

  it('그 uid 를 쓰는 패키지가 없으면 빈 배열 — null 이 아니다', () => {
    expect(parsePackageUids(PACKAGES, 99999)).toEqual([])
  })

  /** uid 는 접두 일치로 읽으면 안 된다 — 1000 과 10001 은 다른 uid 다. */
  it('uid 를 접두 일치로 읽지 않는다', () => {
    expect(parsePackageUids('package:com.a uid:100388\n', 10388)).toEqual([])
  })
})

function ctx(over: Partial<BaseExtractContext> = {}): BaseExtractContext {
  return {
    packageName: 'com.nhn.android.webtoon',
    appUid: 10388,
    env: { sdkInt: 36, dataSources: [] },
    capture: {
      startup: null,
      launchRequested: false,
      appPid: null,
      snapshots: {
        netstats: { before: NETSTATS, after: NETSTATS_AFTER },
        packages: { before: PACKAGES, after: PACKAGES },
      },
    },
    ...over,
  }
}

/** 스냅샷만 갈아 끼운 컨텍스트. `capture` 의 나머지 필드를 매번 되풀이하지 않기 위한 것. */
function withSnapshots(
  snapshots: Record<string, { before: string | null; after: string | null }>,
): BaseExtractContext {
  return ctx({ capture: { ...ctx().capture, snapshots } })
}

/** 판별 유니온을 좁힌다 — 실패하면 실제로 무엇이 나왔는지 그대로 보여준다. */
function collected(out: ExtractOutcome<NetworkData>): {
  data: NetworkData
  partialReason?: MetricReason
} {
  if (!out.collected) throw new Error(`collected 가 아니다: ${JSON.stringify(out)}`)
  return out
}

describe('networkCollector.supports', () => {
  it('sdk 34 이상이면 지원한다 — mAppUidStatsMap 절은 Android 14 부터 dumpsys netstats 에 찍힌다', () => {
    expect(networkCollector.supports({ sdkInt: 34, dataSources: [] })).toEqual({ supported: true })
  })

  it('sdk 33 이하는 sdk_too_low 다 — 그 아래는 명령 자체가 다르고 M3 는 분기하지 않는다', () => {
    expect(networkCollector.supports({ sdkInt: 33, dataSources: [] })).toEqual({
      supported: false,
      reason: { code: 'sdk_too_low', detail: { sdk_int: 33, min_sdk: 34 } },
    })
  })

  it('--uid 를 주지 않는다 — 쓰지 않을 2시간 버킷 히스토리만 붙는다', () => {
    const commands = networkCollector.captureSnapshots?.().map((s) => s.command) ?? []
    expect(commands).toEqual(['dumpsys netstats', 'pm list packages -U'])
    expect(commands.join(' ')).not.toContain('--uid')
  })

  it('트레이스 설정을 하나도 만들지 않는다', () => {
    expect(networkCollector.traceConfigBlocks()).toEqual([])
    expect(networkCollector.needsTrace).toBe(false)
  })
})

describe('networkCollector.extract', () => {
  it('전/후 누적 카운터의 차이를 낸다', async () => {
    const out = await networkCollector.extract(ctx())
    expect(out).toEqual({
      collected: true,
      data: {
        uid: 10388,
        rx_bytes: 5000,
        tx_bytes: 1000,
        rx_packets: 10,
        tx_packets: 5,
        shared_uid_packages: ['com.nhn.android.webtoon', 'com.example.sibling'],
      },
    })
  })

  /** 조회했고 변화가 없었다. 이 0 은 정직한 0 이다 (G2 의 반대편). */
  it('트래픽이 없으면 0 을 collected 로 낸다 — 조회한 0 과 못 본 0 은 다르다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after: NETSTATS },
        packages: { before: PACKAGES, after: PACKAGES },
      }),
    )
    expect(out).toMatchObject({ collected: true, data: { rx_bytes: 0, tx_bytes: 0 } })
  })

  it('uid 를 모르면 값을 내지 않는다', async () => {
    expect(await networkCollector.extract(ctx({ appUid: null }))).toEqual({
      collected: false,
      reason: { code: 'app_uid_unknown', detail: { package: 'com.nhn.android.webtoon' } },
    })
  })

  /** M3 이전에 찍힌 run 을 재산출하는 경로. 반드시 지나간다. */
  it('netstats 스냅샷이 없으면 snapshot_unavailable 이다 — 0 이 아니다', async () => {
    expect(await networkCollector.extract(withSnapshots({}))).toEqual({
      collected: false,
      reason: { code: 'snapshot_unavailable', detail: { key: 'netstats', phase: 'before' } },
    })
  })

  /**
   * D5. 누적 카운터 한쪽만으로는 **부팅 이후 총량**밖에 안 나오고 그건 이 메트릭이 아니다.
   * Thermal 과 달리 부분값을 내지 않는 이유가 이것이다.
   */
  it('after 스냅샷이 없으면 부분값도 내지 않는다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: NETSTATS, after: null } }),
    )
    expect(out).toEqual({
      collected: false,
      reason: { code: 'snapshot_unavailable', detail: { key: 'netstats', phase: 'after' } },
    })
  })

  it('헤더가 기대와 다르면 snapshot_unparsable 이고 detail 에 그 줄이 있다', async () => {
    const bad = NETSTATS.replace(
      'uid rxBytes rxPackets txBytes txPackets',
      'uid rxPackets rxBytes txPackets txBytes',
    )
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: bad, after: NETSTATS_AFTER } }),
    )
    expect(out).toMatchObject({
      collected: false,
      reason: {
        code: 'snapshot_unparsable',
        detail: {
          key: 'netstats',
          section: 'mAppUidStatsMap',
          phase: 'before',
          header: 'uid rxPackets rxBytes txPackets txBytes',
        },
      },
    })
  })

  it('절 자체가 없으면(구버전 출력) snapshot_unparsable 이다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: 'Active interfaces:\n', after: NETSTATS_AFTER } }),
    )
    expect(out).toMatchObject({ collected: false, reason: { code: 'snapshot_unparsable' } })
  })

  /** 종료 스냅샷만 형식이 다른 경우도 phase 로 구분된다 — 어느 쪽을 못 읽었는지가 사실이다. */
  it('after 쪽 형식이 다르면 phase 가 after 다', async () => {
    const bad = NETSTATS_AFTER.replace(
      'uid rxBytes rxPackets txBytes txPackets',
      'uid rxPackets rxBytes txPackets txBytes',
    )
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: NETSTATS, after: bad } }),
    )
    expect(out).toMatchObject({
      collected: false,
      reason: { code: 'snapshot_unparsable', detail: { phase: 'after' } },
    })
  })

  it('그 uid 의 행이 없으면 0 이 아니라 uid_not_in_netstats 다', async () => {
    expect(await networkCollector.extract(ctx({ appUid: 12345 }))).toEqual({
      collected: false,
      reason: {
        code: 'uid_not_in_netstats',
        detail: { uid: 12345, in_before: false, in_after: false },
      },
    })
  })

  it('카운터가 되감기면 값을 내지 않고 두 값을 사유에 남긴다', async () => {
    const after = NETSTATS.replaceAll('10388 1200000 1119 431000 871', '10388 900 9 100 1')
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after },
        packages: { before: PACKAGES, after: PACKAGES },
      }),
    )
    expect(out).toMatchObject({
      collected: false,
      reason: {
        code: 'counter_went_backwards',
        detail: { counter: 'rx_bytes', before: 1_200_000, after: 900 },
      },
    })
  })

  it('중복 행이 값을 달리하면 값은 내되 netstats_uid_duplicated 를 단다', async () => {
    const before = NETSTATS.replace(
      '    10388 1200000 1119 431000 871\n    1000',
      '    10388 999 9 99 9\n    1000',
    )
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before, after: NETSTATS_AFTER },
        packages: { before: PACKAGES, after: PACKAGES },
      }),
    )
    expect(out.collected).toBe(true)
    expect(collected(out).partialReason).toEqual({
      code: 'netstats_uid_duplicated',
      detail: { uid: 10388, phase: 'before' },
    })
  })

  /** 다른 uid 의 중복은 이 메트릭과 무관하다 — 남의 사유를 우리 결과에 달지 않는다. */
  it('다른 uid 의 중복은 사유로 달지 않는다', async () => {
    const before = NETSTATS.replace(
      '    10134 59692 187 28550 187\n',
      '    10134 59692 187 28550 187\n    10134 1 1 1 1\n',
    )
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before, after: NETSTATS_AFTER },
        packages: { before: PACKAGES, after: PACKAGES },
      }),
    )
    expect(collected(out).partialReason).toBeUndefined()
  })

  /** G2. 조회 못 한 것을 [] 로 내면 "이 앱만 이 uid 를 쓴다" 는 없던 사실이 된다. */
  it('packages 스냅샷이 없으면 shared_uid_packages 는 [] 가 아니라 null 이다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: NETSTATS, after: NETSTATS_AFTER } }),
    )
    expect(collected(out).data.shared_uid_packages).toBeNull()
  })

  /** [] 는 "조회했고 이 uid 를 쓰는 패키지가 목록에 없었다" 이다. null 과 같은 뜻이 아니다. */
  it('조회했는데 그 uid 를 쓰는 패키지가 없으면 [] 다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after: NETSTATS_AFTER },
        packages: { before: 'package:com.other uid:10001\n', after: null },
      }),
    )
    expect(collected(out).data.shared_uid_packages).toEqual([])
  })
})
