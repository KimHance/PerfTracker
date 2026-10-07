import { describe, expect, it } from 'vitest'
// gui 의 웹 소스와 서버의 실행 줄은 gui 패키지 exports(`.` = 서버 진입점) 밖이다 — 상대 경로로 읽는다.
// 방향은 cli → gui 라 규칙 4 를 깨지 않는다 (gui 는 cli 를 모르므로 이 대조는 cli 쪽에만 둘 수 있다).
import { startCommandLine } from '../../gui/src/server/command.js'
import { startPreview } from '../../gui/src/web/format/preview.js'
import { newTab } from '../../gui/src/web/state/model.js'
import { buildProgram } from '../src/program.js'

/**
 * **GUI 가 적는 `start` 명령의 플래그 철자가 CLI 에 등록된 옵션과 같은가** (DM-2).
 *
 * 시작 바의 예고(`format/preview.ts`)와 서버가 적는 실행 줄(`server/command.ts`)은 사람이 복사해
 * 터미널에서 다시 돌리는 줄이다. gui 는 cli 를 import 하지 않으므로 컴파일러가 철자를 지켜 주지
 * 못하고, `--diagnose` 를 `--diagnostic` 으로 적어도 화면은 멀쩡히 뜬다 — 그 줄을 복사한 사람만
 * `unknown option` 을 본다. 그래서 commander 가 **실제로 등록한** `start` 옵션 트리와 대조한다.
 */

function startCommand() {
  const start = buildProgram().commands.find((c) => c.name() === 'start')
  if (start === undefined) throw new Error('start 명령이 등록돼 있지 않다')
  return start
}

/** `start` 에 등록된 플래그 — 긴 이름과 짧은 이름 둘 다 (`--device` · `-d`). */
function registeredFlags(): Set<string> {
  const flags = new Set<string>()
  for (const o of startCommand().options) {
    if (o.long) flags.add(o.long)
    if (o.short) flags.add(o.short)
  }
  return flags
}

/** 줄에서 플래그 토큰만 — 따옴표 안의 값(`--name "a --b"`)은 플래그가 아니다. */
function flagsIn(line: string): string[] {
  return line
    .replace(/"[^"]*"/g, '""')
    .split(/\s+/)
    .filter((t) => /^--?[A-Za-z]/.test(t))
}

/** 등록되지 않은 플래그. 빈 배열이면 철자가 전부 맞다. */
function unregistered(line: string): string[] {
  const known = registeredFlags()
  return flagsIn(line).filter((f) => !known.has(f))
}

/** 켤 수 있는 것을 전부 켠 탭 — 예고에 나올 수 있는 플래그가 한 줄에 다 나온다. */
const allOn = { ...newTab('t'), serial: 'S1', packageName: 'com.x', name: '홈 --스크롤', launch: true, force: true, diagnose: true }

describe('DM-2 예고 철자 = 등록 옵션', () => {
  it('DM-2 예고 철자 = 등록 옵션 — 시작 바 예고의 플래그가 전부 start 에 등록돼 있다', () => {
    const preview = startPreview(allOn, 'runs')

    expect(preview.startsWith('perftracker start ')).toBe(true)
    expect(unregistered(preview)).toEqual([])
  })

  it('DM-2 예고 철자 = 등록 옵션 — 진단을 켠 예고의 --diagnose 가 start 의 등록 옵션이다', () => {
    expect(flagsIn(startPreview(allOn, 'runs'))).toContain('--diagnose')
    expect(registeredFlags()).toContain('--diagnose')
  })

  it('DM-2 예고 철자 = 등록 옵션 — 서버가 적는 실행 줄의 플래그도 전부 start 에 등록돼 있다', () => {
    const line = startCommandLine(
      { serial: 'S1', packageName: 'com.x', name: '홈', launch: true, force: true, diagnose: true },
      'runs',
    )

    expect(flagsIn(line)).toContain('--diagnose')
    expect(unregistered(line)).toEqual([])
  })

  it('DM-2 예고 철자 = 등록 옵션 — 대조가 실제로 돌아야 이 시험이 의미를 갖는다', () => {
    // 플래그를 못 읽으면 위 단언은 빈 배열끼리 통과한다. 예고는 지금 일곱 (--diagnose --app --name -d
    // --launch --force -o) · 따옴표 안의 `--스크롤` 은 세지 않는다.
    expect(flagsIn(startPreview(allOn, 'runs'))).toEqual(['--diagnose', '--app', '--name', '-d', '--launch', '--force', '-o'])
    expect(registeredFlags().size).toBeGreaterThanOrEqual(7)
  })

  /** 깨 봄 — 철자가 하나만 달라도 걸린다. 검사기가 실패할 수 있다는 것이 증거다. */
  it.each([
    ['--diagnostic', (l: string) => l.replace('--diagnose', '--diagnostic')],
    ['--diagnoze', (l: string) => l.replace('--diagnose', '--diagnoze')],
    ['--device-serial', (l: string) => l.replace('-d ', '--device-serial ')],
  ])('DM-2 예고 철자 = 등록 옵션 — 깨 봄: %s', (flag, mutate) => {
    expect(unregistered(mutate(startPreview(allOn, 'runs')))).toEqual([flag])
  })
})
