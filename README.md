# Sticker Check

Sticker Check is a React and Vite app for reviewing sticker photos, available in English, Portuguese, and Spanish. Choose a language from the header; your choice is saved in this browser, and AI-generated notes and summaries use the selected language. After uploading a PNG, JPEG, WEBP, or GIF photo, you can drag across the image to select a crop before asking a local Ollama vision model for an estimate of centering, corners, edges, and surface. Analyze the full photo if no crop is selected. You can review and adjust the suggested scores in the browser.

When running locally, photos are sent to Ollama on your computer, not to a cloud AI service. The estimate is not an official PSA grade.

The browser allows three photo uploads before showing the donation and unlock-key prompt. The upload count and unlock state are stored in browser local storage and are not cleared by resetting a review. Configure `STICKER_CHECK_UNLOCK_KEY` in `.env.local` to enable server-side unlock-key verification. A valid key unlocks additional photo uploads in that browser. Key issuance and email delivery are handled separately.

After an analysis is complete, export a PNG result image with the sticker photo, overall estimate, area scores, and analysis summary. The exported image follows the selected language.

## Set up Ollama

1. Install Ollama for Windows from [ollama.com/download](https://ollama.com/download) and launch it.
2. Open PowerShell and download the default vision model:

   ```powershell
   ollama pull gemma3:4b
   ```

   This model download is several gigabytes and requires an internet connection. After it is downloaded, evaluations run locally.

3. Install the app dependencies and start Sticker Check:

   ```powershell
   npm install
   npm run dev
   ```

4. Open the local URL printed by Vite, usually `http://localhost:5173`.

Ollama normally listens at `http://127.0.0.1:11434`. The app uses `gemma3:4b` by default. To use another vision model, set `OLLAMA_MODEL` in `.env.local`, for example:

```text
OLLAMA_MODEL=llama3.2-vision:11b
```

Restart the Vite server after changing the model. `npm run preview` also serves the local evaluation endpoint for previewing a production build.

The Vite server provides the evaluation endpoints during local development and preview. On Vercel, the `api/evaluate.js` and `api/unlock.js` serverless functions provide the same endpoints.

For a Vercel deployment, configure `OLLAMA_BASE_URL` as an environment variable with the URL of an Ollama server reachable from Vercel, and optionally configure `OLLAMA_MODEL`, `OLLAMA_API_KEY` (sent as a Bearer token when set), and `STICKER_CHECK_UNLOCK_KEY`. Store credentials in Vercel environment variables; never put them in client-side code. Do not set `OLLAMA_BASE_URL` to `127.0.0.1` or expose an Ollama server on your personal computer to the public internet. Redeploy after changing Vercel environment variables. Without a reachable Ollama server, the site can load but photo evaluation cannot complete.
