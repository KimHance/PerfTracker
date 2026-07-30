import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { createHttpClient } from './api/http.js'
import { createMockClient } from './api/mock.js'
import { StoreProvider } from './state/StoreContext.jsx'
import { ReportPage } from './report/ReportPage.jsx'
import { chooseRoute, hasInlineReport } from './route.js'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'
import './report/report.css'

/**
 * **진입점은 고르기만 한다.** 규칙은 `route.ts` 에 있고 거기서 브라우저 없이 테스트된다 —
 * 이 규칙이 틀리면 나오는 증상이 빈 화면이라 아무 오류도 없이 조용히 깨진다.
 *
 * 목업으로 띄우려면 `?mock` (`http://localhost:5173/?mock`), 기기 0대 화면은 `?mock=empty`.
 * 기본은 실제 서버다 — 목업이 기본이면 언젠가 목업 화면을 보고 "측정됐다" 고 믿게 된다.
 */
const root = document.getElementById('root')
if (!root) throw new Error('#root 를 찾지 못했습니다')

const route = chooseRoute(window.location.search, hasInlineReport())

if (route.kind === 'report') {
  createRoot(root).render(
    <StrictMode>
      <ReportPage runId={route.runId} />
    </StrictMode>,
  )
} else {
  const api = route.mock
    ? createMockClient({ noDevices: route.noDevices })
    : createHttpClient()

  createRoot(root).render(
    <StrictMode>
      <StoreProvider api={api}>
        <App mock={route.mock} />
      </StoreProvider>
    </StrictMode>,
  )
}
