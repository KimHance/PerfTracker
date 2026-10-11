# Report Readability.dc.html — 고침 2 (기기 · 진단 대상 앱 없음 사진을 보고)

고침 1 은 아홉 다 맞다. 아래 다섯은 **지금 코드와 달라진 곳**이라 되돌린다 — 이번 기능이 바꾸는 것이 아니다. 나머지는 그대로.

1. **기기 카드** — `시리얼` 행을 지운다 (지금 코드 기기 카드에 없는 행 · serial 은 머리 메타에만). 행은 제조사 · 모델 · Android · SDK 버전/`sdk_int` · SoC · SoC 제조사 · 메모리 · ABI · 빌드 지문/`fingerprint`.
2. **정수 포맷** — `int` 는 천 단위 쉼표: `versionCode` `1,561,186,612` (지금 `1561186612`). `uid` · `pid` 는 지금 코드처럼 쉼표 없이 원문 (`raw`).
3. **목록 포맷** — `list` 는 지금 코드처럼 `, ` 로 잇는다: ABI `arm64-v8a, armeabi-v7a, armeabi` · 지원 주사율 `10, 24, 30, 48, 60, 96, 120` · uid 공유. ` · ` 는 `dots`(atrace 카테고리)에만.
4. **CPU 클러스터 최대 주파수 막대 값** — 단위를 붙인다 `1.79 GHz` (지금 코드 `ghz2`).
5. **진단 null 칸의 코드** — diag-noapp 의 `slice 수` 카드에서 `target_process_slices` · `…_unfinished` · `…_names_unfolded` 행은 `값 없음` **만** (코드 줄 없음 — report HANDOFF §4 「그 밖의 null 칸은 값 없음 만」). 코드는 자기 `_reason_code` 칸이 있는 자리에만: `app_slices_open` 행 · `JIT 컴파일 slice` 행(`target_process_jit_slices_reason_code`) · `slice 이름별` 표 · `컴파일 상태 slice` 카드. 블록 `partial` 이유는 카드 제목 `title` 로.
