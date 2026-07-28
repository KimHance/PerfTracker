import { describe, expect, it } from 'vitest'
import { abortCommandLine, markCommandLine, startCommandLine, stopCommandLine } from '../src/server/command.js'

/**
 * **서버가 자기가 한 일을 적는다.** 화면이 조립하던 시절에는 `gui -o /tmp/x` 로 띄워도
 * 로그에 `-o runs` 가 찍혔다 — 그 줄을 복사해 터미널에서 실행하면 다른 곳에 저장됐다.
 *
 * 이 파일이 형식을 고정한다. gui 는 cli 를 import 하지 않으므로(의존 방향은 cli → gui → core)
 * 컴파일러가 플래그 이름을 지켜 주지 못한다 — CLI 의 플래그를 고치면 여기도 고쳐야 한다.
 */

const req = {
  serial: 'R3CT0000003',
  packageName: 'com.airbnb.android',
  name: null,
  launch: true,
  force: true,
}

describe('start', () => {
  it('서버가 정한 저장 위치를 그대로 적는다', () => {
    // 이 한 줄이 예전 결함의 회귀 방어다.
    expect(startCommandLine(req, '/tmp/내결과')).toContain('-o /tmp/내결과')
  })

  it('이름이 없으면 --name 을 붙이지 않는다', () => {
    expect(startCommandLine(req, 'runs')).not.toContain('--name')
    expect(startCommandLine({ ...req, name: '  ' }, 'runs')).not.toContain('--name')
    expect(startCommandLine({ ...req, name: '홈 스크롤' }, 'runs')).toContain('--name "홈 스크롤"')
  })

  it('끈 플래그는 나타나지 않는다', () => {
    const line = startCommandLine({ ...req, launch: false, force: false }, 'runs')
    expect(line).not.toContain('--launch')
    expect(line).not.toContain('--force')
  })

  it('전체 형식', () => {
    expect(startCommandLine(req, 'runs')).toBe(
      'perftracker start --app "com.airbnb.android" -d R3CT0000003 --launch --force -o runs',
    )
  })
})

describe('stop · abort · mark', () => {
  it('offline 은 켠 만큼만 담는다', () => {
    expect(stopCommandLine('S1', false)).toBe('perftracker stop -d S1')
    expect(stopCommandLine('S1', true)).toBe('perftracker stop -d S1 --offline')
  })

  it('세션을 버리는 것은 CLI 에 같은 명령이 없다는 사실을 적는다', () => {
    // 없는 명령을 있는 것처럼 적으면 사람이 그것을 찾다가 못 찾는다.
    expect(abortCommandLine('S1')).toContain('기록을 만들지 않고 버림')
  })

  it('마킹은 기기까지 적는다 — 세션이 여럿일 수 있다', () => {
    expect(markCommandLine('스크롤 시작', 'S1')).toBe('perftracker mark "스크롤 시작" -d S1')
  })
})
