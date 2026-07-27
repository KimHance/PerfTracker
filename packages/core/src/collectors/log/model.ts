/**
 * **데이터 모델** — 로그를 어디서 어떻게 꺼냈는지와 무관한 중간형.
 *
 * 현재 경로는 perfetto `android.log` 하나다. 우선순위는 안드로이드의 정수 그대로 담는다
 * (5=WARN, 6=ERROR, 7=FATAL) — 이름으로 바꾸는 것은 도메인 계층의 몫이고, 소스가 그것을
 * 미리 하면 새 소스마다 같은 매핑을 다시 쓰게 된다.
 */
export interface PriorityCount {
  prio: number
  count: number
}

/** 초당 로그 발생량. `second` 는 세션 시작으로부터의 상대 초. */
export interface LogRateSample {
  second: number
  count: number
  /** 그중 ERROR 이상(prio >= 6). */
  error: number
}

/** 크래시·ANR 후보 한 줄. **분류는 하지 않는다** — 그 규칙은 도메인 계층에 있다. */
export interface LogEventRow {
  tag: string
  msg: string
  /** 이 줄을 찍은 프로세스. `android_logs` 는 utid 만 갖고 있어 thread → process 를 거친다. */
  pid: number | null
  process: string | null
}

export interface AppLogCollection {
  process: string
  pid: number
  byPriority: PriorityCount[]
  rate: LogRateSample[]
}

export interface LogCollection {
  /** 기기 전역 개수. 앱을 특정하지 못해도 이것은 나온다. */
  devicePriority: PriorityCount[]
  events: LogEventRow[]
  /** 앱을 특정하지 못했으면 null. "0 줄" 과 다른 뜻이다. */
  app: AppLogCollection | null
}
