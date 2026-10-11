/**
 * 진단 모드가 **보고서에 새로 내는** 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/diagnostic-mode.md` 의 `## 문구` 표다** (기능 문서
 * 결정 9 · DM-15). 표의 gui 보고서 줄과 이 모음은 양방향으로 같아야 한다 — 표에만 있거나 여기에만
 * 있는 문구가 생기면 `test/report-copy.test.ts` 가 깨진다. 문구를 바꾸려면 표를 먼저 고친다.
 *
 * 문구 꼴은 문장이 아니라 단어다 (DM-15). 기존 보고서 문구(`값 없음` · `수집 안 함` · 카드 제목)는
 * 대상이 아니다 (plan D10). 카드 안 라벨은 스키마 필드 경로 그대로라(`atrace_categories` …) 이 모음
 * 밖이다 — 이름의 정본은 README 다.
 *
 * 측정 화면의 진단 문구(04 옵션 행 · 탭 배지 · 킥커 · 각주 · 드로어 꼬리)는 여기 없다 — 그 화면의 몫이다.
 */
export const DIAGNOSE_REPORT_COPY = {
  /** 레일 세 번째 탭 — 진단 세션에만. */
  tab: '진단',
  /** 머리의 상태 pill 옆 pill — 진단 세션에만. */
  headPill: '진단',
  /** 진단 탭의 섹션 머리. */
  section: 'atrace slice',
  /** 카드 제목 — 켠 카테고리 · 대상 앱 · 앱 slice 열림. */
  cardScope: '기록 범위',
  /** 카드 제목 — 수 칸들. */
  cardCounts: 'slice 수',
  /** 카드 제목 — 원본 경로 · 크기. */
  cardSource: '원본',
  /** 카드 제목 — 접은 이름별 표. */
  cardNames: 'slice 이름별',
  /** slice 표 카드 단위. `{n}` = 행 수 (= 접은 이름 수). 프레임워크와 앱 slice 를 가르지 않는다 (결정 8). */
  tableUnit: '대상 앱 프로세스 · {n}행',
  /** slice 표 머리 — 접은 이름. */
  colName: '이름',
  /** slice 표 갈래 머리 — tid = pid. */
  groupMain: '메인 스레드',
  /** slice 표 갈래 머리 — 대상 앱의 다른 스레드. */
  groupOther: '그 밖 스레드',
  /** slice 표 갈래 머리 — 프로세스 비동기 트랙. */
  groupAsync: '비동기 트랙',
  /** slice 표 열 머리 — 끝나지 않은 slice 포함. */
  colCount: '횟수',
  /** slice 표 열 머리 — 끝난 slice 의 합. */
  colSum: '합 ms',
  /** slice 표 열 머리 — 끝난 slice 의 최대. */
  colMax: '최대 ms',
  /** slice 표 빈 칸 — 그 갈래에 그 이름 slice 없음. `0` 이 아니다. */
  empty: '—',
  /** 정렬된 열의 표시 (오름). */
  sortAsc: '▲',
  /** 정렬된 열의 표시 (내림). */
  sortDesc: '▼',
  /** 측정 비용 카드 단위 — 진단 세션에만 (DM-13 · DM-14). */
  overheadUnit: '앱 프로세스 몫 미포함',
} as const

/** `{이름}` 자리를 채운다. 모르는 자리는 그대로 둔다 — 빈칸으로 지우면 문구가 거짓이 된다. */
export function fillReportCopy(copy: string, values: Record<string, string>): string {
  return copy.replace(/\{([^}]+)\}/g, (whole, key: string) => values[key] ?? whole)
}
