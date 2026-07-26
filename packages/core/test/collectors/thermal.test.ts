import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { thermalCollector } from '../../src/collectors/thermal.js'
import type { BaseExtractContext, ExtractOutcome } from '../../src/collectors/types.js'
import type { MetricReason } from '../../src/schema/reasons.js'
import type { ThermalData } from '../../src/schema/result.js'

/**
 * 픽스처 둘 다 실기기(SM-S901N / Android 16 / sdk 36) 와 에뮬레이터(sdk_gphone64_arm64 /
 * API 35) 의 `dumpsys thermalservice` 출력의 줄 구조·탭 들여쓰기·섹션 순서를 그대로 옮기고
 * 값만 합성한 것이다. 이 collector 가 넘어질 수 있는 지점은 전부 그 구조에 있다.
 */
const read = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), 'utf8')

const THERMAL = read('dumpsys-thermalservice.txt')
const THERMAL_EMU = read('dumpsys-thermalservice-emu.txt')

/**
 * AP 를 41.6 으로 올리고 SKIN 을 내린 "종료" 스냅샷. 실기기에서 두 방향 다 관측됐다.
 *
 * **`replaceAll` 이어야 한다.** 이 픽스처는 실기기 원문 그대로라 같은 존이
 * `Cached temperatures` 와 `Current temperatures from HAL` 두 절에 모두 있고,
 * `replace` 는 앞쪽(Cached)만 바꾼다. 병합 규칙이 HAL 을 우선하므로 그러면 온도가
 * 하나도 안 변한 "종료" 스냅샷이 되어, 이 파일의 델타 단언이 전부 0 을 보게 된다.
 */
const AFTER = THERMAL.replaceAll(
  'mValue=37.1, mType=0, mName=AP',
  'mValue=41.6, mType=0, mName=AP',
).replaceAll('mValue=35.4, mType=3, mName=SKIN', 'mValue=34.1, mType=3, mName=SKIN')

function ctx(
  snapshots: Record<string, { before: string | null; after: string | null }>,
  sdkInt = 36,
): BaseExtractContext {
  return {
    packageName: 'com.foo',
    appUid: 10388,
    env: { sdkInt, dataSources: [] },
    capture: { startup: null, launchRequested: false, appPid: null, snapshots },
  }
}

/**
 * `ExtractOutcome` 은 판별 유니온이라 `data` / `partialReason` 은 collected 쪽에만 있다.
 * 좁히지 않고 접근하면 컴파일이 깨지므로 여기서 한 번에 좁힌다 — 실패하면 무엇이
 * 나왔는지 그대로 보여준다.
 */
function collected(out: ExtractOutcome<ThermalData>): {
  data: ThermalData
  partialReason?: MetricReason
} {
  if (!out.collected) throw new Error(`collected 가 아니다: ${JSON.stringify(out)}`)
  return out
}

describe('thermalCollector.supports', () => {
  it('sdk 29 이상이면 지원한다 — ThermalService 는 Android 10 에서 들어왔다', () => {
    expect(thermalCollector.supports({ sdkInt: 29, dataSources: [] })).toEqual({ supported: true })
  })

  it('sdk 28 이하는 sdk_too_low 이고 detail 이 하한을 말한다', () => {
    expect(thermalCollector.supports({ sdkInt: 28, dataSources: [] })).toEqual({
      supported: false,
      reason: { code: 'sdk_too_low', detail: { sdk_int: 28, min_sdk: 29 } },
    })
  })

  /** D9: M3 는 데이터소스도 ftrace 이벤트도 늘리지 않는다. */
  it('트레이스 설정을 하나도 만들지 않는다', () => {
    expect(thermalCollector.traceConfigBlocks()).toEqual([])
    expect(thermalCollector.needsTrace).toBe(false)
  })

  /** D3: dumpsys thermalservice 는 collectDeviceState 가 이미 찍는다. 선언하면 두 번 나간다. */
  it('스냅샷 명령을 선언하지 않는다 — 원문은 이미 찍히고 있다', () => {
    expect(thermalCollector.captureSnapshots).toBeUndefined()
  })
})

describe('thermalCollector.extract', () => {
  it('존별 전/후 온도와 부호 있는 델타를 낸다', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: THERMAL, after: AFTER } }),
    )
    expect(out.collected).toBe(true)

    const d = collected(out).data
    expect(d.zones).toHaveLength(8)
    expect(d.zones.find((z) => z.name === 'AP')).toEqual({
      name: 'AP',
      type: 0,
      before_c: 37.1,
      after_c: 41.6,
      delta_c: 4.5,
      status_before: 0,
      status_after: 0,
      source: 'hal',
    })
    // 음수 델타가 정상이다. 실기기 4세션 중 2세션이 내려갔다.
    expect(d.zones.find((z) => z.name === 'SKIN')?.delta_c).toBe(-1.3)
  })

  /** `Cached` 에만 있는 존을 잃지 않는다 — "HAL 절만 쓴다" 는 해법이었다면 사라졌을 값이다. */
  it('Cached 에만 있는 존도 실리고 source 가 그 사실을 말한다', async () => {
    const d = collected(
      await thermalCollector.extract(ctx({ thermalservice: { before: THERMAL, after: AFTER } })),
    ).data
    expect(d.zones.find((z) => z.name === 'PA1THM')).toMatchObject({
      source: 'cached',
      before_c: 27,
      after_c: 27,
      delta_c: 0,
    })
    // 존 순서는 기기가 준 순서다 — 델타 크기로 정렬하지 않는다 (D10).
    expect(d.zones.map((z) => z.name)).toEqual([
      'AP',
      'BAT',
      'PATHM',
      'SKIN',
      'SUBBAT',
      'SUBBATRAW',
      'USB',
      'PA1THM',
    ])
  })

  it('기기 전체 throttling 단계와 HAL 상태를 전후로 싣는다', async () => {
    const d = collected(
      await thermalCollector.extract(ctx({ thermalservice: { before: THERMAL, after: AFTER } })),
    ).data
    expect(d.device_status_before).toBe(0)
    expect(d.device_status_after).toBe(0)
    expect(d.status_override_before).toBe(false)
    expect(d.status_override_after).toBe(false)
    expect(d.hal_ready_before).toBe(true)
    expect(d.hal_ready_after).toBe(true)
  })

  it('headroom 임계의 NaN 을 null 로 싣는다', async () => {
    const d = collected(
      await thermalCollector.extract(ctx({ thermalservice: { before: THERMAL, after: AFTER } })),
    ).data
    expect(d.headroom_thresholds?.[0]).toBeNull()
    expect(d.headroom_thresholds?.[3]).toBe(1.0)
  })

  /**
   * G2. after 가 없다고 0 을 내면 "온도가 하나도 안 변했다" 는 없던 사실이 된다.
   * before 자체는 의미 있는 값이므로 버리지 않는다 (D5).
   */
  it('after 스냅샷이 없으면 before 만 내고 after/delta 는 null, 사유는 snapshot_unavailable', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: THERMAL, after: null } }),
    )
    expect(out.collected).toBe(true)
    expect(collected(out).partialReason).toEqual({
      code: 'snapshot_unavailable',
      detail: { key: 'thermalservice', phase: 'after' },
    })
    const ap = collected(out).data.zones.find((z) => z.name === 'AP')
    expect(ap?.before_c).toBe(37.1)
    expect(ap?.after_c).toBeNull()
    expect(ap?.delta_c).toBeNull()
    expect(ap?.status_after).toBeNull()
  })

  it('before 스냅샷이 없으면 값을 내지 않는다 — 델타의 기준이 없다', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: null, after: THERMAL } }),
    )
    expect(out).toEqual({
      collected: false,
      reason: { code: 'snapshot_unavailable', detail: { key: 'thermalservice', phase: 'before' } },
    })
  })

  /** M3 이전 run 을 재산출하는 경로. 키 자체가 없다. */
  it('thermalservice 키가 아예 없어도 던지지 않고 사유로 말한다', async () => {
    const out = await thermalCollector.extract(ctx({}))
    expect(out).toMatchObject({ collected: false, reason: { code: 'snapshot_unavailable' } })
  })

  it('존 집합이 달라지면 낼 수 있는 것만 내고 thermal_zones_changed 를 단다', async () => {
    const after = AFTER.replace(
      /\tTemperature\{mValue=27\.0, mType=5, mName=PA1THM, mStatus=0\}\n/,
      '',
    )
    const out = await thermalCollector.extract(ctx({ thermalservice: { before: THERMAL, after } }))

    expect(out.collected).toBe(true)
    expect(collected(out).partialReason).toEqual({
      code: 'thermal_zones_changed',
      detail: { only_before: ['PA1THM'], only_after: [] },
    })
    const pa1 = collected(out).data.zones.find((z) => z.name === 'PA1THM')
    expect(pa1?.before_c).toBe(27.0)
    expect(pa1?.after_c).toBeNull()
    expect(pa1?.delta_c).toBeNull()
  })

  it('after 에만 있는 존도 잃지 않는다 — before_c 가 null 인 항목으로 실린다', async () => {
    const after = THERMAL.replace(
      'HAL Ready: true',
      '\tTemperature{mValue=30.0, mType=1, mName=GPU, mStatus=0}\nHAL Ready: true',
    )
    const out = await thermalCollector.extract(ctx({ thermalservice: { before: THERMAL, after } }))
    const gpu = collected(out).data.zones.find((z) => z.name === 'GPU')
    expect(gpu).toMatchObject({ before_c: null, after_c: 30.0, delta_c: null, status_before: null })
    expect(collected(out).partialReason).toMatchObject({
      code: 'thermal_zones_changed',
      detail: { only_before: [], only_after: ['GPU'] },
    })
  })

  it('온도 항목이 하나도 없으면 no_thermal_zones', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: 'Thermal Status: 0\nHAL Ready: true\n', after: null } }),
    )
    expect(out).toEqual({ collected: false, reason: { code: 'no_thermal_zones' } })
  })

  it('HAL Ready: false 면 no_thermal_zones 가 아니라 thermal_hal_not_ready 다', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: 'Thermal Status: 0\nHAL Ready: false\n', after: null } }),
    )
    expect(out).toEqual({ collected: false, reason: { code: 'thermal_hal_not_ready' } })
  })

  /**
   * 에뮬 원문에는 `CoolingDevice{mValue=100, ...}` 와 `TemperatureThreshold{mType=3, ...}` 가
   * 함께 있다. 파서가 `Temperature{mValue=` 로 시작을 못박지 않으면 둘 다 존이 된다.
   */
  it('에뮬레이터의 존 1개짜리 출력도 정상 산출한다 (중복 없이 1개)', async () => {
    const d = collected(
      await thermalCollector.extract(
        ctx({ thermalservice: { before: THERMAL_EMU, after: THERMAL_EMU } }),
      ),
    ).data
    expect(d.zones).toHaveLength(1)
    expect(d.zones[0]).toMatchObject({ name: 'test temperature sensor', type: 3, delta_c: 0 })
  })

  /**
   * 사유는 하나만 실린다. after 가 통째로 없을 때 "센서 집합이 달라졌다" 고 말하면
   * 도구가 관측하지 않은 원인을 대는 것이다 (M2 의 launch_time_unreported 와 같은 계열).
   */
  it('after 가 통째로 없을 때는 zones_changed 가 아니라 snapshot_unavailable 이다', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: THERMAL, after: null } }),
    )
    expect(collected(out).partialReason?.code).toBe('snapshot_unavailable')
  })

  it('전후가 완전히 같으면 사유를 달지 않는다 — 0 델타는 정직한 0 이다', async () => {
    const out = await thermalCollector.extract(
      ctx({ thermalservice: { before: THERMAL, after: THERMAL } }),
    )
    expect(collected(out).partialReason).toBeUndefined()
    expect(collected(out).data.zones.every((z) => z.delta_c === 0)).toBe(true)
  })
})

/**
 * M-3. 존 하나가 값 **두 개**(before_c / after_c)를 담는데 `source` 는 하나다.
 * 옛 코드는 `source: b.source` — before 쪽 출처 하나로 존 전체를 라벨링했다.
 *
 * 그래서 HAL 이 before 에는 주고 after 에는 안 준 센서는 `after_c` 가 Cached 값인데
 * `source: 'hal'` 로 실렸고, 스키마가 `cached` 존에 붙여 둔 경고 — "이 값은 갱신이 올 때만
 * 바뀌므로 delta 0 이 '안 변했다' 가 아닐 수 있다" — 가 **그 존에 적용되지 않았다.**
 * 실기기 8개 덤프에서는 멤버십이 전부 같아 관측된 적 없지만 논리적으로 열려 있는 길이다.
 *
 * 고치는 자리가 `thermalZoneKey` 가 **아니라는** 것이 요점이다. 키에 `source` 를 넣으면
 * 같은 센서가 before/after 에서 다른 키가 되어 존 하나가 항목 둘로 갈라지고,
 * "센서 집합이 달라졌다" 는 없던 사실까지 만들어진다 — M3 가 방금 없앤 결함 그대로다.
 */
describe('thermalCollector.extract — 전/후 출처가 갈리는 존 (M-3)', () => {
  const dump = (cached: string[], hal: string[]): string =>
    [
      'IsStatusOverride: false',
      'Thermal Status: 0',
      'Cached temperatures:',
      ...cached.map((l) => `\t${l}`),
      'HAL Ready: true',
      'Current temperatures from HAL:',
      ...hal.map((l) => `\t${l}`),
      'Current cooling devices from HAL:',
      '',
    ].join('\n')

  const AP = (v: string): string => `Temperature{mValue=${v}, mType=0, mName=AP, mStatus=0}`

  it('HAL 이 after 에 그 센서를 안 주면 cached 로 싣는다 — 경고가 적용되어야 한다', async () => {
    const out = await thermalCollector.extract(
      ctx({
        thermalservice: {
          before: dump([AP('30.0')], [AP('31.0')]),
          // HAL 절이 비었고 Cached 에만 남았다. after_c 는 갱신되지 않았을 수 있는 값이다.
          after: dump([AP('27.0')], []),
        },
      }),
    )
    expect(collected(out).data.zones[0]).toMatchObject({
      name: 'AP',
      before_c: 31,
      after_c: 27,
      source: 'cached',
    })
  })

  it('before 만 cached 여도 cached 다 — 어느 쪽이 갱신 안 됐는지는 말하지 않는다', async () => {
    const out = await thermalCollector.extract(
      ctx({
        thermalservice: {
          before: dump([AP('27.0')], []),
          after: dump([AP('30.0')], [AP('31.0')]),
        },
      }),
    )
    expect(collected(out).data.zones[0]).toMatchObject({ before_c: 27, after_c: 31, source: 'cached' })
  })

  /** 대조군. 두 값 다 HAL 이 직접 준 것이면 그때만 `hal` 이다. */
  it('전후 둘 다 HAL 이 준 값이면 hal 이다', async () => {
    const out = await thermalCollector.extract(
      ctx({
        thermalservice: {
          before: dump([AP('30.0')], [AP('31.0')]),
          after: dump([AP('30.0')], [AP('33.0')]),
        },
      }),
    )
    expect(collected(out).data.zones[0]).toMatchObject({ before_c: 31, after_c: 33, source: 'hal' })
  })

  /** 존이 갈라지지 않았다는 것도 함께 본다 — 키에 source 를 넣었다면 여기서 2개가 된다. */
  it('출처가 갈려도 존은 하나다 — zones_changed 라는 없던 사실을 만들지 않는다', async () => {
    const out = await thermalCollector.extract(
      ctx({
        thermalservice: {
          before: dump([AP('30.0')], [AP('31.0')]),
          after: dump([AP('27.0')], []),
        },
      }),
    )
    expect(collected(out).data.zones).toHaveLength(1)
    expect(collected(out).partialReason).toBeUndefined()
  })
})
