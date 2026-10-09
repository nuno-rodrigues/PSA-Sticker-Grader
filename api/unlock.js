import { createStickerEvaluationHandlers } from '../server/evaluation.js'

const handlers = createStickerEvaluationHandlers({
  unlockKey: process.env.STICKER_CHECK_UNLOCK_KEY || '',
})

export default handlers.unlock
