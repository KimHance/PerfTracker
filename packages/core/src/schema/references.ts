import type { Reference } from './result.js'

/**
 * 구글이 공개한 기준치. 여기 있는 값들은 비교에 쓰이지 않고 그대로 기록만 된다.
 * 판정이 필요하면 별도 check 명령이 이 값을 소비한다.
 */
export const REFERENCES: Reference[] = [
  {
    metric: 'hwui',
    name: '60fps frame budget',
    value: 16.67,
    unit: 'ms',
    source: 'Android Vitals — slow rendering',
    url: 'https://developer.android.com/topic/performance/vitals/render',
  },
  {
    metric: 'hwui',
    name: 'frozen frame threshold',
    value: 700,
    unit: 'ms',
    source: 'Android Vitals — frozen frames',
    url: 'https://developer.android.com/topic/performance/vitals/frozen',
  },
  {
    metric: 'startup',
    name: 'excessive cold startup time',
    value: 5000,
    unit: 'ms',
    source: 'Android Vitals — app startup time',
    url: 'https://developer.android.com/topic/performance/vitals/launch-time',
  },
  {
    metric: 'startup',
    name: 'excessive warm startup time',
    value: 2000,
    unit: 'ms',
    source: 'Android Vitals — app startup time',
    url: 'https://developer.android.com/topic/performance/vitals/launch-time',
  },
  {
    metric: 'startup',
    name: 'excessive hot startup time',
    value: 1500,
    unit: 'ms',
    source: 'Android Vitals — app startup time',
    url: 'https://developer.android.com/topic/performance/vitals/launch-time',
  },
  {
    metric: 'network',
    // 원문 제목이 "Excessive **Mobile** Network Usage in Background" 이고, 기준 문장도
    // "sending and receiving a combined total of 50 MB per day while running in the
    // **background**" 다. 이름에서 `background` 도 `mobile` 도 빼지 않는다 —
    // `metrics.network` 는 **포그라운드 세션**의 **전 인터페이스(loopback 포함) 합계**라
    // 두 축 모두 차원이 다르고, 이름이 그 사실을 들고 다녀야 한다.
    name: 'excessive background mobile network usage',
    value: 50,
    // **단위가 계약이다.** `MB` 라고 쓰면 소비자가 "18MB < 50MB 니까 괜찮다" 로 읽는데,
    // 이 기준은 하루 합계이고 이 도구가 재는 것은 수십 초짜리 세션이다. 차원이 다르다.
    unit: 'MB/day',
    source: 'Android Vitals — Excessive Mobile Network Usage in Background',
    url: 'https://developer.android.com/topic/performance/vitals/bg-network-usage',
  },
]

// **thermal 의 기준선은 없다.** 온도에 대한 구글의 공개 수치 기준을 찾지 못했다 — CDD 에도
// 해당 요구사항 ID 가 없다. ADPF 의 thermal headroom 휴리스틱(0.85 / 0.95 / 1.0)은 출처가
// 있지만 **이 도구는 headroom 을 산출하지 않는다** (앱 프로세스 안에서
// `PowerManager.getThermalHeadroom()` 으로만 얻을 수 있고, 이 도구는 앱에 코드를 넣지 않는다).
// 산출하지 않는 값의 기준선을 싣는 것은 소비자를 오도한다.
//
// 그래서 이 배열의 규칙은 하나다: **출처 URL 이 없는 항목은 넣지 않는다.** 없으면 없다고
// 쓰는 것이 근거 없는 숫자를 옆에 놓는 것보다 정직하다 — 근거 없는 기준선은 곧 판정이다.
