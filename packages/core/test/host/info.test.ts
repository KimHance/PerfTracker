import { describe, expect, it } from 'vitest'
import { collectHostInfo } from '../../src/host/info.js'

describe('collectHostInfo', () => {
  it('주입된 런타임 값을 그대로 옮긴다', () => {
    // 이 함수가 도는 컴퓨터에서만 검증되는 값이면 CI 와 개발자 PC 가 서로 다른 것을 확인하게 된다.
    expect(
      collectHostInfo({ platform: 'linux', arch: 'x64', versions: { node: '22.0.0' } }),
    ).toEqual({ os: 'linux', arch: 'x64', node: '22.0.0' })
  })

  it('인자가 없으면 이 프로세스를 읽는다', () => {
    expect(collectHostInfo()).toEqual({
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
    })
  })
})
