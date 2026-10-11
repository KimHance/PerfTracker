#!/usr/bin/env python3
"""cli/blocks.txt 검사 — `+` 줄 80칸 안 · `>` 줄은 호스트 꼴(`adb -s <serial> shell cmd package compile`) 한 줄 ·
새 문구의 DM-15 단어형 규칙 (끝 글자 · 권유 · 평가 낱말).

  python3 labs/baseline-profile-design/v1/check_cli.py          # 통과면 exit 0
  python3 labs/baseline-profile-design/v1/check_cli.py --break  # 규칙마다 깬 표본이 걸리는지 (전부 걸리면 exit 0)
"""
import pathlib
import re
import sys

sys.dont_write_bytecode = True  # gen_cli import 가 __pycache__ 를 레포에 남기지 않게
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gen_cli import width  # noqa: E402

EVAL = ['느리', '느린', '느림', '느려', '느릴', '빠르', '빠른', '빠름', '빨라', '빨리', '빠를', '좋',
        '나쁘', '나쁜', '나쁨', '나빠', '나쁠', '부드러', '부드럽', '무거', '무겁', '가벼', '가볍',
        '심각', '주의', '문제', '병목', '권장']
PLEAD = ['세요', '십시오', '바랍니다', '해야', '드립니다', '저희']
# 화면 판정 금지 (baseline-profile 결정 6 · feas-design 표면 제약)
BANNED = ['최적화', '적용됨', 'AOT', '프로파일 있음', '예열']
HOST = re.compile(r'^\s*adb -s \S+ shell cmd package compile -m \S+ -f (--secondary-dex )?\S+$')


def problems(mark: str, line: str) -> list[str]:
    out = []
    if mark == '>':
        if not HOST.match(line):
            out.append('되돌림 줄 꼴')
        return out
    if mark != '+':
        return out
    if width(line) > 80:
        out.append(f'80칸 넘침 {width(line)}')
    tail = re.sub(r'[\s.,·:;()\-—→=]+$', '', line)
    if tail.endswith(('다', '요')) or '니다' in line:
        out.append('끝 글자')
    out += [f'권유 {w}' for w in PLEAD if w in line]
    out += [f'평가 {w}' for w in EVAL if w in line]
    out += [f'안 쓰는 말 {w}' for w in BANNED if w in line]
    return out


def check(lines: list[str]) -> int:
    bad = 0
    for n, raw in enumerate(lines, 1):
        if raw.startswith('###') or len(raw) < 2:
            continue
        mark, line = raw[0], raw[2:]
        for p in problems(mark, line):
            bad += 1
            print(f'{n}: {p} | {line}')
    return bad


def main() -> int:
    path = pathlib.Path(__file__).resolve().parent / 'cli' / 'blocks.txt'
    lines = path.read_text(encoding='utf-8').splitlines()
    if '--break' in sys.argv:
        samples = ['+ ' + 'x' * 81, '+ 바꿨습니다', '+ 다시 재세요', '+ 상태가 좋음', '+ 빨라짐',
                   '+ 최적화 적용됨', '> cmd package compile -m speed -f com.x']
        samples += [f'+ 상태 {w}' for w in EVAL]
        missed = [s for s in samples if not problems(s[0], s[2:])]
        print(f'--break 표본 {len(samples)} · 안 걸림 {len(missed)}')
        for s in missed:
            print('  안 걸림:', s)
        return 1 if missed else 0
    bad = check(lines)
    new = sum(1 for x in lines if x[:1] in '+>')
    widest = max((width(x[2:]) for x in lines if x[:1] == '+'), default=0)
    longest = max((width(x[2:]) for x in lines if x[:1] == '>'), default=0)
    print(f'새 줄 {new} · 80칸 안 최대 {widest} · 되돌림 줄 최대 {longest}칸 (80칸 밖 · 결정 13) · 걸림 {bad}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
