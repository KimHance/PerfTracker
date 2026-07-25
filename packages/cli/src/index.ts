#!/usr/bin/env node
import { Command } from 'commander'
import { PerfTrackerError } from '@perftracker/core'
import { formatApps, loadLabeledApps } from './commands/apps.js'
import { formatDoctor, runDoctor } from './commands/doctor.js'
import { runDevices } from './commands/devices.js'
import { runExtract } from './commands/extract.js'
import { runSchema } from './commands/schema.js'
import { runStart } from './commands/start.js'
import { runStatus } from './commands/status.js'
import { runStop } from './commands/stop.js'
import { createContext } from './context.js'

const program = new Command()

program
  .name('perftracker')
  .description('안드로이드 앱 성능 데이터를 코드 수정 없이 수집한다')
  .version('0.1.0')
  .option('--adb <path>', 'adb 실행 파일 경로')

program
  .command('doctor')
  .description('환경과 기기 지원 여부를 점검한다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    const checks = await runDoctor({ ...program.opts(), ...opts })
    console.log(formatDoctor(checks))
    if (checks.some((c) => !c.ok)) process.exitCode = 1
  })

program
  .command('devices')
  .description('연결된 기기와 스펙 요약을 보여준다')
  .action(async () => {
    console.log(await runDevices(program.opts()))
  })

program
  .command('apps')
  .description('설치된 서드파티 앱을 런처 이름으로 보여준다')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    const ctx = await createContext({ ...program.opts(), ...opts })
    console.log(formatApps(await loadLabeledApps(ctx)))
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
    console.log(await runStart(ctx, { ...opts, video: false }))
  })

program
  .command('status')
  .description('진행 중인 세션을 보여준다 (기기에 접촉하지 않음)')
  .option('-d, --device <serial>', '대상 기기 serial')
  .action(async (opts: { device?: string }) => {
    console.log(await runStatus(opts.device))
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
