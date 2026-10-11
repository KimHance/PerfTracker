#!/usr/bin/env python3
"""시안 사진 · 글자 측정 검사 — shoot.mjs 가 남긴 shots/measure.json 과 사진 16장.

RR-1 12px 미만 글자 0% · RR-2 4.5:1 미만 글자 0% · RR-3 층 순서 (타일 값 > 섹션 > 카드 제목 > 본문 · 이웃 차 ≥ 2) ·
390 페이지 가로 넘침 0 · 상태 8 × 폭 2 사진이 다 있다.

  python3 labs/report-readability-design/v1/check_shots.py [<사진 폴더>]   # 기본 v1/shots
  python3 labs/report-readability-design/v1/check_shots.py --break          # 깬 측정값이 걸리는지
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
STATES = ['summary', 'missing', 'compile', 'end-null', 'legacy', 'device', 'diag', 'diag-noapp']
WIDTHS = [1440, 390]


def problems(key: str, m: dict) -> list[str]:
    out = []
    if m['under12_pct'] > 0:
        out.append(f"12px 미만 {m['under12_pct']}% (최소 {m['min_px']}px)")
    if m['under45_pct'] > 0:
        out.append(f"4.5:1 미만 {m['under45_pct']}% (최소 {m['min_ratio']})")
    lay = m['layers']
    order = [('section', 'card_title'), ('card_title', 'body')]
    for hi, lo in order:
        if lay.get(hi) is not None and lay.get(lo) is not None and lay[hi] - lay[lo] < 2:
            out.append(f'층 {hi} {lay[hi]} − {lo} {lay[lo]} < 2')
    if lay.get('tile_value') is not None and lay.get('section') is not None and key.startswith(('summary', 'missing', 'compile', 'end-null', 'legacy')):
        if lay['tile_value'] <= lay['section']:
            out.append(f"타일 값 {lay['tile_value']} ≤ 섹션 {lay['section']}")
    if key.endswith('-390') and m['overflow_x'] != 0:
        out.append(f"390 가로 넘침 {m['overflow_x']}px")
    return out


def main() -> int:
    if '--break' in sys.argv:
        good = {'under12_pct': 0, 'under45_pct': 0, 'min_px': 12, 'min_ratio': 5.5, 'overflow_x': 0,
                'layers': {'tile_value': 31, 'section': 18, 'card_title': 15, 'body': 13}}
        bad = [
            {**good, 'under12_pct': 0.1},
            {**good, 'under45_pct': 2.0},
            {**good, 'layers': {**good['layers'], 'card_title': 14}},
            {**good, 'layers': {**good['layers'], 'section': 16}},
            {**good, 'layers': {**good['layers'], 'tile_value': 18}},
            {**good, 'overflow_x': 3},
        ]
        missed = [b for b in bad if not problems('summary-390', b)]
        clean = problems('summary-390', good)
        print(f'--break 표본 {len(bad)} · 안 걸림 {len(missed)} · 멀쩡한 표본 걸림 {len(clean)}')
        return 1 if missed or clean else 0
    shots = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'shots'
    data = json.loads((shots / 'measure.json').read_text(encoding='utf-8'))
    bad = 0
    for s in STATES:
        for w in WIDTHS:
            key = f'{s}-{w}'
            if not (shots / f'report-{key}.png').exists():
                bad += 1
                print(f'{key}: 사진 없음')
            if key not in data:
                bad += 1
                print(f'{key}: 측정 없음')
                continue
            for p in problems(key, data[key]):
                bad += 1
                print(f'{key}: {p}')
    print(f'상태 {len(STATES)} × 폭 {len(WIDTHS)} · 걸림 {bad}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
