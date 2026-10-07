#!/usr/bin/env python3
"""시안 사진 검사 — 시안 예산(상태 × 폭) 칸마다 사진이 있고 폭이 맞는가 · 보고서 390 가로 넘침 0.

  python3 labs/diagnostic-mode-design/v1/check_shots.py      # 0 = 통과

사진은 shoot.md 의 playwright 절차가 만든다. 390 가로 넘침은 그 절차가 상태마다 잰
`document.documentElement.scrollWidth - clientWidth` 를 shots/overflow-390.txt 에 남긴 값이다.
"""
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).parent
MEASURE = ['toggle-off', 'toggle-on', 'doctor-sdk30', 'running', 'running-unknown', 'drawer']
REPORT = ['summary', 'diag', 'sorted', 'open-null', 'no-process', 'failed']
BUDGET = [(f'measure-{s}-{w}.png', w) for s in MEASURE for w in (1440, 924)] + \
         [(f'report-{s}-{w}.png', w) for s in REPORT for w in (1440, 390)]


def png_width(p: pathlib.Path) -> int:
    with p.open('rb') as f:
        head = f.read(24)
    return struct.unpack('>I', head[16:20])[0]


def main() -> int:
    bad = 0
    for name, w in BUDGET:
        p = HERE / 'shots' / name
        if not p.exists():
            print(f'XX  없음      {name}')
            bad += 1
            continue
        got = png_width(p)
        ok = w - 10 <= got <= w   # fullPage 사진은 세로 스크롤 막대 10px 만큼 좁다 (app.css ::-webkit-scrollbar)
        bad += 0 if ok else 1
        print(f'{"OK" if ok else "XX"}  폭 {got:4}  {name}')
    ov = HERE / 'shots' / 'overflow-390.txt'
    lines = ov.read_text(encoding='utf-8').split('\n') if ov.exists() else []
    seen = {}
    for line in filter(None, lines):
        state, diff = line.split()
        seen[state] = int(diff)
    for s in REPORT:
        d = seen.get(s)
        ok = d == 0
        bad += 0 if ok else 1
        print(f'{"OK" if ok else "XX"}  390 가로 넘침 {d if d is not None else "못 잼"}  report-{s}')
    print(f'\n사진 {len(BUDGET)}칸 · 390 넘침 {len(REPORT)}칸 · 어긋남 {bad}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
