import { createStickerEvaluationHandlers } from '../server/evaluation.js'

const handlers = createStickerEvaluationHandlers({
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma3:4b',
  apiKey: process.env.OLLAMA_API_KEY || '',
  unlockKey: process.env.STICKER_CHECK_UNLOCK_KEY || '',
})

export default handlers.evaluate
