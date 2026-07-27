/**
 * **데이터 모델** — 카운터 원본을 읽은 결과. 단위는 커널이 준 그대로(나노초).
 * ms 변환도, 사용률 백분율도 도메인 계층의 몫이다.
 *
 * 현재 경로는 perfetto `linux.sys_stats`(기기 전역) + `linux.process_stats`(앱) 하나다.
 * `cpu.times.*` 와 `runtime.*` 는 둘 다 **누적값**이라 차이만 의미가 있다 — 그 사실이
 * 이 모델의 모든 필드에 걸린다.
 */
export interface CpuTimeRow {
  cpu: number
  counter: string
  first: number
  last: number
  first_ts: number
  last_ts: number
  samples: number
}

export interface CpuFreqRow {
  cpu: number
  samples: number
  min_khz: number
  max_khz: number
  avg_khz: number
}

export interface AppCpuRow {
  upid: number
  counter: string
  first: number
  last: number
  samples: number
  first_ts: number
  last_ts: number
}

/** 앱 CPU 의 초별 누적값 `[상대초, user+kernel ns]`. 델타 변환은 도메인 계층이 한다. */
export type AppCpuTimelineRow = [number, number]
