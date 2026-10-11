#!/usr/bin/env python3
"""보고서 시안 표본 8상태 — report-readability (RR) + baseline-profile (BP-8).

입력은 실기기 YouTube 진단 세션 result.json 하나다 (2026-10-07 SM-S901N · dm16-manual — 보고서
`device-report-diagnose.html` 에 실린 것). 그것을 **줄이고 고쳐** 상태마다 표본을 짓는다:
slice 표는 앞 40행 · 시계열은 그대로 · 새 필드(컴파일 상태 · 바꾼 기록 · ART 칸)는 실측 원문 꼴로 지은 값.

**새 필드 이름은 자리표시다** — 정본은 README 이고 bp-core-state · bp-core-art · bp-core-compile 이 정한다.
화면이 읽는 칸의 모양(dex 줄마다 path · abi · status · reason · location · primary_abi)만 기능 문서 BP-1 · BP-4 · BP-7 을 따른다.

  python3 -I labs/report-readability-design/v1/gen_samples.py <실기기 result.json> [<runs 디렉토리>]
  → labs/report-readability-design/v1/samples/<상태>.json  (+ <runs>/<상태>/result.json — 지금 코드 실렌더용)
"""
import copy
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
PKG = 'com.google.android.youtube'
APP = f'/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/{PKG}-_ZCw5JfQvaAuZ5khXQX0GQ=='
DATA = f'/data/user/0/{PKG}'

# research-baseline A1 · C · F 의 Dexopt state 원문 꼴 (sdk 36 삼성)
SECONDARY = [
    f'{DATA}/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/pcam.jar',
    f'{DATA}/app_pccache2/5/C261F5452FADA828A0BEBA37A55BDC37FE758C0A/pcam.jar',
    f'{DATA}/app_yqzdkcache/drgd/v/pcam.jar',
]


def dex(path, status, reason, location):
    return {'path': path, 'abi': 'arm64', 'status': status, 'reason': reason,
            'location': location, 'primary_abi': True}


def odex():
    return f'{APP}/oat/arm64/base.odex'


def vdex(p):
    return p.rsplit('/', 1)[0] + '/oat/arm64/pcam.vdex'


def state(base_status, base_reason, base_loc=None, sec=('verify', 'vdex')):
    rows = [dex(f'{APP}/base.apk', base_status, base_reason, base_loc or odex())]
    rows += [dex(p, sec[0], sec[1], vdex(p)) for p in SECONDARY]
    return {'dex': rows}


def normal(src):
    d = copy.deepcopy(src)
    d.pop('diagnose', None)
    d['session']['options'] = {'launch': True}
    d['session']['name'] = 'youtube-평소'
    d['target_app']['compile_state_start'] = state('speed-profile', 'profile-utilization')
    d['target_app']['compile_state_end'] = state('speed-profile', 'profile-utilization')
    d['artifacts'] = {k: v for k, v in d.get('artifacts', {}).items()}
    return d


def summary(src):
    # plan B22 — 차트 카드의 `[]`(재 봤더니 0건). 앱 로그 시계열을 비우고 수도 0 으로 맞춘다
    d = normal(src)
    log = d['metrics']['log']['data']
    log['app']['timeline'] = []
    log['app']['total'] = 0
    log['app']['by_priority'] = {k: 0 for k in log['app'].get('by_priority', {})}
    return d


def missing(src):
    d = normal(src)
    d['session']['name'] = 'youtube-미수집'
    d['device']['static']['sdk_int'] = 30
    d['device']['static']['android_release'] = '11'
    for m, code, why in (
        ('frame', 'sdk_too_low', '이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=31, Android 12).'),
        ('network', 'sdk_too_low', '이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=34, Android 14).'),
    ):
        d['metrics'][m] = {'status': 'unsupported', 'source': d['metrics'][m]['source'],
                           'reason_code': code, 'reason': why, 'data': None}
    d['metrics']['cpu']['data']['app'] = None
    d['metrics']['cpu']['status'] = 'partial'
    d['metrics']['cpu']['reason_code'] = 'app_cpu_sdk_too_low'
    d['metrics']['thermal']['data']['device_status_after'] = None
    d['device']['static']['display']['active_refresh_rate_hz'] = None
    return d


def compile_speed(src):
    d = normal(src)
    d['session']['name'] = 'youtube-compile-speed'
    d['session']['options'] = {'launch': True, 'compile': 'speed'}
    d['session']['compile'] = {
        'value': 'speed',
        'command': f'cmd package compile -m speed -f {PKG}',
        'before': state('speed-profile', 'profile-utilization'),
        'elapsed_ms': 67500,
    }
    d['target_app']['compile_state_start'] = state('speed', 'cmdline')
    # 바뀜 경고를 보이려고 끝 상태 base 줄 reason 만 다르게 지었다 (BP-3)
    d['target_app']['compile_state_end'] = state('speed', 'bg-dexopt')
    d['warnings'] = [{'code': 'compile_state_changed',
                      'message': 'base.apk [primary-abi] 줄 reason cmdline → bg-dexopt'}]
    return d


def end_null(src):
    d = normal(src)
    d['session']['name'] = 'youtube-extract'
    d['target_app']['compile_state_end'] = None
    d['target_app']['compile_state_end_reason_code'] = 'compile_state_not_read'
    d['target_app']['compile_state_end_reason'] = 'stop 전에 extract 로 산출 — 끝 상태를 읽지 않음'
    return d


def legacy(src):
    d = copy.deepcopy(src)
    d.pop('diagnose', None)
    d['session']['options'] = {'launch': True}
    d['session']['name'] = 'youtube-옛-파일'
    return d


def diag(src):
    d = copy.deepcopy(src)
    d['session']['name'] = 'youtube-진단'
    d['target_app']['compile_state_start'] = state('speed-profile', 'profile-utilization')
    d['target_app']['compile_state_end'] = state('speed-profile', 'profile-utilization')
    g = d['diagnose']
    g['atrace_categories'] = ['am', 'wm', 'view', 'dalvik']
    g['target_process_slice_names'] = g['target_process_slice_names'][:40] + [
        {'name': 'L*;', 'main_thread': {'count': 2317, 'sum_ms': 118.4, 'max_ms': 10.9},
         'other_threads': {'count': 2898, 'sum_ms': 178.2, 'max_ms': 6.1}, 'async_tracks': None},
    ]
    g['target_process_compile_states'] = [
        {'location': f'{APP}/oat/arm64/base.odex', 'status': 'up-to-date',
         'filter': 'speed-profile', 'reason': 'profile-utilization'},
        {'location': f'{DATA}/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/oat/arm64/pcam.vdex',
         'status': 'up-to-date', 'filter': 'verify', 'reason': 'vdex'},
        {'location': 'primary.vdex mapped directly in memory from /data/app/~~KFTc…/com.google.android.gms-…/split_DynamiteLoader_installtime.dm',
         'status': 'up-to-date', 'filter': 'verify', 'reason': 'vdex-dm'},
        {'location': 'none', 'status': 'no-dex-code', 'filter': 'unknown', 'reason': 'unknown'},
    ]
    g['target_process_compile_states_reason_code'] = None
    g['target_process_jit_slices'] = 52
    g['target_process_jit_slices_reason_code'] = None
    return d


def diag_noapp(src):
    d = diag(src)
    d['session']['name'] = 'youtube-진단-대상-앱-없음'
    g = d['diagnose']
    g['status'] = 'partial'
    g['reason_code'] = 'process_not_in_trace'
    g['reason'] = '대상 앱 프로세스를 트레이스에서 특정하지 못했다.'
    for k in ('target_process_slices', 'target_process_slices_unfinished',
              'target_process_slice_names_unfolded', 'target_process_slice_names',
              'target_process_compile_states', 'target_process_jit_slices'):
        g[k] = None
    g['target_process_compile_states_reason_code'] = 'process_not_in_trace'
    g['target_process_jit_slices_reason_code'] = 'process_not_in_trace'
    return d


# 상태 이름 · 짓는 함수 · 보는 탭 (Report Readability.dc.html ?state=)
STATES = [
    ('summary', summary, 'summary'),
    ('missing', missing, 'summary'),
    ('compile', compile_speed, 'summary'),
    ('end-null', end_null, 'summary'),
    ('legacy', legacy, 'summary'),
    ('device', normal, 'device'),
    ('diag', diag, 'diagnose'),
    ('diag-noapp', diag_noapp, 'diagnose'),
]


def main():
    src = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    runs = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
    out = HERE / 'samples'
    out.mkdir(exist_ok=True)
    for i, (name, fn, _tab) in enumerate(STATES):
        d = fn(src)
        d['session']['id'] = f'rr{i:04x}'
        text = json.dumps(d, ensure_ascii=False, indent=1)
        (out / f'{name}.json').write_text(text + '\n', encoding='utf-8')
        if runs is not None:
            (runs / name).mkdir(parents=True, exist_ok=True)
            (runs / name / 'result.json').write_text(text + '\n', encoding='utf-8')
        print(f'{name:11} {len(text):>8} B  id {d["session"]["id"]}')


if __name__ == '__main__':
    main()
