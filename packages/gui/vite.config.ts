import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // `perftracker gui` 가 이 디렉토리를 정적으로 서빙한다.
    outDir: 'dist-web',
    emptyOutDir: true,
  },
  server: {
    // 개발 중에는 vite(5173)가 화면을, GUI 서버(7333)가 API 를 맡는다.
    // 목업(`?mock`)으로 볼 때는 서버가 없어도 되지만, 실제 데이터를 붙일 때는 이 프록시가
    // 브라우저의 same-origin 문제를 없앤다.
    proxy: { '/api': 'http://127.0.0.1:7333' },
  },
})
