import assert from 'node:assert/strict'
import test from 'node:test'
import { createStickerEvaluationHandlers } from '../server/evaluation.js'

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = JSON.parse(body)
      this.resolve()
    },
  }
}

async function invoke(handler, body) {
  const response = mockResponse()
  const completed = new Promise((resolve) => { response.resolve = resolve })
  handler({ method: 'POST', body }, response)
  await completed
  return response
}

test('selection suggestion returns validated normalized sticker bounds without evaluating condition', async (context) => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(input).pathname, '/api/chat')
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      message: { content: JSON.stringify({ selection: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } }) },
    }), { status: 200 })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const handlers = createStickerEvaluationHandlers({
    baseUrl: 'https://ollama.com',
    model: 'vision-model',
    apiKey: 'test-key',
  })
  const response = await invoke(handlers.suggestSelection, {
    imageData: 'data:image/jpeg;base64,dGVzdA==',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body.selection, { x: 0.2, y: 0.1, width: 0.6, height: 0.8 })
  assert.match(requestBody.messages[0].content, /Do not assess condition/)
  assert.deepEqual(requestBody.messages[0].images, ['dGVzdA=='])
})

test('selection suggestion accepts no detection and rejects out-of-bounds coordinates', async (context) => {
  const originalFetch = globalThis.fetch
  let selection = null
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: { content: JSON.stringify({ selection }) },
  }), { status: 200 })
  context.after(() => { globalThis.fetch = originalFetch })

  const handler = createStickerEvaluationHandlers({
    baseUrl: 'https://ollama.com',
    apiKey: 'test-key',
  }).suggestSelection
  const body = { imageData: 'data:image/jpeg;base64,dGVzdA==' }

  const noDetection = await invoke(handler, body)
  assert.equal(noDetection.statusCode, 200)
  assert.equal(noDetection.body.selection, null)

  selection = { x: 0.7, y: 0.1, width: 0.4, height: 0.5 }
  const invalidBounds = await invoke(handler, body)
  assert.equal(invalidBounds.statusCode, 502)
  assert.match(invalidBounds.body.error, /invalid selection/)
})

test('selection suggestion rejects invalid image data before calling Ollama', async () => {
  const handler = createStickerEvaluationHandlers().suggestSelection
  const response = await invoke(handler, { imageData: 'not-an-image' })

  assert.equal(response.statusCode, 400)
  assert.match(response.body.error, /valid image/)
})
