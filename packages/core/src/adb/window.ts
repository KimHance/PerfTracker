import { MeasurementWindowViolationError } from '../errors.js'

/**
 * 측정 창. 열려 있는 동안 기기 접촉을 금지한다 (규칙 1).
 * start 가 끝날 때 열리고 stop 이 시작될 때 닫힌다.
 */
export class MeasurementWindow {
  #open = false
  #adbCallsWhileOpen = 0

  open(): void {
    this.#open = true
  }

  close(): void {
    this.#open = false
  }

  get isOpen(): boolean {
    return this.#open
  }

  /** 측정 창 안에서 시도된 adb 호출 수. 0 이 아니면 그 세션 데이터는 오염된 것이다. */
  get adbCallsWhileOpen(): number {
    return this.#adbCallsWhileOpen
  }

  assertClosed(description: string): void {
    if (!this.#open) return
    this.#adbCallsWhileOpen += 1
    throw new MeasurementWindowViolationError(description)
  }
}
