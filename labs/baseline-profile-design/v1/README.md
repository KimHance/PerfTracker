# baseline-profile 시안 v1

디자인 문서: `docs/design/baseline-profile.md`. 보고서 쪽 시안(컴파일 상태 카드 · 진단 ART 칸)은 보고서 가독성과 같은 파일이라
`labs/report-readability-design/v1/` 에 있다 (`Report Readability.dc.html?state=compile` · `end-null` · `legacy` · `diag` · `diag-noapp`).

| 파일 | 무엇 |
|---|---|
| `gen_cli.py` | CLI 6블록 시안 생성기 → `cli/blocks.txt` (새 문구 상수 = 디자인 문서 `## 문구` cli 줄) |
| `check_cli.py` | `+` 줄 80칸 · `>` 되돌림 줄 호스트 꼴 · DM-15 단어형 · 판정 낱말 (`--break` 로 깨 봄) |
| `cli/blocks.txt` | 같은 글이 Claude Design `design_handoff_baseline-profile/cli-blocks.txt` 에도 있다 |

```bash
python3 -I labs/baseline-profile-design/v1/gen_cli.py
python3 -I labs/baseline-profile-design/v1/check_cli.py           # 새 줄 24 · 80칸 안 최대 78 · 되돌림 줄 최대 102칸 · 걸림 0
python3 -I labs/baseline-profile-design/v1/check_cli.py --break   # 표본 35 · 안 걸림 0
```

값은 실측(2026-10-11 SM-S901N R5CT0000001 · YouTube · research-baseline A · C · F) 꼴이고 run 디렉토리 · id 는 지은 값.
