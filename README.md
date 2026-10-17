# Sustainable Job Search Copilot

Chrome Manifest V3 side-panel extension for LinkedIn Jobs. Enforces daily application pacing, parses job descriptions into structured JSON signals, and matches STAR project stories—without a chatbot UI.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`HTV`)

Open [LinkedIn Jobs](https://www.linkedin.com/jobs/), then click the extension icon to open the side panel.

## Features

| Area | Behavior |
|------|----------|
| **Pacing** | Tracks apps vs daily cap (default 4); resets at midnight; disables Easy Apply when at cap |
| **Scraper** | Extracts title, company, description, URL from LinkedIn job DOM (with fallback selectors) |
| **AI parse** | Returns typed JSON (`tech`, `domain`, `seniority`, `responsibilities`) as badges—not chat |
| **STAR match** | Ranks local project bank and surfaces top 2 Situation / Task / Action / Result cards |

## Gemini API key (local `.env`)

1. Put your key in `.env`: `GEMINI_API_KEY=...`
2. Run `npm run sync-env` (generates the gitignored `config.local.js`)
3. Reload the extension in `chrome://extensions`

Re-run `npm run sync-env` any time you change the key. Without a key, a local heuristic parser still fills the UI.

## Project layout

```
manifest.json
background.js          # storage, badge, side panel, pacing
content.js / content.css
sidepanel/             # LinkedIn-inspired UI
services/aiParser.js   # Gemini structured JSON
scripts/sync-env.js    # .env -> config.local.js
services/starMatcher.js
icons/
```
