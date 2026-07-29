import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { createHttpClient } from './api/http.js'
import { createMockClient } from './api/mock.js'
import { StoreProvider } from './state/StoreContext.jsx'
import { ReportPage } from './report/ReportPage.jsx'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'
import './report/report.css'

/**
 * 목업으로 띄우려면 `?mock` 을 붙인다 (`http://localhost:5173/?mock`).
 * 기기 0대 화면은 `?mock=empty`.
 *
 * 기본은 실제 서버다 — 목업이 기본이면 언젠가 목업 화면을 보고 "측정됐다" 고 믿게 된다.
 */
const params = new URLSearchParams(window.location.search)

const root = document.getElementById('root')
if (!root) throw new Error('#root 를 찾지 못했습니다')

/**
 * **보고서는 별도 화면이다.** `?report=<run id>` 면 측정 화면 대신 보고서를 띄운다.
 *
 * 라우터를 들이지 않았다 — 경로가 둘뿐이고, 이 저장소는 런타임 의존성을 늘리는 값을 매번
 * 따진다 (core 는 zod 하나, cli 는 commander 하나로 산다). 쿼리 문자열이라 딥링크가 된다.
 */
const reportRun = params.get('report')

if (reportRun !== null && reportRun !== '') {
  createRoot(root).render(
    <StrictMode>
      <ReportPage runId={reportRun} />
    </StrictMode>,
  )
} else {
  const mock = params.has('mock')
  const api = mock
    ? createMockClient({ noDevices: params.get('mock') === 'empty' })
    : createHttpClient()

  createRoot(root).render(
    <StrictMode>
      <StoreProvider api={api}>
        <App mock={mock} />
      </StoreProvider>
    </StrictMode>,
  )
}
