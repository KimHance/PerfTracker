import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'

/**
 * 공개 배럴은 "단일 관문" 주장을 구조로 만든다.
 * 구체 러너가 여기 있으면 소비자(계획된 GUI 포함)가 `nodeProcessRunner.run('adb', [...])` 로
 * 측정 창 래치를 우회해 기기에 도달할 수 있다. 관례가 아니라 타입 시스템이 막아야 한다.
 */
describe('@perftracker/core 공개 배럴', () => {
  it('구체 ProcessRunner 를 내보내지 않는다', () => {
    expect(Object.keys(core)).not.toContain('nodeProcessRunner')
  })

  it('기기 접촉은 AdbClient 를 통해서만 열려 있다', () => {
    expect(core.AdbClient).toBeTypeOf('function')
    expect(core.MeasurementWindow).toBeTypeOf('function')
  })

  it('런타임 값이 아닌 타입만 내보낸 모듈은 배럴에 값을 남기지 않는다', () => {
    // ProcessRunner / ProcessResult / ProcessRunOptions 는 인터페이스이므로 런타임 키가 없다.
    for (const name of ['ProcessRunner', 'ProcessResult', 'ProcessRunOptions']) {
      expect(Object.keys(core)).not.toContain(name)
    }
  })
})
