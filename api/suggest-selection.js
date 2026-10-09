import { createStickerEvaluationHandlers } from '../server/evaluation.js'

const handlers = createStickerEvaluationHandlers({
  baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
  model: process.env.OLLAMA_MODEL || 'gemma4:31b',
  apiKey: process.env.OLLAMA_API_KEY || '',
})

export default handlers.suggestSelection
