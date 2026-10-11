#!/usr/bin/env python3
"""CLI 글자 시안 6블록 — 컴파일 상태 맞춰 재기 (BP-4 · BP-5 · BP-6 · 80칸).

기존 줄은 지금 코드의 꼴 그대로 옮겼다 (packages/cli/src/commands/{start,stop,status}.ts · program.ts
`start --help` 실출력). 새 줄은 첫 칸 표식으로 가른다 — 표식은 시안 주석이지 출력이 아니다.

  `+ ` 새 줄 — 80칸 안 (check_cli.py 가 잰다)
  `> ` 새 줄 — 되돌림 명령. 호스트에서 그대로 쳐서 도는 한 줄이라 80칸 밖 (BP 결정 13 · 자르지 않음)
  `# ` 시안 주석 — 출력 아님
  `  ` 기존 줄 그대로

값은 실측(2026-10-11 SM-S901N R5CT0000001 · YouTube 21.40.161 · research-baseline A · C · F)의 꼴.

  python3 labs/baseline-profile-design/v1/gen_cli.py   # → cli/blocks.txt
"""
import pathlib
import re

WIDE = re.compile('[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]')


def width(s: str) -> int:
    # packages/cli/src/commands/runs.ts displayWidth 와 같은 규칙
    return sum(2 if WIDE.match(c) else 1 for c in s)


# ── 새 문구 (docs/design/baseline-profile.md `## 문구` cli 줄과 같은 글) ──
HELP_COMPILE = '기기 컴파일 상태 바꿈 · reset · speed-profile · speed'
COMPILE_LINE = 'Compile   {value} · base.apk {before} → {after} · {ms} ms'
REVERT_HEAD = '되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음'
REVERT_CMD = 'adb -s {serial} shell cmd package compile -m {status} -f {pkg}'
REVERT_SECONDARY = 'adb -s {serial} shell cmd package compile -m {status} -f --secondary-dex {pkg}'
REVERT_SECONDARY_MIXED = '보조 dex {n}개 · status 서로 다름 · 보조 dex 되돌림 줄 없음'
REVERT_NONE = '되돌림 줄 없음 · 바꾸기 전 base.apk status {status} · -m 이 받지 않는 값'
REVERT_UNKNOWN = '되돌림 줄 없음 · 바꾸기 전 base.apk status 모름'
FAIL_HEAD = '컴파일 실패 · 세션 안 엶 · exit {code}'
FAIL_TIMEOUT = '컴파일 한도 10분 넘음 · 세션 안 엶'
FAIL_CMD = '보낸 명령  {cmd}'
FAIL_STATE = 'Compile   {value} · base.apk 바꾸기 전 {before} · 지금 모름'
REJECT_LAUNCH = '--compile 은 --launch 와만 · 기기 명령 0'
REJECT_VALUE = '--compile {value} · 받는 값 reset · speed-profile · speed · 기기 명령 0'

SERIAL = 'R5CT0000001'
PKG = 'com.google.android.youtube'
RUN = '/Users/me/runs/2026-10-11_164012_youtube-speed'


def revert(before: str, secondary: list[str]) -> list[tuple[str, str]]:
    if before is None:
        return [('+', REVERT_UNKNOWN)]
    if before not in ('speed', 'speed-profile', 'verify'):
        return [('+', REVERT_NONE.format(status=before))]
    rows = [('+', REVERT_HEAD), ('>', '  ' + REVERT_CMD.format(serial=SERIAL, status=before, pkg=PKG))]
    if secondary:
        if len(set(secondary)) == 1:
            rows.append(('>', '  ' + REVERT_SECONDARY.format(serial=SERIAL, status=secondary[0], pkg=PKG)))
        else:
            rows.append(('+', '  ' + REVERT_SECONDARY_MIXED.format(n=len(secondary))))
    return rows


def start_ok() -> list[tuple[str, str]]:
    return [
        (' ', '측정을 시작했습니다.'),
        (' ', 'Session   youtube-speed  (a1b2c3)'),
        (' ', f'App       YouTube  {PKG}'),
        (' ', f'Run dir   {RUN}'),
        ('+', COMPILE_LINE.format(value='speed', before='speed-profile', after='speed', ms='67,500')),
        (' ', 'Startup   TotalTime 844ms · COLD'),
        (' ', ''),
        *revert('speed-profile', ['verify', 'verify', 'verify']),
        (' ', ''),
        (' ', '기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.'),
        (' ', '측정 중에는 기기에 어떤 명령도 보내지 않습니다.'),
    ]


def start_fail() -> list[tuple[str, str]]:
    return [
        ('+', FAIL_HEAD.format(code=1)),
        ('+', FAIL_CMD.format(cmd=f'cmd package compile -m speed -f {PKG}')),
        ('+', FAIL_STATE.format(value='speed', before='speed-profile')),
        (' ', ''),
        *revert('speed-profile', ['verify', 'run-from-apk', 'run-from-apk']),
        (' ', ''),
        ('+', REJECT_LAUNCH),
        ('+', REJECT_VALUE.format(value='verify')),
    ]


def stop_revert() -> list[tuple[str, str]]:
    return [
        (' ', f'→ {RUN}/result.json'),
        (' ', '  perftracker report a1b2c3 로 보고서를 엽니다'),
        (' ', ''),
        *revert('speed-profile', ['verify', 'verify', 'verify']),
    ]


def stop_none() -> list[tuple[str, str]]:
    return [
        (' ', f'→ {RUN}/result.json'),
        (' ', '  perftracker report a1b2c3 로 보고서를 엽니다'),
        (' ', ''),
        *revert('run-from-apk', []),
        (' ', ''),
        ('#', '바꾸기 전 status 를 못 읽은 세션 (BP-2 null)'),
        *revert(None, []),
    ]


def status() -> list[tuple[str, str]]:
    return [
        (' ', 'Session   youtube-speed  (a1b2c3)'),
        (' ', f'App       {PKG}'),
        (' ', 'Elapsed   00:42'),
        (' ', f'Run dir   {RUN}'),
        ('+', COMPILE_LINE.format(value='speed', before='speed-profile', after='speed', ms='67,500')),
    ]


def help_() -> list[tuple[str, str]]:
    def opt(flag: str, desc: str) -> str:
        return f'  {flag}{" " * max(1, 23 - width(flag))}{desc}'
    return [
        (' ', 'Usage: perftracker start [options]'),
        (' ', ''),
        (' ', '측정 세션을 시작한다'),
        (' ', ''),
        (' ', 'Options:'),
        (' ', opt('-a, --app <라벨|패키지>', '대상 앱 (생략 시 포그라운드 앱)')),
        (' ', opt('-n, --name <이름>', '세션 이름')),
        (' ', opt('-d, --device <serial>', '대상 기기 serial')),
        (' ', opt('--launch', '앱을 콜드 상태로 실행하고 시작 시간을 측정한다 (default: false)')),
        (' ', opt('-o, --out <dir>', '결과를 저장할 디렉토리 (default: "runs")')),
        (' ', opt('--force', '이 기기의 기존 세션을 버리고 시작한다 (default: false)')),
        (' ', opt('--diagnose', '진단 세션 — atrace slice 기록 · 최대 10분')),
        ('+', opt('--compile <값>', HELP_COMPILE)),
        (' ', opt('-h, --help', 'display help for command')),
    ]


BLOCKS = [
    ('1 start --launch --compile speed · 성공', start_ok),
    ('2 start --compile · 실패 · 거부', start_fail),
    ('3 stop · 되돌림 줄', stop_revert),
    ('4 stop · 되돌릴 값 없음', stop_none),
    ('5 status · --compile 세션', status),
    ('6 start --help', help_),
]


def main() -> None:
    out = []
    for title, fn in BLOCKS:
        out.append(f'### {title}')
        out += [f'{mark} {line}' for mark, line in fn()]
        out.append('')
    path = pathlib.Path(__file__).resolve().parent / 'cli' / 'blocks.txt'
    path.parent.mkdir(exist_ok=True)
    path.write_text('\n'.join(out), encoding='utf-8')
    print(path)


if __name__ == '__main__':
    main()
