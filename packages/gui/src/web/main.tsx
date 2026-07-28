import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { createHttpClient } from './api/http.js'
import { createMockClient } from './api/mock.js'
import { StoreProvider } from './state/StoreContext.jsx'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'

/**
 * 목업으로 띄우려면 `?mock` 을 붙인다 (`http://localhost:5173/?mock`).
 * 기기 0대 화면은 `?mock=empty`.
 *
 * 기본은 실제 서버다 — 목업이 기본이면 언젠가 목업 화면을 보고 "측정됐다" 고 믿게 된다.
 */
const params = new URLSearchParams(window.location.search)
const mock = params.has('mock')
const api = mock
  ? createMockClient({ noDevices: params.get('mock') === 'empty' })
  : createHttpClient()

const root = document.getElementById('root')
if (!root) throw new Error('#root 를 찾지 못했습니다')

createRoot(root).render(
  <StrictMode>
    <StoreProvider api={api}>
      <App mock={mock} />
    </StoreProvider>
  </StrictMode>,
)
