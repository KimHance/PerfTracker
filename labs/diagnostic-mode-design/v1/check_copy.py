#!/usr/bin/env python3
"""DM-15 단어형 규칙을 디자인 문서 `## 문구` 표에 직접 돌린다.

표의 줄마다: 패키지(cli · gui · core) · 자리 · 문구(백틱 하나) 칸이 있는지, 그리고 문구가
  1. 끝 글자(자리표시 `{…}` · 문장부호 · 기호 · 공백 빼고)가 `다` · `요` 가 아님
  2. `니다` 없음
  3. 권유 · 1인칭 0 — 세요 · 십시오 · 바랍니다 · 해야 · 드립니다 · 저희
  4. 평가 낱말 0 — 음절 그대로 부분 일치 · 기능 문서 결정 10 의 닫힌 목록
인지 본다. 구현 시험(패키지마다 `DM-15 단어형 규칙`)과 같은 규칙을 표 쪽에서 먼저 돌리는 것이다.

  python3 labs/diagnostic-mode-design/v1/check_copy.py            # 0 = 통과
  python3 labs/diagnostic-mode-design/v1/check_copy.py --break    # 규칙 · 낱말마다 걸려야 할 표본이 걸리는지 (깨 보기)
"""
import pathlib
import re
import sys
import unicodedata

DOC = pathlib.Path(__file__).resolve().parents[3] / 'docs' / 'design' / 'diagnostic-mode.md'
PACKAGES = {'cli', 'gui', 'core'}
ENDINGS = ('다', '요')
POLITE = ['세요', '십시오', '바랍니다', '해야', '드립니다', '저희']
EVAL = ['느리', '느린', '느림', '느려', '느릴', '빠르', '빠른', '빠름', '빨라', '빨리', '빠를', '좋',
        '나쁘', '나쁜', '나쁨', '나빠', '나쁠', '부드러', '부드럽', '무거', '무겁', '가벼', '가볍',
        '심각', '주의', '문제', '병목', '권장']


def last_char(text: str) -> str:
    text = re.sub(r'\{[^}]*\}', '', text)
    for ch in reversed(text):
        if unicodedata.category(ch)[0] in 'PSZ' or ch.isspace():
            continue
        return ch
    return ''


def violations(text: str) -> list[str]:
    out = []
    if last_char(text) in ENDINGS:
        out.append(f'끝={last_char(text)}')
    if '니다' in text:
        out.append('니다')
    out += [f'권유:{w}' for w in POLITE if w in text]
    out += [f'평가:{w}' for w in EVAL if w in text]
    return out


def rows() -> list[tuple[str, str, str]]:
    lines = DOC.read_text(encoding='utf-8').splitlines()
    start = lines.index('## 문구')
    found = []
    for line in lines[start + 1:]:
        if line.startswith('## '):
            break
        if not line.startswith('|') or line.startswith('|---') or line.startswith('| 패키지'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        pkg, place, copy = cells[0], cells[1], cells[2]
        m = re.fullmatch(r'`([^`]+)`', copy)
        found.append((pkg, place, m.group(1) if m else f'<<백틱 하나가 아님: {copy}>>'))
    return found


def self_test() -> int:
    must_fail = ['진단 세션을 시작한다', '다시 실행하세요', '앱 slice 열림 모름 — sdk 30 · debuggable 아님입니다',
                 '확인해야 함', '저희 측정', '안내 드립니다', '재시작하십시오', '바랍니다 확인',
                 '시작했어요'] + [f'slice {w}' for w in EVAL] + ['프레임 느려짐', '시작 빨라짐', '빨리 끝남', '응답 나빠짐']
    must_pass = ['진단', 'slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가', '앱 프로세스 몫 미포함', '조회', '—']
    miss = [s for s in must_fail if not violations(s)] + [s for s in must_pass if violations(s)]
    for s in must_fail:
        print(f'{"OK" if violations(s) else "XX"}  걸려야  | {s} | {", ".join(violations(s)) or "-"}')
    for s in must_pass:
        print(f'{"OK" if not violations(s) else "XX"}  통과해야 | {s} | {", ".join(violations(s)) or "-"}')
    print(f'\n표본 {len(must_fail) + len(must_pass)} · 어긋남 {len(miss)}')
    return 1 if miss else 0


def main() -> int:
    if '--break' in sys.argv:
        return self_test()
    bad = 0
    table = rows()
    for pkg, place, copy in table:
        v = violations(copy)
        if pkg not in PACKAGES:
            v.append(f'패키지={pkg}')
        if not place:
            v.append('자리 빈칸')
        if copy.startswith('<<'):
            v.append('문구 칸')
        bad += 1 if v else 0
        print(f'{"XX" if v else "OK"}  {pkg:4} | {place} | {copy} | {", ".join(v) or "-"}')
    per = {p: sum(1 for r in table if r[0] == p) for p in sorted(PACKAGES)}
    print(f'\n줄 {len(table)} ({" · ".join(f"{k} {v}" for k, v in per.items())}) · 규칙에 걸림 {bad}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
