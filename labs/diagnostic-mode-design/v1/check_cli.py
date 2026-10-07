#!/usr/bin/env python3
"""CLI 글자 시안 검사 — `+` 줄(새 줄)이 80칸 안인가 (DM-11).

표시 폭은 packages/cli/src/commands/runs.ts displayWidth 와 같은 규칙 (한글 · 전각 2칸).
`*` 줄(마킹 있는 진단 행 86칸 — 기존 꼬리 79칸 + ` · 진단` · D33 받아들임)은 폭만 적고 실패로 세지 않는다 — 기준 줄은 `경고 N · 진단` 행.

  python3 labs/diagnostic-mode-design/v1/check_cli.py               # 0 = 통과
  python3 labs/diagnostic-mode-design/v1/check_cli.py --break       # 81칸 + 줄을 끼워 RED 를 본다
"""
import pathlib
import re
import sys

WIDE = re.compile('[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]')
LIMIT = 80


def width(s: str) -> int:
    return sum(2 if WIDE.match(c) else 1 for c in s)


def main() -> int:
    src = pathlib.Path(__file__).parent / 'cli' / 'blocks.txt'
    lines = src.read_text(encoding='utf-8').splitlines()
    if '--break' in sys.argv:
        lines.append('+ ' + 'x' * (LIMIT + 1))
    block, bad, checked, report = '?', 0, 0, []
    for raw in lines:
        if raw.startswith('### '):
            block = raw[4:].split(' · ')[0]
            continue
        mark, body = raw[:1], raw[2:]
        if mark == '+' and body:
            checked += 1
            w = width(body)
            ok = w <= LIMIT
            bad += 0 if ok else 1
            report.append(f'{"OK " if ok else "XX "} 블록 {block} · {w:3}칸 | {body}')
        elif mark == '*':
            report.append(f'--  블록 {block} · {width(body):3}칸 | {body}  (마킹 있는 진단 행 · D33 · 세지 않음)')
    print('\n'.join(report))
    print(f'\n+ 줄 {checked}개 · 80칸 넘침 {bad}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
