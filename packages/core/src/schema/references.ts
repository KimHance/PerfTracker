import type { Reference } from './result.js'

/**
 * 구글이 공개한 기준치. 여기 있는 값들은 비교에 쓰이지 않고 그대로 기록만 된다.
 * 판정이 필요하면 별도 check 명령이 이 값을 소비한다.
 */
export const REFERENCES: Reference[] = [
  {
    metric: 'frame',
    name: '60fps frame budget',
    value: 16.67,
    unit: 'ms',
    source: 'Android Vitals — slow rendering',
    url: 'https://developer.android.com/topic/performance/vitals/render',
  },
  {
    metric: 'frame',
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
]
