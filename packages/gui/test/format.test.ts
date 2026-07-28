import { describe, expect, it } from 'vitest'
import type { DeviceView } from '../src/contract/api.js'
import { markCommand, startCommand, stopCommand } from '../src/web/format/command.js'
import { formatSpecLine, unsupportedCount } from '../src/web/format/device.js'
import { formatClock, formatElapsed, formatRunAt } from '../src/web/format/time.js'
import { newTab } from '../src/web/state/model.js'

describe('경과 시간', () => {
  it('한 시간을 넘기면 h:mm:ss 로 바뀐다', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(61_000)).toBe('01:01')
    expect(formatElapsed(3_599_000)).toBe('59:59')
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(3_661_000)).toBe('1:01:01')
  })

  it('음수는 0 으로 본다', () => {
    // 서버 시각 보정으로 시계가 뒤로 갈 때 `-1:59` 를 보여 줄 이유가 없다.
    expect(formatElapsed(-5000)).toBe('00:00')
  })
})

describe('기록 시각', () => {
  it('타임존으로 옮기지 않고 문자열을 자른다', () => {
    // Date 로 되돌리면 같은 세션이 브라우저 타임존에 따라 다른 시각으로 보인다.
    expect(formatRunAt('2026-07-27T18:05:39')).toBe('07/27 18:05')
    expect(formatRunAt('2026-01-02T00:00:00')).toBe('01/02 00:00')
  })

  it('모양이 다르면 원문을 그대로 낸다', () => {
    expect(formatRunAt('알 수 없음')).toBe('알 수 없음')
  })

  it('시계는 두 자리로 채운다', () => {
    expect(formatClock(new Date(2026, 6, 27, 9, 5, 3))).toBe('09:05:03')
  })
})

describe('실행될 명령', () => {
  it('아직 고르지 않은 자리는 <미선택> 으로 남는다', () => {
    // 사람이 그 줄을 복사해 터미널에서 재현할 수 있어야 하고, 빈칸은 재현되지 않는다.
    expect(startCommand(newTab('t'))).toBe(
      'npx perftracker start --app "<미선택>" -d <미선택> --launch --force -o runs',
    )
  })

  it('이름이 비면 --name 을 붙이지 않는다', () => {
    const tab = { ...newTab('t'), serial: 'S1', packageName: 'com.x', name: '   ' }
    expect(startCommand(tab)).not.toContain('--name')
  })

  it('끈 플래그는 나타나지 않는다', () => {
    const tab = { ...newTab('t'), serial: 'S1', packageName: 'com.x', launch: false, force: false }
    const command = startCommand(tab)
    expect(command).not.toContain('--launch')
    expect(command).not.toContain('--force')
  })

  it('정지 명령은 --offline 을 켠 만큼만 담는다', () => {
    const tab = { ...newTab('t'), serial: 'S1' }
    expect(stopCommand(tab)).toBe('npx perftracker stop -d S1')
    expect(stopCommand({ ...tab, offline: true })).toBe('npx perftracker stop -d S1 --offline')
  })

  it('마킹은 라벨과 경과를 함께 남긴다', () => {
    expect(markCommand('스크롤 시작', '00:07')).toBe('mark "스크롤 시작" @ 00:07')
  })
})

describe('기기 스펙 한 줄', () => {
  const base: DeviceView = {
    serial: 'S1',
    model: 'SM-F936N',
    state: 'device',
    spec: {
      androidRelease: '16',
      sdkInt: 36,
      socModel: 'SM8475',
      coreCount: 8,
      memoryTotalKb: 11 * 1024 * 1024,
      widthPx: 904,
      heightPx: 2316,
      refreshHz: 60,
    },
    measuring: false,
    metrics: [
      { id: 'frame', ok: true, reason: '측정 가능' },
      { id: 'network', ok: true, reason: '측정 가능' },
    ],
  }

  it('전부 아는 기기는 한 줄로 다 적는다', () => {
    expect(formatSpecLine(base)).toBe('Android 16 (SDK 36) · SM8475 · 8코어 · 11GB · 904x2316@60Hz')
  })

  it('모르는 SoC 는 감추지 않고 미상이라고 쓴다', () => {
    // 규칙 3: 모르는 것은 모른다고 쓴다. 감추면 "SoC 가 없다" 로 읽힌다.
    expect(formatSpecLine({ ...base, spec: { ...base.spec!, socModel: null } })).toContain('SoC 미상')
  })

  it('주사율을 못 읽었으면 @Hz 를 붙이지 않는다', () => {
    expect(formatSpecLine({ ...base, spec: { ...base.spec!, refreshHz: null } })).toContain('904x2316')
    expect(formatSpecLine({ ...base, spec: { ...base.spec!, refreshHz: null } })).not.toContain('@')
  })

  it('못 재는 지표를 줄 끝에 붙인다', () => {
    const line = formatSpecLine({
      ...base,
      metrics: [
        { id: 'frame', ok: false, reason: 'x' },
        { id: 'network', ok: false, reason: 'x' },
        { id: 'cpu', ok: true, reason: '측정 가능' },
      ],
    })
    expect(line).toContain('— frame·network 미지원')
  })

  it('측정 중이라 스펙을 안 읽은 것과 못 읽은 것을 구분한다', () => {
    expect(formatSpecLine({ ...base, spec: null, measuring: true })).toBe('측정 중이라 스펙을 읽지 않았습니다')
    expect(formatSpecLine({ ...base, spec: null, state: 'unauthorized' })).toContain('USB 디버깅')
  })

  it('미지원 지표 수를 센다', () => {
    expect(unsupportedCount(base.metrics)).toBe(0)
    expect(unsupportedCount([{ id: 'frame', ok: false, reason: 'x' }])).toBe(1)
  })
})
