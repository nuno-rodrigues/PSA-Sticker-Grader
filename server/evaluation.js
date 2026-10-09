import { timingSafeEqual } from 'node:crypto'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_REQUEST_BYTES = 12 * 1024 * 1024
const imageDataPattern = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/
const scoreValues = [10, 9, 8, 6]
const criterionIds = ['centering', 'corners', 'edges', 'surface']

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    if (request.body !== undefined) {
      try {
        const body = typeof request.body === 'string' || Buffer.isBuffer(request.body)
          ? JSON.parse(request.body.toString())
          : request.body
        if (!body || typeof body !== 'object') throw new Error()
        resolve(body)
      } catch {
        const error = new Error('Request body must be valid JSON.')
        error.statusCode = 400
        reject(error)
      }
      return
    }

    const chunks = []
    let size = 0
    let settled = false

    const rejectRequest = (message, statusCode) => {
      if (settled) return
      settled = true
      const error = new Error(message)
      error.statusCode = statusCode
      reject(error)
    }

    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) {
        rejectRequest('The uploaded image is too large. Please use an image under 8 MB.', 413)
        request.resume()
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (settled) return
      try {
        settled = true
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        const error = new Error('Request body must be valid JSON.')
        error.statusCode = 400
        reject(error)
      }
    })

    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function isEvaluation(value) {
  return value
    && typeof value === 'object'
    && typeof value.isSticker === 'boolean'
    && value.scores
    && value.notes
    && criterionIds.every((id) => scoreValues.includes(value.scores[id])
      && typeof value.notes[id] === 'string')
    && typeof value.summary === 'string'
    && typeof value.marketSearchQuery === 'string'
    && value.marketSearchQuery.length <= 120
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text)
  } catch (originalError) {
    let start = -1
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]
      if (start === -1) {
        if (character === '{') {
          start = index
          depth = 1
        }
        continue
      }

      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }

      if (character === '"') inString = true
      else if (character === '{') depth += 1
      else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1))
          } catch {
            break
          }
        }
      }
    }

    throw originalError
  }
}

function isOllamaCloud(baseUrl) {
  try {
    return new URL(baseUrl).hostname === 'ollama.com'
  } catch {
    return false
  }
}

async function handleEvaluation(request, response, ollamaBaseUrl, model, apiKey) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Use POST to evaluate an image.' })
    return
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message })
    return
  }

  const language = body?.language === 'pt' || body?.language === 'es' ? body.language : 'en'
  const match = typeof body?.imageData === 'string' ? imageDataPattern.exec(body.imageData) : null
  if (!match || Buffer.byteLength(match[1], 'base64') > MAX_IMAGE_BYTES) {
    sendJson(response, 400, { error: 'Upload a valid image smaller than 8 MB.' })
    return
  }

  const schema = {
    type: 'object',
    properties: {
      isSticker: { type: 'boolean' },
      scores: {
        type: 'object',
        properties: Object.fromEntries(criterionIds.map((id) => [id, { type: 'integer', enum: scoreValues }])),
        required: criterionIds,
        additionalProperties: false,
      },
      notes: {
        type: 'object',
        properties: Object.fromEntries(criterionIds.map((id) => [id, { type: 'string' }])),
        required: criterionIds,
        additionalProperties: false,
      },
      summary: { type: 'string' },
      marketSearchQuery: { type: 'string', maxLength: 120 },
    },
    required: ['isSticker', 'scores', 'notes', 'summary', 'marketSearchQuery'],
    additionalProperties: false,
  }
  const useOllamaCloud = isOllamaCloud(ollamaBaseUrl)
  if (useOllamaCloud && !apiKey) {
    sendJson(response, 503, { error: 'Ollama Cloud is not configured. Set OLLAMA_API_KEY on the server, then try again.' })
    return
  }

  let ollamaResponse
  try {
    ollamaResponse = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        ...(useOllamaCloud ? {} : { format: schema }),
        options: { temperature: 0 },
        messages: [{
          role: 'user',
          content: `Assess the actual sticker visible in this photo, not just the artwork or a graphic that might represent a sticker. Set isSticker to true only if a sticker is clearly identifiable in the photo. If no sticker is clearly visible, set isSticker to false, use 10 for every score, explain that it cannot be assessed in every note, and do not invent a condition summary. When a sticker is visible, score centering, corners, edges, and surface using only 10, 9, 8, or 6. Judge the sticker boundaries and surface only; do not mistake rounded artwork, image composition, or lighting for sticker wear. Be conservative and cite visible evidence in each short note. If an area is obscured, too small, or not assessable from this view, clearly say so and avoid claiming defects you cannot see. These are informal estimates, not official PSA grades. Also provide marketSearchQuery: a concise, factual marketplace search phrase identifying the sticker from visible text, brand, character, or series; do not include a condition or price. Return an empty string if you cannot identify it confidently.\n\nWrite the summary and all notes in ${language === 'pt' ? 'European Portuguese' : language === 'es' ? 'Spanish' : 'English'}. Return only a JSON object matching this schema, with no markdown or extra text: ${JSON.stringify(schema)}`,
          images: [match[1]],
        }],
      }),
      signal: AbortSignal.timeout(180_000),
    })
  } catch (error) {
    if (error.name === 'TimeoutError') {
      sendJson(response, 504, { error: 'The vision model took too long to respond. Try again or use a smaller image.' })
      return
    }
    console.error('Ollama sticker evaluation request failed:', error)
    sendJson(response, 503, { error: 'Could not reach the configured Ollama server. Check its URL, then try again.' })
    return
  }

  let result
  try {
    result = await ollamaResponse.json()
  } catch (error) {
    console.error('Could not read Ollama sticker evaluation response:', error)
    sendJson(response, 502, { error: 'Ollama returned an unreadable response. Please try again.' })
    return
  }

  if (!ollamaResponse.ok) {
    const message = result?.error || `Ollama request failed with status ${ollamaResponse.status}.`
    console.error('Ollama sticker evaluation failed:', message)
    if (ollamaResponse.status === 404) {
      sendJson(response, 503, {
        error: useOllamaCloud
          ? `The "${model}" model is not available in Ollama Cloud. Set OLLAMA_MODEL to a model available in your Ollama Cloud account.`
          : `The "${model}" model is not available on the configured Ollama server. Install it on the machine running Ollama with "ollama pull ${model}", or set OLLAMA_MODEL to a model already installed there.`,
      })
      return
    }
    sendJson(response, 502, { error: message })
    return
  }

  const outputText = result.message?.content

  if (typeof outputText !== 'string') {
    console.error('Ollama sticker evaluation response did not contain structured output.')
    sendJson(response, 502, { error: 'Ollama did not return an evaluation. Please try again.' })
    return
  }

  let evaluation
  try {
    evaluation = parseJsonObject(outputText)
  } catch (error) {
    console.error('Ollama sticker evaluation returned invalid JSON:', error)
    sendJson(response, 502, { error: 'Ollama returned an invalid evaluation. Please try again.' })
    return
  }

  if (!isEvaluation(evaluation)) {
    console.error('Ollama sticker evaluation did not match the expected result format.')
    sendJson(response, 502, { error: 'Ollama returned an incomplete evaluation. Please try again.' })
    return
  }

  sendJson(response, 200, {
    ...evaluation,
    marketSearchQuery: evaluation.marketSearchQuery.replace(/\s+/g, ' ').trim(),
  })
}

async function handleSelectionSuggestion(request, response, ollamaBaseUrl, model, apiKey) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Use POST to suggest a selection for an image.' })
    return
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message })
    return
  }

  const match = typeof body?.imageData === 'string' ? imageDataPattern.exec(body.imageData) : null
  if (!match || Buffer.byteLength(match[1], 'base64') > MAX_IMAGE_BYTES) {
    sendJson(response, 400, { error: 'Upload a valid image smaller than 8 MB.' })
    return
  }

  const selectionSchema = {
    type: 'object',
    properties: {
      selection: {
        anyOf: [
          {
            type: 'object',
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              width: { type: 'number', minimum: 0.03, maximum: 1 },
              height: { type: 'number', minimum: 0.03, maximum: 1 },
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
    },
    required: ['selection'],
    additionalProperties: false,
  }
  const useOllamaCloud = isOllamaCloud(ollamaBaseUrl)
  if (useOllamaCloud && !apiKey) {
    sendJson(response, 503, { error: 'Ollama Cloud is not configured. Set OLLAMA_API_KEY on the server, then try again.' })
    return
  }

  let ollamaResponse
  try {
    ollamaResponse = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        ...(useOllamaCloud ? {} : { format: selectionSchema }),
        options: { temperature: 0 },
        messages: [{
          role: 'user',
          content: `Find the visible physical sticker in this photo, not a sticker depicted as part of another image. Return the tightest reliable rectangle around the sticker, including its full outer edges and corners. Coordinates must be normalized from 0 to 1 relative to the complete image, with x and y at the top-left and width and height as fractions of the image dimensions. Return selection as null if no physical sticker can be clearly located. Do not assess condition or provide a grade. Return only a JSON object matching this schema, with no markdown or extra text: ${JSON.stringify(selectionSchema)}`,
          images: [match[1]],
        }],
      }),
      signal: AbortSignal.timeout(180_000),
    })
  } catch (error) {
    if (error.name === 'TimeoutError') {
      sendJson(response, 504, { error: 'The vision model took too long to suggest a selection. Try again or use your own selection.' })
      return
    }
    console.error('Ollama sticker selection request failed:', error)
    sendJson(response, 503, { error: 'Could not reach the configured Ollama server. Check its URL, then try again.' })
    return
  }

  let result
  try {
    result = await ollamaResponse.json()
  } catch (error) {
    console.error('Could not read Ollama sticker selection response:', error)
    sendJson(response, 502, { error: 'Ollama returned an unreadable selection suggestion. Please try again.' })
    return
  }

  if (!ollamaResponse.ok) {
    const message = result?.error || `Ollama request failed with status ${ollamaResponse.status}.`
    console.error('Ollama sticker selection request failed:', message)
    if (ollamaResponse.status === 404) {
      sendJson(response, 503, {
        error: useOllamaCloud
          ? `The "${model}" model is not available in Ollama Cloud. Set OLLAMA_MODEL to a model available in your Ollama Cloud account.`
          : `The "${model}" model is not available on the configured Ollama server. Install it on the machine running Ollama with "ollama pull ${model}", or set OLLAMA_MODEL to a model already installed there.`,
      })
      return
    }
    sendJson(response, 502, { error: message })
    return
  }

  const outputText = result.message?.content
  let suggestion
  try {
    if (typeof outputText !== 'string') throw new Error('Ollama returned no structured selection.')
    suggestion = parseJsonObject(outputText)
  } catch (error) {
    console.error('Ollama sticker selection response was invalid:', error)
    sendJson(response, 502, { error: 'Ollama returned an invalid selection suggestion. Please try again.' })
    return
  }

  const selection = suggestion?.selection
  if (selection !== null && (!selection
    || ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite)
    || selection.x < 0
    || selection.y < 0
    || selection.width < 0.03
    || selection.height < 0.03
    || selection.x + selection.width > 1
    || selection.y + selection.height > 1)) {
    console.error('Ollama sticker selection response contained out-of-bounds coordinates.')
    sendJson(response, 502, { error: 'Ollama returned an invalid selection suggestion. Please try again.' })
    return
  }

  sendJson(response, 200, { selection })
}

async function handleUnlock(request, response, unlockKey) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Use POST to verify an unlock key.' })
    return
  }
  if (!unlockKey) {
    sendJson(response, 503, { error: 'Unlock-key verification is not configured on this server.' })
    return
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message })
    return
  }

  const submittedKey = typeof body?.key === 'string' ? body.key.trim() : ''
  const submitted = Buffer.from(submittedKey)
  const expected = Buffer.from(unlockKey)
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
    sendJson(response, 401, { error: 'The unlock key is not valid.' })
    return
  }

  sendJson(response, 200, { valid: true })
}

export function createStickerEvaluationHandlers({
  baseUrl = 'https://ollama.com',
  model = 'gemma4:31b',
  apiKey = '',
  unlockKey = '',
} = {}) {
  const middleware = (request, response) => {
    handleEvaluation(request, response, baseUrl.replace(/\/+$/, ''), model, apiKey).catch((error) => {
      console.error('Unexpected sticker evaluation server error:', error)
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'An unexpected error interrupted the evaluation. Please try again.' })
      } else {
        response.end()
      }
    })
  }
  const selectionMiddleware = (request, response) => {
    handleSelectionSuggestion(request, response, baseUrl.replace(/\/+$/, ''), model, apiKey).catch((error) => {
      console.error('Unexpected sticker selection server error:', error)
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'An unexpected error interrupted the selection suggestion. Please try again.' })
      } else {
        response.end()
      }
    })
  }
  const unlockMiddleware = (request, response) => {
    handleUnlock(request, response, unlockKey).catch((error) => {
      console.error('Unexpected sticker unlock verification error:', error)
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'An unexpected error interrupted key verification.' })
      } else {
        response.end()
      }
    })
  }

  return { evaluate: middleware, suggestSelection: selectionMiddleware, unlock: unlockMiddleware }
}

export function stickerEvaluationApi(options = {}) {
  const { evaluate, suggestSelection, unlock } = createStickerEvaluationHandlers(options)

  return {
    name: 'sticker-evaluation-api',
    configureServer(server) {
      server.middlewares.use('/api/evaluate', evaluate)
      server.middlewares.use('/api/suggest-selection', suggestSelection)
      server.middlewares.use('/api/unlock', unlock)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/evaluate', evaluate)
      server.middlewares.use('/api/suggest-selection', suggestSelection)
      server.middlewares.use('/api/unlock', unlock)
    },
  }
}
