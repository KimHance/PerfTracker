# Report Readability.dc.html — 고침 5 (구현 뒤 결정 맞춤 · ⑨ 승격 · plan B37 · B40 · B42)

구현(bp-gui-report 4d578ea · rr-layout)이 시안과 다르게 정한 셋을 시안에 옮겼다. 손으로 고침 (edit_file) — 생성 0.

1. **위치 행 한 번 (B42)** — `compileCard`: 그 dex 줄이 있는 때의 `location` 이 **글자 그대로 모두 같으면** (null 은 null 끼리 · 정규화 0) 머리 행 바로 아래 한 줄 `파일 위치 location {원문}` (`.rp-dex-loc-one` · 단어 13px `neutral-700` · 이름 · 값 12px 등폭 `neutral-600`) · 때 행 아래 위치 행 없음. 하나라도 다르면 지금처럼 때 행마다 두 줄 라벨 위치 행.
2. **깃발 토큰 nowrap (B40)** — `보낸 명령` 을 공백으로 나눈 토큰 가운데 `-` 로 시작하는 것(`-m` · `-f` · `--reset`)은 `.rp-nobr` 로 통째, 나머지는 구분자 뒤 `<wbr>` (`cmdWrap`). 글자 · 복사 원문 그대로.
3. **전/후 표 `[]` → `항목 없음` (B37)** — `온도 (세션 전 → 후)` 의 `zones` 가 `[]` 이면 빈 표 대신 `항목 없음` (배지에 안 셈). 클러스터 주파수(`device_frequency`) 카드는 이 시안에 없다 — 구현에만 있음 (그 `[]` 도 `항목 없음`).
4. CSS (`report-rr.css`): `.rp-dex-head:has(+ .rp-dex-loc-one) td { border-bottom: 0 }` · `.rp-dex-loc-one td { padding-top: 0 }` · `.rp-nobr { white-space: nowrap }` — 구현 `report.css` 와 같은 규칙.

핸드오프 사진(`design_handoff_*/screenshots/`)은 시안 캡처가 아니라 **구현 실렌더**로 바꿨다 — 실기기 YouTube (SM-S901N · sdk 36 · 2026-10-11) 와 bp-gui-report 검수 사진.
