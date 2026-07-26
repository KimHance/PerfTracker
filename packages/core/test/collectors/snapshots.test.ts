import { describe, expect, it } from 'vitest'
import {
  DEVICE_STATE_KEYS,
  mergeSnapshotSpecs,
  parseSnapshotRawPath,
  type SnapshotSpec,
  snapshotText,
} from '../../src/collectors/snapshots.js'

const A: SnapshotSpec = { key: 'netstats', command: 'dumpsys netstats' }
const B: SnapshotSpec = { key: 'packages', command: 'pm list packages -U' }

describe('mergeSnapshotSpecs', () => {
  it('같은 명세를 두 번 넣으면 하나로 접는다', () => {
    expect(mergeSnapshotSpecs([A, B, A])).toEqual([A, B])
  })

  it('같은 key 에 다른 command 가 오면 던진다 — 어느 명령으로 찍었는지가 결과에서 사라지면 안 된다', () => {
    expect(() => mergeSnapshotSpecs([A, { key: 'netstats', command: 'dumpsys netstats --uid' }])).toThrow(
      /netstats/,
    )
  })

  it('collectDeviceState 가 이미 소유한 key 는 collector 가 다시 선언할 수 없다', () => {
    for (const key of DEVICE_STATE_KEYS) {
      expect(() => mergeSnapshotSpecs([{ key, command: 'echo x' }])).toThrow(new RegExp(key))
    }
  })

  it('_before / _after 로 끝나는 key 는 경로 규약과 충돌하므로 던진다', () => {
    expect(() => mergeSnapshotSpecs([{ key: 'netstats_after', command: 'echo x' }])).toThrow(
      /netstats_after/,
    )
  })

  it('빈 목록은 빈 목록이다', () => {
    expect(mergeSnapshotSpecs([])).toEqual([])
  })
})

describe('parseSnapshotRawPath', () => {
  it('raw/<key>_<phase>.txt 에서 key 와 phase 를 뽑는다', () => {
    expect(parseSnapshotRawPath('raw/thermalservice_before.txt')).toEqual({
      key: 'thermalservice',
      phase: 'before',
    })
    expect(parseSnapshotRawPath('raw/netstats_after.txt')).toEqual({ key: 'netstats', phase: 'after' })
  })

  it('key 에 밑줄이 있어도 마지막 _before/_after 로 가른다', () => {
    expect(parseSnapshotRawPath('raw/batterystats_checkin_before.txt')).toEqual({
      key: 'batterystats_checkin',
      phase: 'before',
    })
  })

  it('규약에 안 맞는 경로는 null — 조용히 엉뚱한 key 를 만들지 않는다', () => {
    expect(parseSnapshotRawPath('trace.perfetto-trace')).toBeNull()
    expect(parseSnapshotRawPath('raw/thermalservice.txt')).toBeNull()
    expect(parseSnapshotRawPath('raw/thermalservice_middle.txt')).toBeNull()
  })
})

describe('snapshotText', () => {
  /**
   * `tryShell` 은 실패를 **빈 문자열**로 흡수한다. 그래서 "파일이 없다" 와
   * "명령이 실패해 빈 파일이 남았다" 는 같은 뜻이고, 둘 다 null 이어야 한다.
   * 여기서 '' 를 그대로 흘려보내면 파서가 "섹션을 못 찾았다"(snapshot_unparsable)로
   * 잘못 말한다 — 실제로는 아예 없었던 것이다.
   */
  it('빈 문자열과 공백만 있는 문자열은 null 이다', () => {
    expect(snapshotText('')).toBeNull()
    expect(snapshotText('   \n\t\n')).toBeNull()
  })

  it('내용이 있으면 원문을 그대로 돌려준다 — 앞뒤 공백도 자르지 않는다', () => {
    expect(snapshotText('\nThermal Status: 0\n')).toBe('\nThermal Status: 0\n')
  })
})
