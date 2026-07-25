#!/usr/bin/env node
import { Command } from 'commander'
import { PerfTrackerError } from '@perftracker/core'
import { formatApps, loadLabeledApps } from './commands/apps.js'
import { formatDoctor, runDoctor } from './commands/doctor.js'
import { runDevices } from './commands/devices.js'
import { runSchema } from './commands/schema.js'
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

try {
  await program.parseAsync(process.argv)
} catch (e) {
  if (e instanceof PerfTrackerError) {
    console.error(e.message)
    process.exitCode = 1
  } else {
    throw e
  }
}
