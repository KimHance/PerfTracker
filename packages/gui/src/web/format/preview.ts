import type { Tab } from '../state/model.js'

/**
 * 하단 시작 바의 **예고**. "이 버튼을 누르면 이렇게 됩니다" 이지 "이렇게 했습니다" 가 아니다.
 *
 * ## 왜 이것만 화면이 만드는가
 *
 * 아직 실행 전이라 서버에게 물어볼 것이 없다. 나머지(시작·정지·마킹)는 전부 **서버가 자기가
 * 한 일을 응답에 실어 보내고** 화면은 그것을 그대로 CLI 로그에 찍는다 — 화면이 조립하던
 * 시절에는 `gui -o /tmp/x` 로 띄워도 로그에 `-o runs` 가 찍혔고, 그 줄을 복사해 실행하면
 * 다른 곳에 저장됐다.
 *
 * 그래서 이 함수의 이름은 `command` 가 아니라 `preview` 다. 예고와 기록은 다른 것이고,
 * 예고가 틀리는 것과 기록이 틀리는 것은 무게가 다르다.
 *
 * `outDir` 은 여기서도 **서버가 준 값**을 받는다 (`EnvView.outDir`). 화면이 정하지 않는다.
 */
export function startPreview(tab: Tab, outDir: string): string {
  const parts = ['perftracker start']
  parts.push(`--app "${tab.packageName ?? '<미선택>'}"`)
  if (tab.name.trim() !== '') parts.push(`--name "${tab.name.trim()}"`)
  parts.push(`-d ${tab.serial ?? '<미선택>'}`)
  if (tab.launch) parts.push('--launch')
  if (tab.force) parts.push('--force')
  parts.push(`-o ${outDir}`)
  return parts.join(' ')
}
