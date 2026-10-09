const ebayApiBaseUrl = 'https://api.ebay.com'
const maxQueryLength = 120

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  if (request.body !== undefined) {
    try {
      const body = typeof request.body === 'string' || Buffer.isBuffer(request.body)
        ? JSON.parse(request.body.toString())
        : request.body
      if (!body || typeof body !== 'object') throw new Error()
      return body
    } catch {
      const error = new Error('Request body must be valid JSON.')
      error.statusCode = 400
      throw error
    }
  }

  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.length
      if (size > 4096) {
        const error = new Error('The search request is too large.')
        error.statusCode = 413
        throw error
      }
      chunks.push(chunk)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object') throw new Error()
    return body
  } catch (originalError) {
    if (originalError.statusCode) throw originalError
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.floor((sortedValues.length - 1) * fraction)]
}

function isEbayUrl(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^www\./, '')
    return url.protocol === 'https:'
      && (hostname === 'ebay.com'
        || hostname.endsWith('.ebay.com')
        || /^ebay\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(hostname))
  } catch {
    return false
  }
}

export function createMarketplacePriceHandler({
  clientId = '',
  clientSecret = '',
  marketplaceId = 'EBAY_ES',
} = {}) {
  let cachedToken = ''
  let tokenExpiresAt = 0

  const getAccessToken = async () => {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const response = await fetch(`${ebayApiBaseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      console.error('eBay OAuth token request failed with status:', response.status)
      throw new Error('Marketplace authentication failed.')
    }

    const tokenResult = await response.json()
    if (typeof tokenResult.access_token !== 'string' || !Number.isFinite(tokenResult.expires_in)) {
      console.error('eBay OAuth returned an incomplete token response.')
      throw new Error('Marketplace authentication returned an invalid response.')
    }

    cachedToken = tokenResult.access_token
    tokenExpiresAt = Date.now() + Math.max(0, tokenResult.expires_in - 60) * 1000
    return cachedToken
  }

  return async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      sendJson(response, 405, { error: 'Use POST to search marketplace prices.' })
      return
    }

    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message })
      return
    }

    const query = typeof body.query === 'string'
      ? body.query.replace(/\s+/g, ' ').trim().slice(0, maxQueryLength)
      : ''
    if (query.length < 2) {
      sendJson(response, 400, { error: 'A sticker search description is required.' })
      return
    }
    if (!clientId || !clientSecret) {
      sendJson(response, 503, {
        code: 'not_configured',
        error: 'eBay live price search is not configured on this server.',
      })
      return
    }
    if (!/^EBAY_[A-Z]{2,3}$/.test(marketplaceId)) {
      console.error('Configured eBay marketplace identifier is invalid.')
      sendJson(response, 500, { code: 'search_failed', error: 'Marketplace price search is unavailable.' })
      return
    }

    try {
      const accessToken = await getAccessToken()
      const searchUrl = new URL(`${ebayApiBaseUrl}/buy/browse/v1/item_summary/search`)
      searchUrl.searchParams.set('q', query)
      searchUrl.searchParams.set('limit', '50')
      const searchResponse = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
        },
        signal: AbortSignal.timeout(10_000),
      })

      if (!searchResponse.ok) {
        console.error('eBay Browse search failed with status:', searchResponse.status)
        sendJson(response, 502, { code: 'search_failed', error: 'Marketplace price search failed.' })
        return
      }

      const searchResult = await searchResponse.json()
      const validListings = (Array.isArray(searchResult.itemSummaries) ? searchResult.itemSummaries : [])
        .filter((item) => Number.isFinite(Number(item.price?.value))
          && Number(item.price.value) > 0
          && typeof item.price.currency === 'string'
          && /^[A-Z]{3}$/.test(item.price.currency))
      const currencyCounts = new Map()
      for (const item of validListings) {
        currencyCounts.set(item.price.currency, (currencyCounts.get(item.price.currency) || 0) + 1)
      }
      const currency = [...currencyCounts.entries()]
        .sort((first, second) => second[1] - first[1])[0]?.[0]

      if (!currency) {
        sendJson(response, 200, { status: 'no_matches', listingCount: 0, query })
        return
      }

      const matchingListings = validListings
        .filter((item) => item.price.currency === currency)
      const listings = matchingListings
        .filter((item) => typeof item.title === 'string' && isEbayUrl(item.itemWebUrl))
        .slice(0, 3)
        .map((item) => ({
          title: item.title.slice(0, 160),
          price: Number(item.price.value),
          currency,
          url: item.itemWebUrl,
        }))
      if (matchingListings.length < 3) {
        sendJson(response, 200, {
          status: 'insufficient_matches',
          query,
          listingCount: matchingListings.length,
          listings,
        })
        return
      }

      const prices = matchingListings
        .map((item) => Number(item.price.value))
        .sort((first, second) => first - second)

      sendJson(response, 200, {
        status: 'available',
        query,
        marketplace: marketplaceId,
        listingCount: matchingListings.length,
        priceRange: {
          low: percentile(prices, 0.25),
          high: percentile(prices, 0.75),
          currency,
        },
        listings,
      })
    } catch (error) {
      console.error('Unexpected eBay price search error:', error)
      sendJson(response, 502, { code: 'search_failed', error: 'Marketplace price search failed. Please try again.' })
    }
  }
}

export function marketplacePriceApi(options = {}) {
  const handler = createMarketplacePriceHandler(options)
  return {
    name: 'marketplace-price-api',
    configureServer(server) {
      server.middlewares.use('/api/prices', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/prices', handler)
    },
  }
}
