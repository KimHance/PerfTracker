/**
 * 보고서 가독성(report-readability)이 **보고서에 새로 내거나 바꾸는** 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/report-readability.md` 의 `## 문구` 표다** (기능 문서 결정 7).
 * 표와 이 모음은 양방향으로 같아야 한다 — `test/report-copy.test.ts` 가 대조한다. 문구를 바꾸려면 표를 먼저
 * 고친다. 꼴은 문장이 아니라 단어다 (DM-15 단어형 · 결정 3).
 */
export const READABILITY_COPY = {
  /** 요약 탭 첫 섹션 머리 — 지표마다 타일 하나. */
  tilesSection: '지표',
  /** 타일 단어 — 보고서 섹션 순 (결정 9). */
  tileStartup: '앱 시작',
  tileHwui: '프레임 수',
  tileFrame: '시간별 프레임',
  tileCpu: '앱 CPU 시간',
  tileMemory: '앱 RSS 최대',
  tileLog: '앱 로그 줄',
  tileThermal: '스로틀 단계 · 종료',
  tileNetwork: '수신',
  /** 타일 덧단위 — 카드 값에 단위가 없는 둘. */
  unitFrames: '장',
  unitLines: '줄',
  /** 머리 메타 라벨 — `session.duration_ms`. */
  headDuration: '길이',
  /** 렌더 분포 각주. `{frames}` = `total_frames` · `{buckets}` = 버킷 수. */
  distFootnote: '{frames} 프레임 · 버킷 {buckets}칸',
  /** 시간별 프레임 각주 — 읽는 법 문장 자리. */
  timelineFootnote: '막대 = 프레임 · 아래 칸 앱 · 위 칸 표시 · 가로 = 트레이스 시작 뒤 시각',
  /** 시계열 카드 `[]` — 재 봤더니 0건. 배지에 안 셈. */
  emptySeries: '표본 없음',
  /** 분포 · 시간별 프레임 카드 `[]`. */
  emptyFrames: '프레임 없음',
  /** 막대 카드 `[]`. */
  emptyBars: '항목 없음',
} as const

/**
 * **경로 라벨의 단어 줄** (RR-6 · 결정 2). 키는 지금 라벨 문자열 그대로(경로 줄) — 바꾸지 않아 ⌘F · grep 이
 * 닿는다. 정본은 디자인 문서 `## 문구` 의 라벨 단어 표(와 `앱 RSS 구성` 새 행)이고, 매니페스트의 `w` 가 이
 * 모음을 쓴다. 기기 원문 라벨(`TotalTime` · `Janky frames` · `user` …)은 한 줄 그대로라 여기 없다.
 */
export const LABEL_WORDS = {
  pid: '프로세스 ID',
  uid: '사용자 ID',
  sdk_int: 'SDK 버전',
  fingerprint: '빌드 지문',
  versionCode: '버전 코드',
  debuggable: '디버그 빌드',
  largeHeap: '큰 힙',
  minSdk: '최소 SDK',
  targetSdk: '대상 SDK',
  min_prio: '최소 우선순위',
  'app.total': '앱 전체',
  'app.by_priority.warn': '앱 warn',
  'app.by_priority.error': '앱 error',
  'app.by_priority.fatal': '앱 fatal',
  device_total: '기기 전체',
  'device_by_priority.warn': '기기 warn',
  'device_by_priority.error': '기기 error',
  atrace_categories: '켠 카테고리',
  atrace_apps: '대상 앱',
  app_slices_open: '앱 slice 열림',
  trace_slices: '트레이스 전체',
  target_process_slices: '대상 앱',
  target_process_slices_unfinished: '끝나지 않음',
  target_process_slice_names_unfolded: '접기 전 이름 수',
  ftrace_overrun_events: 'ftrace 넘침',
  'artifacts.trace': '원본 파일',
  'diagnose.trace_bytes': '원본 크기',
  'rss.max_kb': 'RSS 최대',
} as const

