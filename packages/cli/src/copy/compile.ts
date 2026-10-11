/**
 * `start --compile` (기능 문서 baseline-profile BP-4 ~ BP-6) 의 cli 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/baseline-profile.md` 의 `## 문구` 표다.** 표의 cli 줄과 이 모음은
 * 양방향으로 같아야 한다 — `test/copy/compile.test.ts` 가 대조한다. 문구를 바꾸려면 표를 먼저 고친다.
 * `{…}` 는 값 자리이고 `fillCopy` 가 채운다.
 *
 * 표의 cli 줄 가운데 다섯(실패 머리 둘 · 보낸 명령 · 거부 둘)은 **core 가 오류 message 로 낸다**
 * (`CompileFailedError` · `checkCompileOption`) — cli 는 그 message 를 그대로 찍는다. 여기 같이 두는 것은
 * 표 ↔ 코드 대조를 한 곳에서 하려는 것이고, 시험이 core 의 실제 message 와 이 틀이 같은지 본다.
 *
 * 꼴은 단어형 (DM-15) — 끝 글자 `다`/`요` · 권유 · 평가 낱말 없음. 되돌림 명령 둘 말고는 80칸 안이다.
 * 되돌림 명령은 호스트에서 그대로 쳐서 도는 한 줄이라 80칸 규칙 밖이다 (결정 13).
 */
export const COMPILE_CLI_COPY = {
  /** `start --help` 의 `--compile <값>` 설명. `--launch 와만` 은 거부 줄 · README · cli AGENTS 가 말한다. */
  helpCompile: '기기 컴파일 상태 바꿈 · reset · speed-profile · speed',
  /** `start` · `status` 의 컴파일 줄 — `[primary-abi]` 줄의 바꾸기 전 → 뒤 `status`. 라벨은 기존 줄처럼 10칸. */
  compileLine: 'Compile   {value} · base.apk {before} → {after} · {ms} ms',
  /** 되돌림 머리 — 자동으로 되돌리지 않는다 (결정 4) · 한계 둘. */
  revertHead: '되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음',
  /** 되돌림 명령 (base). 호스트 꼴 · 80칸 밖. */
  revertBase: 'adb -s {serial} shell cmd package compile -m {status} -f {pkg}',
  /** 되돌림 명령 (보조 dex). */
  revertSecondary: 'adb -s {serial} shell cmd package compile -m {status} -f --secondary-dex {pkg}',
  /** 바꾸기 전 보조 dex 의 `status` 가 서로 다를 때. */
  secondaryMixed: '보조 dex {n}개 · status 서로 다름 · 보조 dex 되돌림 줄 없음',
  /** 바꾸기 전 보조 dex `status` 가 모두 같은데 `-m` 이 받는 값 밖 — 침묵하지 않는다 (plan B34 #5). */
  secondaryOutside: '보조 dex {n}개 · status {status} · -m 이 받지 않는 값 · 되돌림 줄 없음',
  /** 바꾸기 전 base.apk `status` 가 `-m` 이 받는 값 밖. */
  revertOutside: '되돌림 줄 없음 · 바꾸기 전 base.apk status {status} · -m 이 받지 않는 값',
  /** 바꾸기 전 base.apk `status` 를 모름 (BP-2 null · base 줄을 하나로 못 고름). */
  revertUnknown: '되돌림 줄 없음 · 바꾸기 전 base.apk status 모름',
  /** 실패 머리 — core `CompileFailedError` 가 낸다. */
  failExit: '컴파일 실패 · 세션 안 엶 · exit {code}',
  /** 실패 머리 (한도) — core `CompileFailedError` 가 낸다. */
  failTimeout: '컴파일 한도 10분 넘음 · 세션 안 엶',
  /** 실패 · 보낸 명령 — core `CompileFailedError` 가 낸다. */
  failCommand: '보낸 명령  {cmd}',
  /** 실패 · 상태 줄 — 실패 뒤 다시 읽지 않는다 (기기 명령 0). */
  failState: 'Compile   {value} · base.apk 바꾸기 전 {before} · 지금 모름',
  /** 컴파일 줄 · 실패 상태 줄의 `{before}` · `{after}` 값을 모를 때 — `status 모름` · `지금 모름` 과 같은 말 (plan B34 #3). */
  unknownWord: '모름',
  /** 거부 · `--launch` 없음 — core `checkCompileOption` 이 낸다. */
  rejectLaunch: '--compile 은 --launch 와만 · 기기 명령 0',
  /** 거부 · 허용 밖 값 — core `checkCompileOption` 이 낸다. */
  rejectValue: '--compile {value} · 받는 값 reset · speed-profile · speed · 기기 명령 0',
} as const

/**
 * 값 자리를 채운다. 모르는 자리가 남으면 던진다 — `{before}` 같은 글자가 사용자 화면에 그대로 나가면 안 된다.
 */
export function fillCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key]
    if (v === undefined) throw new Error(`문구 값 자리 {${key}} 를 채우지 않았다: ${template}`)
    return String(v)
  })
}
