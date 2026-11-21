import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const { GARDEN_BACKEND_URL = 'http://127.0.0.1:8000' } = loadEnv(mode, '.', 'GARDEN_')
  const proxy = { '/api/v1': GARDEN_BACKEND_URL }
  return { plugins: [react()], server: { proxy }, preview: { proxy } }
})
