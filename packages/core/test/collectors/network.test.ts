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
import { type MetricReason, renderReason } from '../../src/schema/reasons.js'
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

  /**
   * 미끼 2. `BPF map content:` 머리가 **두 번** 나온다 (`InterfaceMapHelper:` 아래에 하나).
   *
   * 옛 단언은 `expect([...keys]).not.toContain(15)` 였는데 **어떤 앵커 선택으로도 실패할 수
   * 없었다** — 픽스처의 `ifaceIndex=15 ifaceName=eth0` 는 `ROW`(5열 정수)에 애초에 안 걸리고,
   * 앵커를 `BPF map content:` 로 옮기면 헤더가 `IfaceIndexNameMap:` 이 되어 헤더 고정이
   * 행 읽기를 통째로 막으므로 맵은 그냥 빈다. 미끼 3 에서 한 변형 실험을 미끼 2 에는
   * 하지 않아 드러나지 않았던 공허한 단언이다.
   *
   * 계약을 직접 겨눈다: **앵커는 `mAppUidStatsMap:` 이지 `BPF map content:` 가 아니다.**
   * `mAppUidStatsMap` 절이 통째로 없고 `InterfaceMapHelper:` 의 `BPF map content:` 만 있는
   * 입력에서, 앵커를 잘못 잡은 파서는 `found: true` + `header: 'IfaceIndexNameMap:'` 을 내고
   * 올바른 파서는 `found: false` 를 낸다. 그 차이가 이 단언이다.
   */
  it('BPF map content: 머리를 앵커로 쓰지 않는다 — 그 절이 없으면 found=false 다', () => {
    // 픽스처에서 mAppUidStatsMap 절부터 뒤를 잘라 낸다. InterfaceMapHelper 의
    // `BPF map content:` 와 `BPF map status:` 의 `mAppUidStatsMap: OK` 는 그대로 남는다.
    const head = NETSTATS.slice(0, NETSTATS.indexOf('  mAppUidStatsMap:\n    uid rxBytes'))
    expect(head).toContain('BPF map content:')
    expect(head).toContain('IfaceIndexNameMap:')
    expect(head).toContain('mAppUidStatsMap: OK')

    const d = parseAppUidStats(head)
    expect(d.found).toBe(false)
    expect(d.header).toBeNull()
    expect(d.byUid.size).toBe(0)
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

  /**
   * 실기기(SM-S901N / sdk 36)의 `mAppUidStatsMap` 은 uid 열에 **음수**를 찍는다.
   * 실측 원문 (3회 연속 동일, 표 93행 중 82번째):
   *
   *     -253 151772 1156 2367519 1871
   *
   * 그 값이 무엇인지 이 도구는 모른다 — 그리고 알 필요도 없다. 문제는 uid 열을 `\d+` 로
   * 읽던 옛 파서가 이 줄을 **행이 아니라고 판단해 표 읽기를 통째로 멈췄다**는 것이다.
   * 뒤따르던 12행(uid 10070 은 1.6GB 를 받은 행이다)이 소리 없이 사라졌고, 그 12행 중에
   * 대상 앱의 uid 가 있었으면 이 도구는 `uid_not_in_netstats` 를 내면서
   * **"부팅 이후 이 uid 로 오간 트래픽이 없었을 수 있습니다"** 라고 말했을 것이다.
   * 관측하지 않은 원인을 사실 자리에 앉히는 바로 그 모양이다.
   *
   * 깨지는 조건: uid 열이 다시 부호를 안 받으면 `1051` 행을 못 읽고 실패한다.
   */
  it('uid 열의 음수 행에서 표 읽기를 멈추지 않는다 — 실기기가 실제로 찍는다', () => {
    const text = NETSTATS.replace(
      '    1051 0 0 1088 18\n',
      '    -253 151772 1156 2367519 1871\n    1051 0 0 1088 18\n',
    )
    const d = parseAppUidStats(text)
    // 음수 행 **뒤**의 행이 살아 있어야 한다. 이것이 이 테스트의 전부다.
    expect(d.byUid.get(1051)).toEqual({
      uid: 1051,
      rxBytes: 0,
      rxPackets: 0,
      txBytes: 1088,
      txPackets: 18,
    })
    // 읽은 행 수도 그 줄을 포함한다 — 읽고도 안 셌다고 말하지 않는다.
    expect(d.rowCount).toBe(6)
    // 값 자체는 지어내지 않고 원문 그대로 싣는다. 대상 앱 uid 는 음수일 수 없으므로
    // 이 항목이 조회에 걸리는 일은 없다.
    expect(d.byUid.get(-253)?.rxBytes).toBe(151_772)
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
    expect(out).toMatchObject({
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

  /**
   * **이 저장소가 내린 판단이 여기 있다.** uid 를 여럿이 공유하면 값은 다 싣되 `status` 로도
   * 그 사실을 말한다.
   *
   * 왜 `collected` 가 아닌가: 실기기에서 uid 1000 을 **86개 패키지가 공유한다.** 그 상태로
   * `collected` 를 내면 `rx_bytes` 만 읽는 소비자는 "이 앱이 1.7MB 를 썼다" 로 읽는다.
   * 이 저장소는 이미 같은 이유로 `NETWORK_SCOPE` 문장을 네 필드 전부에 복사해 뒀다 —
   * "한 필드만 읽는 소비자도 그 한정에 도달해야 한다". `status` 는 그 필드들 중에서도
   * 가장 먼저 읽히는 자리이고, CI 는 대개 `status === 'collected'` 하나로 게이트를 만든다.
   *
   * 판정이 아니다: "이 값이 크다/틀렸다" 고 말하지 않는다. **이 숫자가 무엇의 합인지**를
   * 말할 뿐이고 그것은 관측된 사실이다. 값은 하나도 빠짐없이 실린다.
   *
   * 깨지는 조건: 공유 사유를 지우면 `partial` 이 아니라 사유 없는 `collected` 가 되어 실패한다.
   */
  it('uid 를 여럿이 공유하면 값은 다 싣되 partial 로 낸다 — 그 숫자는 한 앱의 것이 아니다', async () => {
    const out = collected(await networkCollector.extract(ctx()))

    expect(out.data.shared_uid_packages).toHaveLength(2)
    expect(out.partialReason).toEqual({
      code: 'uid_shared_by_multiple_packages',
      detail: { uid: 10388, package_count: 2 },
    })
    // 사유 문장이 소비자에게 무엇을 하라고 말하는지도 계약이다.
    expect(renderReason(out.partialReason!)).toContain('2개')
  })

  /** 혼자 쓰는 uid 는 한정이 없다. 여기서 partial 을 내면 정직이 아니라 소음이다. */
  it('그 uid 를 쓰는 패키지가 하나뿐이면 collected 다 — 한정이 없으면 달지 않는다', async () => {
    const out = collected(
      await networkCollector.extract(
        withSnapshots({
          netstats: { before: NETSTATS, after: NETSTATS_AFTER },
          packages: { before: 'package:com.nhn.android.webtoon uid:10388\n', after: null },
        }),
      ),
    )
    expect(out.data.shared_uid_packages).toEqual(['com.nhn.android.webtoon'])
    expect(out.partialReason).toBeUndefined()
  })

  /**
   * 결함 2. **열거 실패와 "공유 패키지 없음" 은 다른 사실이다.**
   *
   * 실기기 실측: `pm list packages -U` 는 삼성 시큐어 폴더(안드로이드 user 150)를 열거하지
   * 못한다 — 기기가 stderr 로 `SecurityException: Shell does not have permission to access
   * user 150` 을 내고 **종료 코드는 0** 이며 stdout 에는 그 user 의 패키지가 한 줄도 없다.
   * 그런데 `dumpsys netstats` 에는 그 user 의 uid 행이 실재한다 (실측 18개: 15010241,
   * 15010240, …). 그 uid 를 조회하면 목록에서 아무것도 못 찾는다.
   *
   * 그때 `[]` 를 내면 "이 uid 를 쓰는 패키지가 없다" 는 **거짓**이 된다. 사실은
   * "이 셸 권한으로는 그 user 를 열거할 수 없었다" 이고, 도구는 그것을 알 수 있다 —
   * 자기가 읽은 목록에 user 150 의 패키지가 **하나도** 없다는 것을 보면 된다.
   *
   * 깨지는 조건: 열거 범위를 보지 않고 `parsePackageUids` 결과를 그대로 실으면 `[]` 가 되어
   * 두 단언이 모두 실패한다.
   */
  it('셸이 열거하지 못한 user 의 uid 는 [] 가 아니라 null 이다 — 시큐어 폴더(user 150)', async () => {
    const out = collected(
      await networkCollector.extract(
        ctx({
          appUid: 15_010_241,
          capture: {
            ...ctx().capture,
            snapshots: {
              netstats: {
                before: NETSTATS.replace('    1051 0 0 1088 18\n', '    15010241 100 1 200 2\n'),
                after: NETSTATS.replace('    1051 0 0 1088 18\n', '    15010241 300 3 500 5\n'),
              },
              packages: { before: PACKAGES, after: PACKAGES },
            },
          },
        }),
      ),
    )

    expect(out.data.shared_uid_packages).toBeNull()
    expect(out.partialReason).toEqual({
      code: 'uid_packages_not_enumerable',
      detail: {
        uid: 15_010_241,
        packages_snapshot: true,
        uid_user_id: 150,
        enumerated_user_ids: [0],
      },
    })
    expect(renderReason(out.partialReason!)).toContain('150')
  })

  /**
   * 열거된 user 안에서 못 찾은 것은 진짜로 `[]` 다 — 열거 실패(null)와 뭉개지 않는다.
   *
   * 그런데 그것이 `collected` 는 아니다. 대상 앱의 uid 를 쓰는 패키지가 목록에 **하나도**
   * 없다는 것은 대상 패키지 자신도 거기 없다는 뜻이고, 그러면 이 숫자를 어느 패키지에
   * 귀속시킬 수 있는지 도구가 확인하지 못한 것이다. 그 상태로 `collected` 를 내면
   * "관측하지 않은 귀속" 을 사실로 내보내게 된다.
   */
  it('열거된 user 안에서 못 찾으면 [] 이고, 그것도 collected 가 아니다', async () => {
    const out = collected(
      await networkCollector.extract(
        ctx({
          appUid: 1051,
          capture: {
            ...ctx().capture,
            snapshots: {
              netstats: { before: NETSTATS, after: NETSTATS_AFTER },
              packages: { before: PACKAGES, after: PACKAGES },
            },
          },
        }),
      ),
    )
    expect(out.data.shared_uid_packages).toEqual([])
    expect(out.partialReason).toEqual({
      code: 'uid_not_in_package_list',
      detail: { uid: 1051, package: 'com.nhn.android.webtoon' },
    })
  })

  /**
   * 사유는 하나만 실린다. BPF 맵 중복(= 어느 값이 맞는지 모른다)이 공유 uid(= 무엇의 합인지
   * 안다)보다 먼저다 — 앞엣것은 값 자체를 의심하게 하고, 뒤엣것은 값이 무엇을 덮는지만
   * 말한다. 이 순서가 계약이라는 것을 여기서 못박는다. 어느 쪽이 실리든 `status` 는 똑같이
   * `partial` 이고, 공유 사실은 `shared_uid_packages` 배열에 그대로 남는다.
   */
  it('중복 행과 공유 uid 가 겹치면 중복이 먼저 실린다', async () => {
    const before = NETSTATS.replace(
      '    10388 1200000 1119 431000 871\n    1000',
      '    10388 999 9 99 9\n    1000',
    )
    const out = collected(
      await networkCollector.extract(
        withSnapshots({
          netstats: { before, after: NETSTATS_AFTER },
          packages: { before: PACKAGES, after: PACKAGES },
        }),
      ),
    )
    expect(out.partialReason?.code).toBe('netstats_uid_duplicated')
    // 공유 사실 자체는 사라지지 않는다 — 사유 자리를 못 얻었을 뿐이다.
    expect(out.data.shared_uid_packages).toHaveLength(2)
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
          // 절은 찾았다 — 다른 것은 머리글이다. 이 둘은 소비자에게 다른 신호다.
          found: true,
          header: 'uid rxPackets rxBytes txPackets txBytes',
        },
      },
    })
  })

  /**
   * M-5. `snapshot_unparsable` 은 **절 자체가 없음**과 **머리글이 다름**을 같은 코드로 낸다.
   * 옛 detail 에서 그 둘을 가르는 단서는 `header` 키의 **부재**뿐이었고, 그 규칙은
   * `reasons.ts` 의 코드 설명에도 `renderReason` 출력에도 없었다 — 소비자가 추론해야 했다.
   *
   * 대응이 갈리므로 추론에 맡길 자리가 아니다: 절이 없는 것은 "이 안드로이드 버전·벤더
   * 출력에는 그 절이 없다"(= 이 기기에서는 낼 수 없다) 일 수 있고, 머리글이 다른 것은
   * "형식이 바뀌었다"(= 파서를 고쳐야 한다) 다.
   */
  it('절 자체가 없으면 found: false 로 명시한다 — 머리글이 다른 것과 다른 사실이다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: 'Active interfaces:\n', after: NETSTATS_AFTER } }),
    )
    expect(out).toEqual({
      collected: false,
      reason: {
        code: 'snapshot_unparsable',
        detail: {
          key: 'netstats',
          section: 'mAppUidStatsMap',
          phase: 'before',
          found: false,
        },
      },
    })
    // 절을 못 찾았으면 머리글도 없다 — 없는 것을 지어내지 않는다.
    expect(out.collected === false && out.reason.detail).not.toHaveProperty('header')
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
        detail: { uid: 12345, in_before: false, in_after: false, rows_before: 5, rows_after: 5 },
      },
    })
  })

  /**
   * I-1. **헤더가 맞았는데 행을 한 개도 못 읽은 상태**를 "트래픽이 없었다" 로 보고하면 안 된다.
   *
   * 헤더 고정은 **컬럼 순서**만 지킨다 — 행의 모양에는 아무 방어가 없다. 실기기가 헤더는
   * 같게 찍고 행만 다르게 찍으면(`uid=10388 rxBytes=…` 형태, 6번째 열, 하위 키 들여쓰기)
   * `byUid` 가 양쪽 다 비고, 옛 코드는 `uid_not_in_netstats` 를 내면서
   * **"부팅 이후 이 uid 로 오간 트래픽이 없었을 수 있습니다"** 라고 말했다.
   * 관측하지 않은 원인을 대면서 형식 불일치라는 사실을 삼키는 것 — G1 이 막으려던 모양이다.
   *
   * 실기기 `mAppUidStatsMap` 에는 시스템 uid 가 항상 수십 개 있으므로 **행 0개는 사실상
   * 형식 드리프트 신호**다. 이 도구는 실기기 원문을 한 줄도 본 적이 없어 특히 그렇다.
   *
   * 깨지는 조건: 0행 분기를 지우면 이 테스트가 `uid_not_in_netstats` 를 받고 실패한다.
   */
  it('헤더는 맞는데 행을 하나도 못 읽으면 uid_not_in_netstats 가 아니라 snapshot_unparsable 이다', async () => {
    // 헤더는 그대로 두고 행만 실기기가 다르게 찍을 법한 모양으로 바꾼다.
    const drifted = NETSTATS.replace(
      /(uid rxBytes rxPackets txBytes txPackets\n)(?:    \d+ \d+ \d+ \d+ \d+\n)+/,
      '$1    uid=10388 rxBytes=1200000 rxPackets=1119 txBytes=431000 txPackets=871\n',
    )
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: drifted, after: drifted } }),
    )
    expect(out).toMatchObject({
      collected: false,
      reason: {
        code: 'snapshot_unparsable',
        detail: {
          key: 'netstats',
          section: 'mAppUidStatsMap',
          phase: 'before',
          // 절도 머리글도 찾았다. 없는 것은 행뿐이다 — 세 갈래가 detail 로 전부 갈린다.
          found: true,
          rows: 0,
          // 형식을 진단할 수 있도록 머리 다음 줄 원문을 그대로 남긴다.
          first_line: '    uid=10388 rxBytes=1200000 rxPackets=1119 txBytes=431000 txPackets=871',
        },
      },
    })
  })

  /**
   * 0행이 "표가 실제로 비어 있다" 일 수도 있다는 것을 이 도구는 **구분하지 못한다.**
   * 그래서 사유 문장이 원인을 단정하지 않고 원문 줄을 함께 남긴다.
   * 깨지는 조건: 문장이 "트래픽이 없었다" 같은 원인을 단정하면 실패한다.
   */
  it('0행 사유는 원인을 단정하지 않는다 — 트래픽이 없었다고 말하지 않는다', async () => {
    const empty =
      'BPF map content:\n  mAppUidStatsMap:\n    uid rxBytes rxPackets txBytes txPackets\n  mStatsMapA:\n'
    const out = await networkCollector.extract(
      withSnapshots({ netstats: { before: empty, after: empty } }),
    )
    if (out.collected) throw new Error(`collected 가 아니어야 한다: ${JSON.stringify(out)}`)
    const text = renderReason(out.reason)!
    expect(text).not.toContain('트래픽이 없었')
    expect(text).toContain('구분하지 못합니다')
    expect(text).toContain('mStatsMapA:')
  })

  /**
   * I-1 의 나머지 절반. 행은 읽었는데 **내 uid 만** 없는 것과 표를 0행 읽은 것은
   * 다른 사실이고, 소비자가 그것을 가를 수 있어야 한다.
   * 깨지는 조건: detail 에서 행 수가 빠지면 두 상황이 같은 모양이 된다.
   */
  it('uid_not_in_netstats 는 표에서 몇 행을 읽었는지를 함께 남긴다', async () => {
    const out = await networkCollector.extract(ctx({ appUid: 12345 }))
    if (out.collected) throw new Error('collected 가 아니어야 한다')
    // 픽스처는 **5행**이고 uid 는 **4개**다 (10388 이 같은 값으로 두 번 찍힌다).
    // 그 차이가 rowCount 를 byUid.size 와 따로 세는 이유다 — 중복 행은 맵에서 접히므로
    // byUid.size 로는 "표를 몇 행 읽었나" 에 답할 수 없다.
    expect(out.reason.detail).toMatchObject({ rows_before: 5, rows_after: 5 })
    expect(renderReason(out.reason)).toContain('5행')
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
        // 이 uid 를 쓰는 패키지가 하나뿐인 목록이라 귀속 사유도 붙지 않는다 —
        // 남는 사유가 있다면 그것은 남의 uid 의 중복뿐이고, 그것이 이 단언의 표적이다.
        packages: { before: 'package:com.nhn.android.webtoon uid:10388\n', after: null },
      }),
    )
    expect(collected(out).partialReason).toBeUndefined()
  })

  /** G2. 조회 못 한 것을 [] 로 내면 "이 앱만 이 uid 를 쓴다" 는 없던 사실이 된다. */
  it('packages 스냅샷이 없으면 shared_uid_packages 는 [] 가 아니라 null 이다', async () => {
    const out = collected(
      await networkCollector.extract(
        withSnapshots({ netstats: { before: NETSTATS, after: NETSTATS_AFTER } }),
      ),
    )
    expect(out.data.shared_uid_packages).toBeNull()
    // 스냅샷이 아예 없는 것과 있는데 그 user 를 못 열거한 것은 detail 로 갈린다.
    expect(out.partialReason).toEqual({
      code: 'uid_packages_not_enumerable',
      detail: { uid: 10388, packages_snapshot: false },
    })
  })

  /**
   * M-6. `packages?.before ?? packages?.after` 폴백이 테스트되지 않았다.
   *
   * 이 경로는 실제로 있다: `pm list packages -U` 는 `tryShell` 로 나가므로 start 에서
   * 실패하면 빈 파일이 되고 `snapshotText` 가 그것을 null 로 접는다 — 그때 stop 의
   * 스냅샷만 남는다. run 디렉토리에서 `packages_before.txt` 하나만 사라진 경우도 같다.
   *
   * 폴백이 정당한 이유: uid → 패키지 매핑은 **거의 정적**이라(앱을 설치·삭제해야 바뀐다)
   * 어느 쪽 스냅샷을 읽어도 대개 같은 답이다. 그래서 한쪽이 없다고 null 을 내면
   * "조회하지 못했다" 는 없던 사실이 된다 — 손에 답을 쥐고 있으면서.
   */
  it('시작 스냅샷이 없으면 종료 스냅샷으로 uid 한정을 채운다 — 답을 쥐고 null 을 내지 않는다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after: NETSTATS_AFTER },
        packages: { before: null, after: PACKAGES },
      }),
    )
    expect(collected(out).data.shared_uid_packages).toEqual([
      'com.nhn.android.webtoon',
      'com.example.sibling',
    ])
  })

  /**
   * 폴백의 **방향**도 계약이다. 델타의 기준이 시작 스냅샷이므로 uid 한정도 그쪽을 먼저 본다.
   * 두 스냅샷 사이에 같은 uid 를 쓰는 패키지가 설치되면 두 답이 갈리는데, 이 결과가 말해야
   * 하는 것은 "델타를 잰 그 구간에 이 uid 를 쓰던 패키지" 다.
   */
  it('둘 다 있으면 시작 스냅샷이 이긴다 — 델타의 기준이 그쪽이다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after: NETSTATS_AFTER },
        packages: {
          before: 'package:com.nhn.android.webtoon uid:10388\n',
          after: `${PACKAGES}package:com.example.installed_later uid:10388\n`,
        },
      }),
    )
    expect(collected(out).data.shared_uid_packages).toEqual(['com.nhn.android.webtoon'])
  })

  /** [] 는 "조회했고 이 uid 를 쓰는 패키지가 목록에 없었다" 이다. null 과 같은 뜻이 아니다. */
  it('조회했는데 그 uid 를 쓰는 패키지가 없으면 [] 다', async () => {
    const out = await networkCollector.extract(
      withSnapshots({
        netstats: { before: NETSTATS, after: NETSTATS_AFTER },
        // 같은 안드로이드 user(0) 를 열거한 목록이다 — 그 안에서 못 찾은 것은 진짜 부재다.
        packages: { before: 'package:com.other uid:10001\n', after: null },
      }),
    )
    expect(collected(out).data.shared_uid_packages).toEqual([])
  })
})
