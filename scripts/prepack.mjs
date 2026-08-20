import { accessSync, copyFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `npm pack` · `npm publish` 직전에 각 패키지에서 도는 훅.
 *
 * 두 가지를 한다:
 *
 * 1. **빌드 산출물이 있는지 확인한다.** 없으면 여기서 멈춘다. 빌드 안 된 채로 올라간
 *    패키지는 설치는 되는데 첫 명령에서 죽고, 올린 버전은 되돌릴 수 없다.
 *    실제로 `files` 필드가 없던 시절 이 저장소는 `dist` 가 통째로 빠진 tarball 을 만들었다.
 * 2. **루트의 `LICENSE`(와 CLI 는 `README.md`)를 패키지 안으로 복사한다.**
 *    npm 은 패키지 디렉토리 안에 있는 것만 싣는데 이 저장소의 정본은 루트에 하나씩뿐이다.
 *    복사본을 커밋하면 두 벌이 되어 어긋나므로 `.gitignore` 에 두고 **여기서 만든다** —
 *    문서의 출처는 끝까지 하나다.
 *
 * 사용: `node ../../scripts/prepack.mjs <있어야 할 파일...>`
 */
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const pkgDir = process.cwd()

for (const rel of process.argv.slice(2)) {
  try {
    accessSync(join(pkgDir, rel))
  } catch {
    console.error(
      `빌드 산출물이 없습니다: ${basename(pkgDir)}/${rel}\n` +
        '  npm run build 를 먼저 실행하세요.',
    )
    process.exit(1)
  }
}

// README 는 npm 페이지에 그대로 뜬다. 사용자가 보는 문서라 CLI 에만 붙인다 —
// core·gui 는 라이브러리라 npm 페이지를 읽고 설치하는 사람이 없다.
const copies = basename(pkgDir) === 'cli' ? ['LICENSE', 'README.md'] : ['LICENSE']
for (const name of copies) {
  copyFileSync(join(root, name), join(pkgDir, name))
}
