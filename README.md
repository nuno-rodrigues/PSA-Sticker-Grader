# Sticker Check

Sticker Check is a React and Vite app for reviewing sticker photos, available in English, Portuguese, and Spanish. Choose a language from the header; your choice is saved in this browser, and AI-generated notes and summaries use the selected language. After uploading a PNG, JPEG, WEBP, or GIF photo, an Ollama vision model suggests a crop around the sticker. Choose to analyze that area or make your own selection; you can also analyze the full photo. The condition estimate is only requested after you choose an analysis action. You can review and adjust the suggested scores in the browser.

When running locally, photos are sent to Ollama Cloud for analysis. The estimate is not an official PSA grade.

After a sticker is identified, Sticker Check can search active eBay listings using an item description generated from the uploaded image. The displayed range is the 25th-to-75th percentile of matching asking prices (up to 50 results), and requires at least three priced listings. These are current asking prices, not completed sales or a formal valuation. eBay is the only integrated marketplace; Vinted and other marketplaces are not queried. The uploaded photo itself is not sent to eBay.

The browser allows three photo uploads before showing the donation and unlock-key prompt. The upload count and unlock state are stored in browser local storage and are not cleared by resetting a review. Configure `STICKER_CHECK_UNLOCK_KEY` in `.env.local` to enable server-side unlock-key verification. A valid key unlocks additional photo uploads in that browser. Key issuance and email delivery are handled separately.

After an analysis is complete, export a PNG result image with the sticker photo, overall estimate, area scores, and analysis summary. The exported image follows the selected language.

## Set up Ollama Cloud

1. Create an API key in [Ollama settings](https://ollama.com/settings/keys).
2. Add your key to `.env.local` in the project root:

   ```text
   OLLAMA_API_KEY=your_ollama_cloud_api_key
   ```

   `.env.local` is ignored by Git. Keep the key on the server; do not add it to client-side code or commit it.

3. Install the app dependencies and start Sticker Check:

   ```powershell
   npm install
   npm run dev
   ```

4. Open the local URL printed by Vite, usually `http://localhost:5173`.

Development defaults to `https://ollama.com` and the `gemma4:31b` model. To use another vision model or a different Ollama server, set `OLLAMA_MODEL` or `OLLAMA_BASE_URL` in `.env.local`, for example:

```text
OLLAMA_MODEL=llama3.2-vision:11b
```

Restart the Vite server after changing these settings. `npm run preview` also serves the evaluation endpoint for previewing a production build, using the same environment variables.

The Vite server provides the evaluation, unlock, and price-search endpoints during local development and preview. On Vercel, the `api/evaluate.js`, `api/unlock.js`, and `api/prices.js` serverless functions provide the same endpoints.

To enable live eBay price comparisons, create an application key set in the [eBay Developers Program](https://developer.ebay.com/) and configure these server-side environment variables in `.env.local` or your deployment environment:

```text
EBAY_CLIENT_ID=your_ebay_application_client_id
EBAY_CLIENT_SECRET=your_ebay_application_client_secret
EBAY_MARKETPLACE_ID=EBAY_ES
```

The marketplace defaults to `EBAY_ES`; set `EBAY_MARKETPLACE_ID` to a supported eBay marketplace for your region. Keep both eBay credentials on the server and never expose or commit them. Without credentials, the price box explains that live eBay search is not configured.

For a Vercel deployment, set `OLLAMA_BASE_URL` to `https://ollama.com`, `OLLAMA_API_KEY` to an API key, and `OLLAMA_MODEL` to a vision-capable model available in Ollama Cloud, such as `gemma4:31b`. Cloud API model names differ from the `:cloud` names used with the Ollama app or CLI. Ollama Cloud does not support structured outputs, so the app requests JSON in the prompt and validates the response. You can also configure `STICKER_CHECK_UNLOCK_KEY`. Store credentials in Vercel environment variables; never put them in client-side code. Redeploy after changing Vercel environment variables. For a self-hosted Ollama server instead, set `OLLAMA_BASE_URL` to its URL reachable from Vercel; do not set it to `127.0.0.1` or expose an Ollama server on your personal computer to the public internet.
