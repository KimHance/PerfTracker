// Report Readability.dc.html 의 ?state= 표본 8개 — base.json(실기기 YouTube 진단 세션을 줄인 것) 하나에서 짓는다.
// labs/report-readability-design/v1/gen_samples.py 와 같은 고침이다 (파이썬 → JS). 필드 이름 · 모양은 core 실제 (KimHance/baseline-profile 20688ab · `session.compile` 은 bp-core-compile 0ef33ad · plan B31).
(function () {
  const PKG = 'com.google.android.youtube'
  const APP = `/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/${PKG}-_ZCw5JfQvaAuZ5khXQX0GQ==`
  const DATA = `/data/user/0/${PKG}`
  const SECONDARY = [
    `${DATA}/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/pcam.jar`,
    `${DATA}/app_pccache2/5/C261F5452FADA828A0BEBA37A55BDC37FE758C0A/pcam.jar`,
    `${DATA}/app_yqzdkcache/drgd/v/pcam.jar`,
  ]
  const clone = (x) => JSON.parse(JSON.stringify(x))
  // DexoptLineSchema — dex 하나 × ABI 하나 한 줄
  const dex = (path, status, reason, location, secondary = false) =>
    ({ path, secondary_dex: secondary, public_dex: false, abi: 'arm64', status, reason, primary_abi: true, location })
  const vdex = (p) => p.slice(0, p.lastIndexOf('/')) + '/oat/arm64/pcam.vdex'
  // 배열 바로 (null = 못 읽음 · [] 는 쓰지 않음)
  const state = (st, rs) =>
    [dex(`${APP}/base.apk`, st, rs, `${APP}/oat/arm64/base.odex`), ...SECONDARY.map((p) => dex(p, 'verify', 'vdex', vdex(p), true))]

  function normal(base) {
    const d = clone(base)
    delete d.diagnose
    d.session.options = { launch: true }
    d.session.name = 'youtube-평소'
    d.target_app.compile_state_start = state('speed-profile', 'profile-utilization')
    d.target_app.compile_state_end = state('speed-profile', 'profile-utilization')
    for (const ph of ['start', 'end']) { d.target_app[`compile_state_${ph}_reason_code`] = null; d.target_app[`compile_state_${ph}_reason`] = null }
    return d
  }
  function summary(base) {
    // plan B22 — 차트 카드의 [] (재 봤더니 0건): 앱 로그 시계열을 비우고 수를 0 으로
    const d = normal(base)
    const log = d.metrics.log.data
    log.app.timeline = []
    log.app.total = 0
    for (const k of Object.keys(log.app.by_priority || {})) log.app.by_priority[k] = 0
    return d
  }
  function missing(base) {
    const d = normal(base)
    d.session.name = 'youtube-미수집'
    d.device.static.sdk_int = 30
    d.device.static.android_release = '11'
    for (const [m, why] of [['frame', '이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=31, Android 12).'],
                            ['network', '이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=34, Android 14).']]) {
      d.metrics[m] = { status: 'unsupported', source: d.metrics[m].source, reason_code: 'sdk_too_low', reason: why, data: null }
    }
    d.metrics.cpu.data.app = null
    d.metrics.cpu.status = 'partial'
    d.metrics.cpu.reason_code = 'app_cpu_sdk_too_low'
    d.metrics.thermal.data.device_status_after = null
    d.device.static.display.active_refresh_rate_hz = null
    return d
  }
  function compile(base) {
    const d = normal(base)
    d.session.name = 'youtube-compile-speed'
    d.session.options = { launch: true, compile: 'speed' }
    d.session.compile = { value: 'speed', command: `cmd package compile -m speed -f ${PKG}`, elapsed_ms: 67500, compile_state_before: state('speed-profile', 'profile-utilization'), compile_state_before_reason_code: null, compile_state_before_reason: null }
    d.target_app.compile_state_start = state('speed', 'cmdline')
    // 끝 상태 base 줄 reason 을 다르게 (바뀜 경고) · 세션 중 앱이 불러온 보조 dex 한 줄이 끝에만 (다른 때 칸 `줄 없음`)
    const end = state('speed', 'bg-dexopt')
    end.push(dex(`${DATA}/app_tmp/fx/q.dex`, 'run-from-apk', 'unknown', null, true))
    d.target_app.compile_state_end = end
    d.session.marks = [{ offset_ms: 3200, label: '홈 로딩' }, { offset_ms: 9400, label: '스크롤' }]
    // core app/dexopt.ts compileStateChangeWarning 문구 그대로
    d.warnings = [{ code: 'compile_state_changed', message: '세션 중 base.apk 컴파일 상태가 바뀌었음 — status speed → speed · reason cmdline → bg-dexopt (target_app.compile_state_start · compile_state_end)' }]
    return d
  }
  function endNull(base) {
    const d = normal(base)
    d.session.name = 'youtube-extract'
    d.target_app.compile_state_end = null
    d.target_app.compile_state_end_reason_code = 'dexopt_state_unavailable'
    d.target_app.compile_state_end_reason = '아직 stop 하지 않은 세션 — 세션 끝 컴파일 상태를 읽지 않음'
    return d
  }
  function legacy(base) {
    const d = clone(base)
    delete d.diagnose
    d.session.options = { launch: true }
    d.session.name = 'youtube-옛-파일'
    return d
  }
  function diag(base) {
    const d = clone(base)
    d.session.name = 'youtube-진단'
    d.target_app.compile_state_start = state('speed-profile', 'profile-utilization')
    d.target_app.compile_state_end = state('speed-profile', 'profile-utilization')
    const g = d.diagnose
    g.atrace_categories = ['am', 'wm', 'view', 'dalvik']
    g.target_process_slice_names = g.target_process_slice_names.concat([
      { name: 'L*;', main_thread: { count: 2317, sum_ms: 118.4, max_ms: 10.9 }, other_threads: { count: 2898, sum_ms: 178.2, max_ms: 6.1 }, async_tracks: null },
    ])
    g.target_process_compile_state_slices = [
      { location: `${APP}/oat/arm64/base.odex`, status: 'up-to-date', filter: 'speed-profile', reason: 'profile-utilization' },
      { location: `${DATA}/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B/oat/arm64/pcam.vdex`, status: 'up-to-date', filter: 'verify', reason: 'vdex' },
      { location: 'primary.vdex mapped directly in memory from /data/app/~~KFTc…/com.google.android.gms-…/split_DynamiteLoader_installtime.dm', status: 'up-to-date', filter: 'verify', reason: 'vdex-dm' },
      { location: 'none', status: 'no-dex-code', filter: 'unknown', reason: 'unknown' },
    ]
    g.target_process_compile_state_slices_reason_code = null
    g.target_process_compile_state_slices_reason = null
    g.target_process_jit_slices = 52
    g.target_process_jit_slices_reason_code = null
    g.target_process_jit_slices_reason = null
    return d
  }
  function diagNoapp(base) {
    const d = diag(base)
    d.session.name = 'youtube-진단-대상-앱-없음'
    const g = d.diagnose
    g.status = 'partial'
    g.reason_code = 'process_not_in_trace'
    g.reason = '대상 앱 프로세스를 트레이스에서 특정하지 못했다.'
    for (const k of ['target_process_slices', 'target_process_slices_unfinished', 'target_process_slice_names_unfolded',
      'target_process_slice_names', 'target_process_compile_state_slices', 'target_process_jit_slices']) g[k] = null
    for (const k of ['target_process_compile_state_slices', 'target_process_jit_slices']) {
      g[`${k}_reason_code`] = 'process_not_in_trace'
      g[`${k}_reason`] = '대상 앱 프로세스를 트레이스에서 특정하지 못했다.'
    }
    return d
  }

  // 상태 → [짓는 함수, 처음 탭]
  window.RR_STATES = {
    summary: [summary, 'summary'],
    missing: [missing, 'summary'],
    compile: [compile, 'summary'],
    'end-null': [endNull, 'summary'],
    legacy: [legacy, 'summary'],
    device: [summary, 'device'],
    diag: [diag, 'diagnose'],
    'diag-noapp': [diagNoapp, 'diagnose'],
  }
})()
