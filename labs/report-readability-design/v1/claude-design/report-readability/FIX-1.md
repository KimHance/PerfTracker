# Report Readability.dc.html — 고침 1 (playwright 1440 · 390 사진을 보고)

숫자(12px 바닥 · AA · 층 · 390 넘침)는 16장 모두 통과했다. 아래는 **지금 코드와 달라진 곳**과 390 에서 깨진 곳이다. 이 아홉만 고친다 — 나머지는 그대로.

1. **렌더 카드 되돌림** — `HWUI 카운터` 한 장을 지우고 지금 코드의 두 장으로 (분포 span 12 아래 나란히 span 6 · 단위 `dumpsys gfxinfo` · 라벨은 기기 원문 그대로 한 줄):
   - `프레임 수` — `Total frames rendered` · `Janky frames` (+ 비율 칸 `total_frames` 분모) · `Frame deadline missed` (+ 비율 칸)
   - `원인별 횟수` — `Slow UI thread` · `Slow issue draw commands` · `Slow bitmap uploads` · `Missed Vsync` · `High input latency` (비율 없음)
   `Number …` 접두를 붙이지 않는다. 글자는 중립 색 (alt 글자 0) — 막대가 있으면 막대만 alt.
2. **기기 코어별 사용률 막대** — 채움을 `--color-accent` (opacity .7) 로. alt 흙색은 렌더 카드의 그림에만.
3. **logcat 카드** — 제목 `logcat 줄 수` · 단위 `metrics.log.data` (지금 코드 그대로).
4. **로그 섹션** — 빠진 두 카드를 logcat 카드 뒤에: `크래시` (span 2 · 단위 `logcat · 기기 전역` · `[]` 면 `크래시 없음`) · `ANR` (span 2 · 같은 단위 · `ANR 없음`). 배지에 안 셈.
5. **기기 상태 (전 → 후)** — 행 여덟 전부: 배터리 · 배터리 온도 · 충전 · 가용 메모리 · 밝기 · 절전 · 네트워크 · 애니메이션 배율.
6. **dexstates 표 (컴파일 상태 카드)** — ABI 는 dex 줄의 사실이라 **머리 행으로 옮긴다**: 경로 아래 한 줄 `arm64 · primary-abi` (13px 등폭 `neutral-800` · 단어 줄 없이 값만). 때 행 칸은 셋 — `때` · `컴파일 필터`/`status` · `컴파일 이유`/`reason`. 값 칸(`speed-profile` `profile-utilization` `primary-abi` 같은 토막)은 **`white-space: nowrap`** — 390 에서 `profile-utilizatio / n` · `primary- / abi` 처럼 끊기면 안 된다. 열 폭은 내용대로(`때` 열 고정 72px).
7. **시계열 x 눈금** — 마지막 눈금(`16s`)과 그 앞 정규 눈금(`15s`)이 겹친다 (`15s16s`). 끝 눈금과의 거리가 간격의 60% 보다 가까운 정규 눈금은 그리지 않는다. 1440 · 390 둘 다.
8. **타일 · unsupported** — status 가 unsupported · skipped · failed 인 타일(missing 의 `시간별 프레임` · `수신`)은 값 자리에 `값 없음` 이 아니라 **`reason_code` 자체**(`sdk_too_low`)를 18px heading `neutral-700` 로, 코드 줄은 비운다. `값 없음` + 코드는 값이 `null` 이고 status 가 collected · partial 일 때만 (`앱 CPU 시간` · `스로틀 종료`).
9. **`?shot`** — 상태 고르는 줄(`summary missing …` 칩)을 `?shot` 이 있으면 숨긴다. 지금은 페이지 가운데 떠 있다.
