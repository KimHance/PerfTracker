#!/usr/bin/env node
import { Command } from 'commander'
import {
  hasBlockingFailure,
  listDeviceSummaries,
  listRuns,
  loadLabeledApps,
  PerfTrackerError,
  runDoctor,
} from '@perftracker/core'
import { formatApps } from './commands/apps.js'
import { runGui } from './commands/gui.js'
import { runMark } from './commands/mark.js'
import { runRunsList, runRunsRemove, runRunsRename } from './commands/runs.js'
import { formatDoctor } from './commands/doctor.js'
import { formatDevices } from './commands/devices.js'
import { runExtract } from './commands/extract.js'
import { runSchema } from './commands/schema.js'
import { runStart } from './commands/start.js'
import { runStatus, statusData } from './commands/status.js'
import { runStop } from './commands/stop.js'
import { createContext } from './context.js'

const program = new Command()

/**
 * 사람이 읽는 문장이 기본이고 `--json` 이 켜졌을 때만 데이터를 낸다.
 * 두 갈래를 명령마다 손으로 적지 않게 한 곳에 둔다.
 */
function emit(data: unknown, text: string): void {
  console.log(program.opts()['json'] === true ? JSON.stringify(data, null, 2) : text)
}

program
  .name('perftracker')
  .description('안드로이드 앱 성능 데이터를 코드 수정 없이 수집한다')
  .version('0.1.0')
  .option('--adb <path>', 'adb 실행 파일 경로')
  /**
   * 조회 명령의 출력을 JSON 으로. **사람이 읽는 문장이 기본이고 이것은 추가 모드다** —
   * 사람과 기계(CI · LLM)가 둘 다 소비자이므로 어느 한쪽으로 바꾸지 않는다.
   *
   * `start` / `stop` / `mark` 에는 없다. 그 셋의 출력은 이미 한 줄이고(경로 하나), 시작 전에
   * 알아야 할 것(이 기기가 뭘 잴 수 있나)은 `doctor --json` 이 전부 준다.
   */
  .option('--json', '조회 결과를 JSON 으로 출력한다 (doctor · devices · apps · status · runs)', false)

program
  .command('doctor')
  .description('환경과 기기 지원 여부를 점검한다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    const checks = await runDoctor({ ...program.opts(), ...opts })
    emit(checks, formatDoctor(checks))
    // capability 실패(이 기기가 원래 못 재는 것)는 종료 코드를 바꾸지 않는다.
    if (hasBlockingFailure(checks)) process.exitCode = 1
  })

program
  .command('devices')
  .description('연결된 기기와 스펙 요약을 보여준다')
  .action(async () => {
    const devices = await listDeviceSummaries(program.opts())
    emit(devices, formatDevices(devices))
  })

program
  .command('apps')
  .description('설치된 서드파티 앱을 런처 이름으로 보여준다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    const ctx = await createContext({ ...program.opts(), ...opts })
    const apps = await loadLabeledApps(ctx)
    emit(apps, formatApps(apps))
  })

program
  .command('schema')
  .description('result.json 의 JSON Schema 를 출력한다')
  .action(() => {
    console.log(runSchema())
  })

program
  .command('start')
  .description('측정 세션을 시작한다')
  .option('-a, --app <라벨|패키지>', '대상 앱 (생략 시 포그라운드 앱)')
  .option('-n, --name <이름>', '세션 이름')
  .option('-d, --device <serial>', '대상 기기 serial')
  .option('--launch', '앱을 콜드 상태로 실행하고 시작 시간을 측정한다', false)
  .option('-o, --out <dir>', '결과를 저장할 디렉토리', 'runs')
  .option('--force', '이 기기의 기존 세션을 버리고 시작한다', false)
  .action(async (opts: { app?: string; name?: string; launch: boolean; out: string; force: boolean; device?: string }) => {
    const ctx = await createContext({ ...program.opts(), device: opts.device })
    console.log(await runStart(ctx, opts))
  })

program
  .command('mark')
  .description('측정 중인 세션에 마킹을 남긴다 (기기에 접촉하지 않음)')
  .argument('<라벨>', '이벤트 이름 (예: "스크롤 시작")')
  .option('-s, --session <id>', '세션 고유값. status 가 괄호 안에 보여 주는 값이다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (label: string, opts: { session?: string; device?: string }) => {
    // createContext 를 부르지 않는다 — 이 명령은 호스트의 파일만 고친다 (규칙 1).
    console.log(await runMark(label, opts))
  })

/**
 * 기록 관리. **기기에 접촉하지 않는다** — `createContext` 를 부르지 않는 것이 그 증거다.
 * GUI 에만 있던 기능을 CLI 에도 낸다: "GUI 로는 되는데 CLI 로는 안 되는 일" 을 만들지 않는다.
 */
const runs = program.command('runs').description('측정 기록을 보고 정리한다 (기기 불필요)')

runs
  .command('list', { isDefault: true })
  .description('기록 목록')
  .option('-o, --out <dir>', '기록이 있는 디렉토리', 'runs')
  .action(async (opts: { out: string }) => {
    emit(await listRuns(opts.out), await runRunsList(opts))
  })

runs
  .command('rename')
  .description('기록 이름을 바꾼다 (디렉토리 경로는 그대로)')
  .argument('<id>', '기록 id')
  .argument('<이름>', '새 이름')
  .option('-o, --out <dir>', '기록이 있는 디렉토리', 'runs')
  .action(async (id: string, name: string, opts: { out: string }) => {
    console.log(await runRunsRename(id, name, opts))
  })

runs
  .command('rm')
  .description('기록을 지운다 (run 디렉토리째, 되돌릴 수 없음)')
  .argument('[id]', '기록 id')
  .option('--all', '전부 지운다 (--yes 필요)', false)
  .option('--yes', '--all 을 실제로 실행한다', false)
  .option('-o, --out <dir>', '기록이 있는 디렉토리', 'runs')
  .action(async (id: string | undefined, opts: { all: boolean; yes: boolean; out: string }) => {
    console.log(await runRunsRemove(id, opts))
  })

program
  .command('gui')
  .description('로컬 웹 GUI 를 띄운다 (화면 + JSON API)')
  .option('-p, --port <포트>', '고정 포트 (생략 시 빈 포트를 고른다)')
  .option('-o, --out <dir>', '결과를 저장할 디렉토리', 'runs')
  .option('--no-open', '브라우저를 자동으로 열지 않는다')
  .action(async (opts: { port?: string; out: string; open: boolean }) => {
    await runGui({ ...opts, ...program.opts() })
  })

program
  .command('status')
  .description('진행 중인 세션을 보여준다 (기기에 접촉하지 않음)')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    emit(await statusData(opts.device), await runStatus(opts.device))
  })

program
  .command('stop')
  .description('세션을 끝내고 트레이스를 회수해 result.json 을 만든다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .option('--offline', 'trace_processor 를 내려받지 않는다', false)
  .action(async (opts: { device?: string; offline: boolean }) => {
    const ctx = await createContext({ ...program.opts(), device: opts.device })
    console.log(await runStop(ctx, { offline: opts.offline }))
  })

program
  .command('extract')
  .description('원본을 다시 파싱해 result.json 을 만든다 (기기 불필요)')
  .argument('<run-dir>', 'run 디렉토리 경로')
  .option('--offline', 'trace_processor 를 내려받지 않는다', false)
  .action(async (runDir: string, opts: { offline: boolean }) => {
    console.log(await runExtract(runDir, opts))
  })

try {
  await program.parseAsync(process.argv)
} catch (e) {
  process.exitCode = 1
  if (e instanceof PerfTrackerError) {
    console.error(e.message)
  } else {
    // 알려지지 않은 오류도 unhandled rejection 으로 흘리지 않는다 — 사용자가 보는 첫 줄은
    // 한국어 문장이어야 하고, 진단용 스택은 그 뒤에 붙인다.
    console.error('예상치 못한 오류가 발생했습니다. 아래 내용과 함께 이슈로 알려주세요.')
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
}
