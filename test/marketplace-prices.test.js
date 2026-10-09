import assert from 'node:assert/strict'
import test from 'node:test'
import { createMarketplacePriceHandler } from '../server/marketplace-prices.js'

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = JSON.parse(body)
    },
  }
}

test('eBay price search returns a same-currency range from active listings', async (context) => {
  const originalFetch = globalThis.fetch
  let tokenRequests = 0
  let searchRequests = 0
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/oauth2/token')) {
      tokenRequests += 1
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 7200 }), { status: 200 })
    }
    searchRequests += 1
    assert.equal(url.searchParams.get('q'), 'Pokemon Pikachu sticker')
    assert.equal(options.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_ES')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    return new Response(JSON.stringify({
      itemSummaries: [10, 20, 30, 40].map((price, index) => ({
        title: `Pikachu sticker ${index + 1}`,
        itemWebUrl: `https://www.ebay.es/itm/${index + 1}`,
        price: { value: String(price), currency: 'EUR' },
      })),
    }), { status: 200 })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const handler = createMarketplacePriceHandler({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    marketplaceId: 'EBAY_ES',
  })
  const invoke = async () => {
    const response = mockResponse()
    await handler({ method: 'POST', body: { query: 'Pokemon Pikachu sticker' } }, response)
    return response
  }

  const firstResponse = await invoke()
  assert.equal(firstResponse.statusCode, 200)
  assert.equal(firstResponse.body.status, 'available')
  assert.deepEqual(firstResponse.body.priceRange, { low: 10, high: 30, currency: 'EUR' })
  assert.equal(firstResponse.body.listingCount, 4)
  assert.equal(firstResponse.body.listings.length, 3)

  const secondResponse = await invoke()
  assert.equal(secondResponse.statusCode, 200)
  assert.equal(tokenRequests, 1)
  assert.equal(searchRequests, 2)
})

test('eBay price search reports missing credentials and rejects empty queries', async () => {
  const handler = createMarketplacePriceHandler()
  const emptyResponse = mockResponse()
  await handler({ method: 'POST', body: { query: ' ' } }, emptyResponse)
  assert.equal(emptyResponse.statusCode, 400)

  const unavailableResponse = mockResponse()
  await handler({ method: 'POST', body: { query: 'sticker' } }, unavailableResponse)
  assert.equal(unavailableResponse.statusCode, 503)
  assert.equal(unavailableResponse.body.code, 'not_configured')
})
