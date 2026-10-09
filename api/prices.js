import { createMarketplacePriceHandler } from '../server/marketplace-prices.js'

export default createMarketplacePriceHandler({
  clientId: process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_CLIENT_SECRET || '',
  marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_ES',
})
