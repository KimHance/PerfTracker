import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GuiApi, type GuiOptions, toErrorMessage } from './api.js'

/**
 * 로컬호스트 GUI 서버.
 *
 * **프레임워크를 쓰지 않는다.** 라우트가 열 몇 개뿐이고, 이 저장소의 런타임 의존성을
 * 늘리는 값이 그만큼 되지 않는다 (core 는 zod 하나, cli 는 commander 하나로 산다).
 *
 * **127.0.0.1 에만 바인딩한다.** 이 서버는 붙어 있는 기기에 adb 를 보내고 파일을 지울 수
 * 있다 — 같은 네트워크의 다른 사람에게 그 권한을 줄 이유가 없다. `--host` 같은 옵션을
 * 만들지 않은 것은 빠뜨린 것이 아니다.
 */

const HOST = '127.0.0.1'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return (text === '' ? {} : JSON.parse(text)) as T
}

/** 빌드된 프론트엔드가 있는 자리. `dist/server/` 기준 두 단계 위가 패키지 루트다. */
function webRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist-web')
}

/**
 * 정적 파일. **경로 탈출을 먼저 막는다** — 이 서버는 사용자의 홈 디렉토리에서 돌고,
 * `../../.ssh/id_rsa` 를 그대로 열어 주면 그것이 유출이다.
 */
async function serveStatic(res: ServerResponse, urlPath: string): Promise<boolean> {
  const root = webRoot()
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, rel)
  if (file !== root && !file.startsWith(root + sep)) return false

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

interface Route {
  method: string
  pattern: RegExp
  handle: (api: GuiApi, req: IncomingMessage, params: string[], url: URL) => Promise<unknown>
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/api\/env$/, handle: async (api) => api.env() },
  {
    method: 'GET',
    pattern: /^\/api\/doctor$/,
    handle: (api, _req, _p, url) => api.doctor(url.searchParams.get('device')),
  },
  { method: 'GET', pattern: /^\/api\/devices$/, handle: (api) => api.devices() },
  { method: 'GET', pattern: /^\/api\/devices\/([^/]+)\/apps$/, handle: (api, _r, p) => api.apps(decode(p[0])) },
  {
    method: 'POST',
    pattern: /^\/api\/sessions$/,
    handle: async (api, req) => api.start(await readBody(req)),
  },
  {
    method: 'GET',
    pattern: /^\/api\/sessions\/([^/]+)\/marks$/,
    handle: (api, _r, p) => api.marks(decode(p[0])),
  },
  {
    method: 'POST',
    pattern: /^\/api\/sessions\/([^/]+)\/marks$/,
    handle: async (api, req, p) => api.addMark(decode(p[0]), (await readBody<{ label: string }>(req)).label),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/sessions\/([^/]+)\/marks\/(\d+)$/,
    handle: (api, _r, p) => api.removeMark(decode(p[0]), Number(p[1])),
  },
  {
    method: 'POST',
    pattern: /^\/api\/sessions\/([^/]+)\/stop$/,
    handle: async (api, req, p) => api.stop(decode(p[0]), await readBody(req)),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/sessions\/([^/]+)$/,
    handle: async (api, _r, p) => {
      await api.abort(decode(p[0]))
      return undefined
    },
  },
  { method: 'GET', pattern: /^\/api\/runs$/, handle: (api) => api.runs() },
  {
    method: 'DELETE',
    pattern: /^\/api\/runs$/,
    handle: async (api) => {
      await api.clearRuns()
      return undefined
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handle: async (api, req, p) => api.renameRun(decode(p[0]), (await readBody<{ name: string }>(req)).name),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handle: async (api, _r, p) => {
      await api.deleteRun(decode(p[0]))
      return undefined
    },
  },
]

function decode(v: string | undefined): string {
  return decodeURIComponent(v ?? '')
}

export interface GuiServer {
  url: string
  close: () => Promise<void>
}

export async function startGuiServer(opts: GuiOptions & { port?: number }): Promise<GuiServer> {
  const api = new GuiApi(opts)

  const server = createServer((req, res) => {
    void handle(api, req, res)
  })

  await listen(server, opts.port ?? 0)
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : (opts.port ?? 0)

  return {
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
  }
}

async function handle(api: GuiApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  const path = url.pathname

  if (path.startsWith('/api/')) {
    for (const route of ROUTES) {
      if (route.method !== req.method) continue
      const m = route.pattern.exec(path)
      if (m === null) continue
      try {
        const body = await route.handle(api, req, m.slice(1), url)
        if (body === undefined) sendJson(res, 204, undefined)
        else sendJson(res, 200, body)
      } catch (e) {
        // 실패도 계약대로 낸다 — 화면은 `message` 를 그대로 사람에게 보여 준다.
        sendJson(res, 500, { message: toErrorMessage(e) })
      }
      return
    }
    sendJson(res, 404, { message: `알 수 없는 요청입니다: ${req.method} ${path}` })
    return
  }

  if (await serveStatic(res, path)) return

  // SPA 라 라우팅이 없다. 없는 경로는 index.html 로 되돌린다.
  if (await serveStatic(res, '/index.html')) return

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(
    '화면이 빌드되어 있지 않습니다.\n' +
      'npm run build:web -w @perftracker/gui 를 먼저 실행하세요.\n',
  )
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, HOST, () => {
      server.removeListener('error', fail)
      done()
    })
  })
}

export { GuiApi, type GuiOptions } from './api.js'
export { webRoot }
