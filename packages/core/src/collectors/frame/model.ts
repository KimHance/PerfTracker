/**
 * **데이터 모델** — 어느 안드로이드 버전에서, 어떤 명령으로 얻었는지와 무관한 중간형.
 *
 * 이 파일이 존재하는 이유: 프레임을 얻는 경로가 SDK 마다 다르다.
 *   - sdk 31+ : perfetto `android.surfaceflinger.frametimeline` (현재 유일한 경로)
 *   - sdk 30  : 그 데이터소스가 없다. `dumpsys gfxinfo framestats` 에 프레임별 타임스탬프가
 *               있지만 **버퍼가 방금 그린 몇 장뿐**이고(실측: A40 에서 2행 · 0.1초),
 *               세션 전체를 모으려면 측정 중 폴링해야 해서 규칙 1 을 깬다. 그래서 미지원이다.
 *
 * 경로가 늘어나도 **버킷·백분위·시계열 계산은 한 벌만 있으면 된다** — 그 계산은 이 모델만
 * 알면 되기 때문이다. 새 경로를 붙이는 사람은 `FrameSample[]` 을 만들어 주기만 하면 된다.
 */
export interface FrameSample {
  /** 세션 시작(트레이스 시작)으로부터 몇 초째인가. 시계열의 시간 축이 된다. */
  second: number
  /** 이 프레임이 실제로 걸린 시간(ms). 미완결 프레임은 이 배열에 들어오기 전에 걸러진다. */
  durationMs: number
}

/**
 * 수집 결과. **어느 프로세스의 것인지**까지 담는다 — 프레임은 프로세스를 특정하지 못하면
 * 값을 낼 수 없고, 그 특정은 소스마다 방법이 다르다(트레이스는 upid, gfxinfo 는 패키지명).
 */
export interface FrameCollection {
  /** 결과에 실을 프로세스 이름. 확인된 이름만 온다. */
  process: string
  pid: number
  samples: FrameSample[]
}
