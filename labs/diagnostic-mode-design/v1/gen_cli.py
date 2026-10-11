#!/usr/bin/env python3
"""CLI 글자 시안 8블록 — 진단 세션의 터미널 출력 (80칸).

기존 줄은 지금 코드의 꼴 그대로 옮겼다 (packages/cli/src/commands/{doctor,start,status,runs}.ts ·
program.ts `start --help` 실출력). 새 줄 · 바뀐 줄은 첫 칸 표식으로 가른다 — 표식은 시안 주석이지 출력이 아니다.

  `+ ` 새 줄 — 80칸 안 (check_cli.py 가 잰다)
  `* ` 새 꼬리가 붙은 줄 — 기존 꼬리(미지원 · 마킹)만으로 이미 80칸을 넘는 runs 행. 기준 줄은 `경고 N · 진단` 행
  `~ ` 기존 문구 · 값만 바뀜 (DM-17 10:00)
  `  ` 기존 줄 그대로

  python3 labs/diagnostic-mode-design/v1/gen_cli.py   # → cli/blocks.txt
"""
import pathlib
import re

WIDE = re.compile('[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]')


def width(s: str) -> int:
    # packages/cli/src/commands/runs.ts displayWidth 와 같은 규칙
    return sum(2 if WIDE.match(c) else 1 for c in s)


def pad(s: str, n: int) -> str:
    return s + ' ' * max(0, n - width(s))


# ── 새 문구 (docs/design/diagnostic-mode.md `## 문구` 와 같은 글) ──
DIAG_LINE = 'Diagnose  atrace am · wm · view + 앱 slice · 최대 10분'
NOTICE_NOT_DEBUGGABLE = '앱 slice 열림 모름 — sdk {sdk} · debuggable 아님'
DOCTOR_NAME = 'diagnose: app slice'
DOCTOR_OK = 'sdk {sdk} · 열림'
DOCTOR_NG = 'sdk {sdk} · debuggable 앱만 열림'
RUNS_TAG = '진단'
HELP_DESC = '진단 세션 — atrace slice 기록 · 최대 10분'


def doctor(ok: bool, name: str, detail: str) -> str:
    # packages/cli/src/commands/doctor.ts formatDoctor
    return f"{'✓' if ok else '✗'} {name.ljust(38)} {detail}"


METRICS = ['hwui', 'frame', 'startup', 'cpu', 'memory', 'log', 'thermal', 'network']
TOO_LOW = '이 기기에서는 측정할 수 없습니다 — 이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int={m}, Android {r}).'


def doctor_block(serial: str, model: str, sdk: int) -> list[tuple[str, str]]:
    rows = [
        (' ', doctor(True, 'adb', '/Users/me/Library/Android/sdk/platform-tools/adb (ANDROID_HOME)')),
        (' ', doctor(True, 'adb version', 'Android Debug Bridge version 1.0.41')),
        (' ', doctor(True, 'device', f'{serial} {model}')),
        (' ', doctor(True, 'perfetto', '/system/bin/perfetto 사용 가능')),
        (' ', doctor(True, 'data source: linux.process_stats', '등록됨')),
        (' ', doctor(True, 'data source: linux.sys_stats', '등록됨')),
    ]
    for m in METRICS:
        low = sdk == 30 and m in ('frame', 'network')
        detail = TOO_LOW.format(m=31 if m == 'frame' else 34, r=12 if m == 'frame' else 14) if low else '측정 가능'
        rows.append((' ', doctor(not low, f'metric: {m}', detail)))
    if sdk >= 31:
        rows.append(('+', doctor(True, DOCTOR_NAME, DOCTOR_OK.format(sdk=sdk))))
    else:
        rows.append(('+', doctor(False, DOCTOR_NAME, DOCTOR_NG.format(sdk=sdk))))
    rows.append((' ', doctor(True, 'trace_processor', '캐시됨: /Users/me/.perftracker/bin/trace_processor')))
    return rows


def start_block(sid: str, run_dir: str, startup: str, sdk30: bool) -> list[tuple[str, str]]:
    rows = [
        (' ', '측정을 시작했습니다.'),
        (' ', f'Session   유튜브 진단  ({sid})'),
        (' ', 'App       YouTube  com.google.android.youtube'),
        (' ', f'Run dir   {run_dir}'),
        ('+', DIAG_LINE),
        (' ', f'Startup   {startup}'),
    ]
    if sdk30:
        rows += [
            (' ', ''),
            (' ', '이 기기에서 측정할 수 없는 지표 2개 — 나머지는 정상 수집됩니다:'),
            (' ', '  ✗ frame    이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=31, Android 12).'),
            (' ', '  ✗ network  이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=34, Android 14).'),
            ('+', ''),
            ('+', NOTICE_NOT_DEBUGGABLE.format(sdk=30)),
        ]
    rows += [
        (' ', ''),
        (' ', '기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.'),
        (' ', '측정 중에는 기기에 어떤 명령도 보내지 않습니다.'),
    ]
    return rows


RUN_A = 'runs/2026-10-08T00-29-11_유튜브-진단_a1b2c3'
RUN_B = 'runs/2026-10-08T00-41-02_유튜브-진단_d4e5f6'


def runs_row(rid, name, model, when, dur, tail) -> str:
    # packages/cli/src/commands/runs.ts formatRow
    return f'{rid}  {pad(name, 20)}  {pad(model, 12)}  {when}  {dur}  {" · ".join(tail)}'


BLOCKS = [
    ('1', 'doctor — 진단 앱 slice ✓ (SM-S901N · sdk 36)', '$ perftracker doctor', doctor_block('R5CT0000001', 'SM-S901N', 36)),
    ('2', 'doctor — 진단 앱 slice ✗ (SM-A405S · sdk 30)', '$ perftracker doctor -d R38M20ABCDE', doctor_block('R38M20ABCDE', 'SM-A405S', 30)),
    ('3', 'start --diagnose — 앱 slice 열림 (sdk 36)',
     '$ perftracker start --diagnose --app com.google.android.youtube --name "유튜브 진단" --launch',
     start_block('a1b2c3', RUN_A, 'TotalTime 719ms · COLD', False)),
    ('4', 'start --diagnose — 앱 slice 열림 모름 고지 (sdk 30 · debuggable 아님)',
     '$ perftracker start --diagnose --app com.google.android.youtube --name "유튜브 진단" --launch -d R38M20ABCDE',
     start_block('d4e5f6', RUN_B, 'TotalTime 1204ms · COLD', True)),
    ('5', 'status — 진단 세션', '$ perftracker status', [
        (' ', 'Session   유튜브 진단  (a1b2c3)'),
        (' ', 'App       com.google.android.youtube'),
        (' ', 'Elapsed   03:12'),
        (' ', f'Run dir   {RUN_A}'),
        ('+', DIAG_LINE),
        (' ', 'Marks     2개 · 마지막 02:40'),
    ]),
    ('6', 'status — 진단 세션 최대 시간 넘김 (기존 문구 · 값 10:00)', '$ perftracker status', [
        (' ', 'Session   유튜브 진단  (a1b2c3)'),
        (' ', 'App       com.google.android.youtube'),
        (' ', 'Elapsed   10:24'),
        (' ', f'Run dir   {RUN_A}'),
        ('+', DIAG_LINE),
        (' ', ''),
        ('~', '설정된 최대 측정 시간(10:00)을 넘었습니다. 트레이스 버퍼가 넘쳤을 수 있으며, 실제 여부는 stop 후 result.json 에 기록됩니다.'),
    ]),
    ('7', 'runs — 진단 · 평소 섞인 목록', '$ perftracker runs', [
        ('+', runs_row('d4e5f6', '유튜브 진단', 'SM-A405S', '10/08 00:41', '00:58', ['경고 0', RUNS_TAG])),
        ('+', runs_row('a1b2c3', '유튜브 진단', 'SM-S901N', '10/08 00:29', '01:42', ['경고 0', RUNS_TAG])),
        (' ', runs_row('9f8e7d', '유튜브 평소', 'SM-S901N', '10/08 00:25', '01:38', ['경고 0'])),
        ('*', runs_row('b7c8d9', '스크롤 진단', 'SM-S901N', '10/07 23:10', '04:11', ['경고 1', '마킹 4', RUNS_TAG])),
        (' ', runs_row('c3b2a1', '홈 스크롤', 'SM-S901N', '10/07 16:12', '02:02', ['경고 1', '마킹 2'])),
        (' ', ''),
        (' ', '5건 · runs'),
    ]),
    ('8', 'start --help — --diagnose 줄', '$ perftracker start --help', [
        (' ', 'Usage: perftracker start [options]'),
        (' ', ''),
        (' ', '측정 세션을 시작한다'),
        (' ', ''),
        (' ', 'Options:'),
        (' ', '  -a, --app <라벨|패키지>     대상 앱 (생략 시 포그라운드 앱)'),
        (' ', '  -n, --name <이름>        세션 이름'),
        (' ', '  -d, --device <serial>  대상 기기 serial'),
        (' ', '  --launch               앱을 콜드 상태로 실행하고 시작 시간을 측정한다 (default: false)'),
        (' ', '  -o, --out <dir>        결과를 저장할 디렉토리 (default: "runs")'),
        (' ', '  --force                이 기기의 기존 세션을 버리고 시작한다 (default: false)'),
        ('+', f'  {"--diagnose".ljust(21)}  {HELP_DESC}'),
        (' ', '  -h, --help             display help for command'),
    ]),
]


def main() -> None:
    out = ['# 진단 모드 CLI 글자 시안 v1 — gen_cli.py 가 만든다. 첫 칸 표식: + 새 줄(80칸 안) · * 새 꼬리(기존 꼬리로 넘침) · ~ 값만 바뀜 · 빈칸 기존', '']
    for bid, title, cmd, rows in BLOCKS:
        out.append(f'### {bid} · {title}')
        out.append(f'  {cmd}')
        out += [f'{mark} {line}'.rstrip() if line else mark.rstrip() for mark, line in rows]
        out.append('')
    dst = pathlib.Path(__file__).parent / 'cli' / 'blocks.txt'
    dst.write_text('\n'.join(out), encoding='utf-8')
    print(dst)


if __name__ == '__main__':
    main()
