import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { stickerEvaluationApi } from './server/evaluation.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      stickerEvaluationApi({
        baseUrl: process.env.OLLAMA_BASE_URL || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        model: process.env.OLLAMA_MODEL || env.OLLAMA_MODEL || 'gemma3:4b',
        unlockKey: process.env.STICKER_CHECK_UNLOCK_KEY || env.STICKER_CHECK_UNLOCK_KEY || '',
      }),
    ],
  }
})
