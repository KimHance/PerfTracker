#!/usr/bin/env node
import { PerfTrackerError } from '@perftracker/core'
import { buildProgram } from './program.js'
import { unexpectedErrorText } from './unexpected.js'

/**
 * 진입점. **등록은 `program.ts` 가 하고 여기는 실행과 오류 처리만 한다** —
 * 명령 트리를 import 만으로 읽을 수 있어야 테스트가 그것을 README 와 대조할 수 있다.
 */
try {
  await buildProgram().parseAsync(process.argv)
} catch (e) {
  process.exitCode = 1
  if (e instanceof PerfTrackerError) {
    console.error(e.message)
  } else {
    // 알려지지 않은 오류도 unhandled rejection 으로 흘리지 않는다 — 사용자가 보는 첫 줄은
    // 한국어 문장이어야 하고, 진단용 스택은 그 뒤에 붙인다.
    console.error(unexpectedErrorText(e))
  }
}
