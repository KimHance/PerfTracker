import type { Tab } from '../state/model.js'

/**
 * 하단 시작 바에 띄우는 **실행될 명령**.
 *
 * 이 문자열은 장식이 아니다. GUI 가 무엇을 하는지 CLI 의 말로 그대로 보여 주는 것이고,
 * 사람이 그 줄을 복사해 터미널에서 그대로 재현할 수 있어야 한다. 그래서 아직 고르지 않은
 * 자리는 비워 두는 대신 `<미선택>` 으로 눈에 띄게 남긴다.
 *
 * `outDir` 을 탭이 아니라 **인자로** 받는 이유: 저장 위치는 서버가 정한다. 화면이 자기 값을
 * 들고 있으면 여기 찍히는 `-o` 와 실제 저장 위치가 어긋나고, 그러면 이 줄이 거짓말을 한다.
 */
export function startCommand(tab: Tab, outDir: string): string {
  const parts = ['npx perftracker start']
  parts.push(`--app "${tab.packageName ?? '<미선택>'}"`)
  if (tab.name.trim() !== '') parts.push(`--name "${tab.name.trim()}"`)
  parts.push(`-d ${tab.serial ?? '<미선택>'}`)
  if (tab.launch) parts.push('--launch')
  if (tab.force) parts.push('--force')
  parts.push(`-o ${outDir}`)
  return parts.join(' ')
}

export function stopCommand(tab: Tab): string {
  const parts = ['npx perftracker stop', `-d ${tab.serial ?? '<미선택>'}`]
  if (tab.offline) parts.push('--offline')
  return parts.join(' ')
}

/** CLI 로그에 남기는 마킹 줄. 실제로 기기에 나가는 명령이 아니라 사람이 남긴 사건이다. */
export function markCommand(label: string, elapsed: string): string {
  return `mark "${label}" @ ${elapsed}`
}
