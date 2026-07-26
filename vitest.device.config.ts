import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/on-device/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // 모든 on-device 스펙이 같은 물리 기기(하나의 시리얼)와 하나의 활성 세션 포인터를
    // 공유한다. 파일 단위 병렬 실행을 켜 두면 한 파일의 runStart/runStop 이 다른 파일의
    // 세션을 밟아 "실행 중인 세션이 없습니다" 나 "트레이스 원본이 없습니다" 같은
    // 가짜 실패를 낸다 — 코드가 아니라 테스트 러너의 동시성이 원인이므로 파일 단위로 직렬화한다.
    fileParallelism: false,
  },
})
