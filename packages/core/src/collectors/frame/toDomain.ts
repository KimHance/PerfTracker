import type { FrameData } from '../../schema/result.js'
import type { FrameSample } from './model.js'

/**
 * **표본 상한.** 세션 상한이 30분이고 120Hz 면 최악 216,000장인데 현재 `result.json` 은
 * 48KB 다. 상한이 없으면 파일이 지표가 아니라 원본 덤프가 된다.
 *
 * 5,000 인 이유: 60초 세션(120Hz 최악 7,200장)에서 버킷이 12ms 라 사실상 무손실이고,
 * 화면도 횡스크롤로 5,000막대를 넘겨 그릴 이유가 없다.
 */
export const MAX_SAMPLES = 5000

/**
 * **버킷마다 가장 오래 걸린 프레임을 남긴다.** 매 N번째를 고르는 균등 추출은 스파이크를
 * 놓치는데, 이 화면의 목적이 정확히 스파이크를 보는 것이라 그 방식은 쓰지 않는다.
 *
 * 표본을 뽑았다는 사실은 `sampling` · `bucket_ms` · `frames_seen` 으로 **결과에 적힌다.**
 * 조용히 자르지 않는다.
 */
export function toFrameData(samples: FrameSample[]): FrameData {
  const row = (f: FrameSample): [number, number, number | null, number | null] => [
    f.tMs,
    f.appMs,
    f.presentMs,
    f.deadlineMs,
  ]

  if (samples.length <= MAX_SAMPLES) {
    return {
      samples: samples.map(row),
      sampling: 'all',
      bucket_ms: null,
      frames_seen: samples.length,
    }
  }

  const total = (f: FrameSample): number => f.appMs + (f.presentMs ?? 0)
  const first = samples[0]!.tMs
  const last = samples[samples.length - 1]!.tMs
  const bucketMs = Math.max(1, Math.ceil((last - first + 1) / MAX_SAMPLES))

  const best = new Map<number, FrameSample>()
  for (const f of samples) {
    const key = Math.floor((f.tMs - first) / bucketMs)
    const cur = best.get(key)
    // 고를 때만 null 을 0 으로 친다. **싣는 값은 null 그대로다** — 비교를 위해 잠깐 0 으로
    // 읽는 것과 결과에 0 을 적는 것은 다른 일이다.
    if (cur === undefined || total(f) > total(cur)) best.set(key, f)
  }

  return {
    samples: [...best.values()].sort((a, b) => a.tMs - b.tMs).map(row),
    sampling: 'max_per_bucket',
    bucket_ms: bucketMs,
    frames_seen: samples.length,
  }
}
