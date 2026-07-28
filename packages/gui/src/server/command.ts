import type { StartRequest } from '../contract/api.js'

/**
 * **서버가 방금 한 일을 CLI 의 말로 옮긴다.**
 *
 * 화면의 CLI 로그와 로딩 오버레이에 찍히는 문자열이 여기서 나온다. 한동안 이것을 브라우저가
 * 스스로 조립했는데, 그러면 **화면이 서버가 무엇을 했는지 모르는 채로 그것을 적는다.**
 * 실제로 어긋났다: `gui -o /tmp/x` 로 띄워도 로그에는 `-o runs` 가 찍혔고, 그 줄을 복사해
 * 터미널에서 실행하면 다른 곳에 저장됐다. 이제 실행한 쪽이 적는다.
 *
 * **여기 적힌 플래그 이름은 `packages/cli` 의 것과 같아야 한다.** gui 는 cli 를 import 하지
 * 않으므로(의존 방향은 cli → gui → core) 컴파일러가 지켜 주지 못한다 —
 * `test/command.test.ts` 가 형식을 고정하고, CLI 의 플래그를 고치면 여기도 고쳐야 한다.
 */

export function startCommandLine(req: StartRequest, outDir: string): string {
  const parts = ['perftracker start', `--app "${req.packageName}"`]
  if (req.name !== null && req.name.trim() !== '') parts.push(`--name "${req.name.trim()}"`)
  parts.push(`-d ${req.serial}`)
  if (req.launch) parts.push('--launch')
  if (req.force) parts.push('--force')
  parts.push(`-o ${outDir}`)
  return parts.join(' ')
}

export function stopCommandLine(serial: string, offline: boolean): string {
  const parts = ['perftracker stop', `-d ${serial}`]
  if (offline) parts.push('--offline')
  return parts.join(' ')
}

/** 측정 중인 세션을 기록 없이 버릴 때. CLI 에 같은 일을 하는 명령은 없다 — 그 사실을 적는다. */
export function abortCommandLine(serial: string): string {
  return `perftracker stop -d ${serial}   # 기록을 만들지 않고 버림`
}

export function markCommandLine(label: string, serial: string): string {
  return `perftracker mark "${label}" -d ${serial}`
}
