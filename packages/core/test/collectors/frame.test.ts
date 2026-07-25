import { describe, expect, it } from 'vitest'
import {
  bucketFrames,
  buildFrameBuckets,
  frameCollector,
  percentile,
  selectRenderProcess,
} from '../../src/collectors/frame.js'
import { FRAME_PROCESS_SQL, frameDurationsSql } from '../../src/collectors/frame.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

describe('buildFrameBuckets', () => {
  it('스펙이 정한 101개 버킷을 만든다', () => {
    expect(buildFrameBuckets()).toHaveLength(101)
  })

  it('첫 버킷은 0-5 하나다', () => {
    expect(buildFrameBuckets()[0]).toEqual({ from_ms: 0, to_ms: 5, count: 0 })
  })

  it('16ms 부근은 1ms 간격이다', () => {
    const b = buildFrameBuckets()
    expect(b[1]).toEqual({ from_ms: 5, to_ms: 6, count: 0 })
    expect(b[11]).toEqual({ from_ms: 15, to_ms: 16, count: 0 })
  })

  it('마지막 버킷은 상한이 없다', () => {
    expect(buildFrameBuckets().at(-1)).toEqual({ from_ms: 700, to_ms: null, count: 0 })
  })

  it('구간 경계가 이어진다', () => {
    const b = buildFrameBuckets()
    for (let i = 0; i < b.length - 1; i++) expect(b[i]!.to_ms).toBe(b[i + 1]!.from_ms)
  })
})

describe('bucketFrames', () => {
  it('경계값은 아래 버킷이 아니라 위 버킷에 들어간다', () => {
    const b = bucketFrames([5])
    expect(b[0]!.count).toBe(0)
    expect(b[1]!.count).toBe(1)
  })

  it('700 이상은 마지막 버킷으로 간다', () => {
    expect(bucketFrames([700, 5000]).at(-1)!.count).toBe(2)
  })

  it('0 은 첫 버킷에 들어간다', () => {
    expect(bucketFrames([0, 4.9])[0]!.count).toBe(2)
  })

  it('총합이 입력 개수와 같다', () => {
    const durations = [1, 7, 17, 60, 200, 400, 900]
    expect(bucketFrames(durations).reduce((s, b) => s + b.count, 0)).toBe(durations.length)
  })
})

describe('percentile', () => {
  it('정렬된 배열에서 백분위를 고른다', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 90)).toBe(9)
    expect(percentile(sorted, 100)).toBe(10)
  })

  it('빈 배열은 0', () => {
    expect(percentile([], 50)).toBe(0)
  })
})

describe('selectRenderProcess', () => {
  const pkg = 'com.nhn.android.webtoon'

  it('패키지명과 정확히 같은 프로세스를 고른다', () => {
    const picked = selectRenderProcess(
      [
        { upid: 1, pid: 1, name: '/system/bin/surfaceflinger', frames: 900 },
        { upid: 2, pid: 2, name: pkg, frames: 100 },
      ],
      pkg,
    )
    expect(picked?.name).toBe(pkg)
  })

  it('패키지의 서브프로세스도 인정한다', () => {
    const picked = selectRenderProcess([{ upid: 2, pid: 2, name: `${pkg}:remote`, frames: 10 }], pkg)
    expect(picked?.name).toBe(`${pkg}:remote`)
  })

  it('패키지 프로세스가 없으면 시스템 프로세스를 뺀 최다 프레임을 고른다', () => {
    const picked = selectRenderProcess(
      [
        { upid: 1, pid: 1, name: '/system/bin/surfaceflinger', frames: 900 },
        { upid: 3, pid: 3, name: 'com.other.app', frames: 50 },
      ],
      pkg,
    )
    expect(picked?.name).toBe('com.other.app')
  })

  it('시스템 프로세스만 있으면 null 을 낸다', () => {
    // 잠금화면 세션이 실제로 이렇게 나온다 — 450프레임이 전부 surfaceflinger 였다.
    expect(
      selectRenderProcess([{ upid: 1, pid: 1, name: '/system/bin/surfaceflinger', frames: 450 }], pkg),
    ).toBeNull()
  })

  it('후보가 없으면 null', () => {
    expect(selectRenderProcess([], pkg)).toBeNull()
  })
})

describe('frameCollector', () => {
  it('Android 12 미만은 미지원으로 표시한다', () => {
    expect(frameCollector.supports({ sdkInt: 30, dataSources: [] })).toEqual({
      supported: false,
      reason: 'requires Android 12+ (device sdk_int=30)',
    })
  })

  it('데이터소스가 등록되지 않았으면 미지원', () => {
    expect(frameCollector.supports({ sdkInt: 36, dataSources: [] }).supported).toBe(false)
  })

  it('조건이 맞으면 지원', () => {
    expect(
      frameCollector.supports({ sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] }),
    ).toEqual({ supported: true })
  })

  it('TraceConfig 블록에 frametimeline 이 들어간다', () => {
    expect(frameCollector.traceConfigBlocks().join('\n')).toContain('android.surfaceflinger.frametimeline')
  })

  it('트레이스에서 프레임 분포를 산출한다', async () => {
    const pkg = 'com.nhn.android.webtoon'
    const runner = new FakeProcessRunner()
      .on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
        stdout: `"j"\n"[{"upid":2,"pid":24193,"name":"${pkg}","frames":4}]"\n`,
      })
      .on(`query /t.pftrace ${frameDurationsSql(2)}`, {
        stdout: '"j"\n"[8000000,20000000,4000000,900000000]"\n',
      })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    const data = await frameCollector.extract({
      tp,
      packageName: pkg,
      env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
    })

    expect(data).not.toBeNull()
    expect(data!.process).toBe(pkg)
    expect(data!.total_frames).toBe(4)
    expect(data!.max_ms).toBe(900)
    expect(data!.within_16_67ms_ratio).toBe(0.5)
    expect(data!.buckets.reduce((s, b) => s + b.count, 0)).toBe(4)
  })

  it('앱 프로세스를 못 찾으면 null 을 낸다', async () => {
    const runner = new FakeProcessRunner().on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
      stdout: '"j"\n"[{"upid":1,"pid":1,"name":"/system/bin/surfaceflinger","frames":450}]"\n',
    })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    await expect(
      frameCollector.extract({
        tp,
        packageName: 'com.x',
        env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
      }),
    ).resolves.toBeNull()
  })
})
