# Lingua

A Chinese-to-English translator with automatic source-language detection, English pronunciation, and copy-to-clipboard support.

## Usage

Enter text in Chinese, Japanese, Korean, French, Spanish, or another supported language. Lingua detects the source language and always translates to English. Select **Translate**, or press `⌘ Enter` (macOS) or `Ctrl Enter`.

Each translation request is limited to **500 UTF-8 bytes** to stay within the service's request limit. For Chinese text, this is about 160 characters. Photo Text splits longer OCR results into ordered, UTF-8-safe requests and pauses between requests; the translation provider's free daily quota and rate limits still apply.

## Translation services

The app uses DeepL API Free when a `DEEPL_AUTH_KEY` secret is configured on the server. DeepL detects the input language and translates it to US English. The key is used only by the server function and is never sent to the browser.

Without a DeepL key, the app uses MyMemory's free API with automatic source-language detection. This also keeps local static previews working. Translation text is sent to the selected service. MyMemory's anonymous free-use limit is 5,000 characters per day. See the [API details](https://mymemory.translated.net/doc/spec.php) and [usage limits](https://mymemory.translated.net/doc/usagelimits.php).

## GitHub Pages

The `Deploy Lingua to GitHub Pages` workflow publishes the static website and its local Cat's Cozy Home sprites. The GitHub Pages build does not run `functions/api/translate.js`; translation therefore uses the existing MyMemory fallback. Photo Text's OCR library and language data are still loaded from public CDNs when first needed.

## Secure DeepL setup

Create a DeepL API Free account and get an API key from [DeepL](https://developers.deepl.com/docs/getting-started/quickstart). Deploy this repository as a Cloudflare Pages project so it can run `functions/api/translate.js`. Add `DEEPL_AUTH_KEY` as a secret in the Cloudflare Pages project settings (or run `wrangler pages secret put DEEPL_AUTH_KEY`). Do not put the key in `app.js`, HTML, or any `VITE_`/public variable.

English speech uses the browser's built-in Speech Synthesis API and prefers a US English voice when available. Voice options vary by browser and operating system.

## Learning tools

- **Vocabulary Notebook** stores saved words, translations, notes, and favorites in this browser. Select part of a translation to save a phrase, or save the full translation. Saved entries are not synced to a server.
- **Translation Diary** stores up to 100 successful translations locally. Use its checkbox to stop saving new entries; turning it off does not delete existing entries. Clear the diary to remove them.
- **Voice input** uses the browser's Speech Recognition API when available. Select the spoken language and choose **Start** to request microphone access. Lingua does not record or store audio, but the browser's recognition provider may process speech.
- **Grammar Corner** includes a conservative offline checker for selected common mistakes, 12 interactive lessons, and a 60-question practice bank with Easy, Medium, and Hard levels. Explanations are available in English or Traditional Chinese; lesson and quiz examples stay in English. Completed lessons, quiz scores, recent questions, and mistakes are saved locally in this browser. It needs no API key, account, internet connection, or server. The checker only corrects patterns it recognizes confidently, may miss errors, and clearly says when it cannot analyze reliably; it is not a full grammar proofreader.
- **Daily Challenge** uses a curated set of 30 beginner-friendly questions and saves completed challenges and streaks in this browser.
- **Cat’s Cozy Home** is an offline English mini-game with 72 vocabulary, grammar, translation, and reading questions. Correct answers award 10, 20, or 30 coins by difficulty. The provided dollhouse art sheet is separated into local room, furniture, food, and kitten sprites; spend coins on room decorations and cat-safe food, place and drag furniture, feed and play with the kitten, and save coins, inventory, room positions, care meters, and pet count in this browser. Questions award coins only once. The sheet combines its curtain canopy with the princess bed and its yarn ball with the kitten, so those two are excluded from new shop purchases. It also lacks separate artwork for a wardrobe, bedside table, heart-shaped sofa, wall painting, scratching post, and cat-safe birthday cake. Separate transparent assets are needed rather than approximate drawings. Rebuild the sprites from the provided art sheet with `python3 scripts/prepare-cat-assets.py`.
- **Photo Text** runs Tesseract.js OCR in the browser. The image is not uploaded by Lingua. Tesseract.js and selected language data are downloaded from public CDNs when needed, so OCR requires an internet connection the first time a library or language is used. Supported OCR languages include English, Simplified and Traditional Chinese, Japanese, Korean, French, and Spanish. Chinese uses higher-accuracy trained data and images are enlarged and contrast-adjusted locally before recognition. Review the extracted text, choose any supported translation target, then translate; long text is split into sequential requests of at most 500 UTF-8 bytes with visible progress. Successful chunks are retained if one fails, and retry continues from that failed chunk. Provider rate limits and MyMemory's anonymous daily quota still apply. The original and result remain side by side. Image uploads are limited to 5 MB.
