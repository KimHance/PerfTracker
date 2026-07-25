import { type AdbContext, createAdbContext } from '@perftracker/core'

/**
 * adb 부트스트랩은 core 에 있다 — CLI 말고도 (계획된 GUI 포함) 소비자가 생기고,
 * 활성 세션이면 측정 창을 여는 규칙 1 래치가 바로 그 안에 있기 때문이다.
 * 여기 남은 것은 CLI 쪽 이름뿐이다.
 */
export type CliContext = AdbContext

export const createContext = createAdbContext
