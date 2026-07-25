import { MeasurementWindowViolationError } from '../errors.js'

/** 창이 열려 있는 동안 시도된 adb 호출을 프로세스 밖에 기록하고 싶을 때 쓰는 훅. */
export type ViolationRecorder = (attempted: string) => void

/**
 * 측정 창. 열려 있는 동안 기기 접촉을 금지한다 (규칙 1).
 * start 가 끝날 때 열리고 stop 이 시작될 때 닫힌다.
 *
 * 창 자체는 프로세스 메모리 안의 상태다. `start` 와 `stop` 은 서로 다른 프로세스이므로,
 * 세션 전체에 걸친 래치가 되려면 두 가지가 필요하다:
 *   1) 새 프로세스가 활성 세션 포인터를 읽고 창을 열린 상태로 복원한다 (`createAdbContext`)
 *   2) 위반 횟수를 그 포인터에 누적한다 (`onViolation` → `recordAdbViolation`)
 * 이게 없으면 `adbCallsWhileOpen` 은 `start` 반환 이후 영원히 0 인 죽은 값이다.
 */
export class MeasurementWindow {
  #open = false
  #adbCallsWhileOpen = 0
  #onViolation: ViolationRecorder | undefined

  /** 훅은 창을 여는 쪽이 안다 (어느 기기의 세션인지). 그래서 생성자가 아니라 open 이 받는다. */
  open(onViolation?: ViolationRecorder): void {
    this.#open = true
    this.#onViolation = onViolation
  }

  close(): void {
    this.#open = false
    this.#onViolation = undefined
  }

  get isOpen(): boolean {
    return this.#open
  }

  /** 이 프로세스에서 측정 창 안에 시도된 adb 호출 수. 0 이 아니면 그 세션 데이터는 오염된 것이다. */
  get adbCallsWhileOpen(): number {
    return this.#adbCallsWhileOpen
  }

  assertClosed(description: string): void {
    if (!this.#open) return
    this.#adbCallsWhileOpen += 1
    try {
      this.#onViolation?.(description)
    } catch {
      // 기록 실패가 차단을 가려서는 안 된다.
    }
    throw new MeasurementWindowViolationError(description)
  }
}
