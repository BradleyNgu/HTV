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
| **Pacing** | Counts applications automatically as you apply on LinkedIn (no button to press) against a daily cap (default 4). Resets at local midnight; locks the Apply button at the cap. Each job counts once. Counted applications are listed in the panel, and a wrong one can be removed with × |
| **Scraper** | Extracts title, company, description, URL from LinkedIn job DOM (with fallback selectors) |
| **Feed focus filter** | Covers LinkedIn home-feed posts announcing that someone is joining a company. Matching posts show a “This is blocked” overlay with an optional **Show anyway** escape hatch |
| **AI parse** | Returns typed JSON (`tech`, `domain`, `seniority`, `responsibilities`) as badges—not chat |
| **STAR match** | Ranks local project bank (Gemini embeddings when a key is set, keyword overlap otherwise) and surfaces top 2 Situation / Task / Action / Result cards |
| **Skills fit & paced plan** | Compares the job's required tech to the skills pulled from the resume PDF you drop into ⚙ settings (text is extracted on-device with pdf.js; with a Gemini key, Gemini describes each skill's category, proficiency, years, and how you used it; otherwise a keyword catalog groups skills and quotes the resume line that mentions each one). Uploading a new resume replaces the previous skills. The gap is computed locally; Gemini writes role-specific reasons and a sustainable 5-hour weekly plan |
| **Interview prep** | Practice prompts tied to your matched STAR stories |
| **Gmail rejection recovery** | Adds an **Analyze rejection** button only when a Gmail message is open. A click sends that one email plus the locally saved resume skill profile to Gemini, logs a neutral reflection and one small next step, and highlights evidence-based gaps that recur across outcomes |
| **Workday shutdown** | Opens at the daily cap (or from **Wrap Up Day**) with today’s roles, unique technical skills, structured Gemini advice for tomorrow, and a final LinkedIn Apply lock |

Skills, stories, application history, and structured rejection results stay in `chrome.storage.local` on your device. The extension never scans the Gmail inbox automatically. It reads an open message only after **Analyze rejection** is clicked; that message and the resume profile are sent to Gemini for analysis. Raw email bodies are not stored.

Completed sessions are archived locally under `log_YYYY-MM-DD`; no external database is required.

## Gemini API key

Open the side panel, click the ⚙ gear, and paste your Gemini API key. It is stored locally in `chrome.storage.local`. Without a key, local heuristic job features still work, but Gmail rejection analysis requires Gemini.

## Project layout

```
manifest.json
background.js          # storage, badge, side panel, pacing
content.js / content.css
gmailRejection.js / gmailRejection.css # click-to-analyze Gmail integration
sidepanel/             # LinkedIn-inspired UI
services/gemini.js     # shared Gemini client (JSON + embeddings)
services/rejectionRecovery.js # structured Gemini rejection analysis
services/aiParser.js   # job description -> structured JSON
services/skillsGap.js  # skills gap + paced learning plan
services/resumeSkills.js # resume PDF → skills list
lib/pdfjs/             # vendored pdf.js (Apache-2.0)
services/interviewPrep.js
sidepanel/careerTools.js # skills plan + interview prep UIservices/starMatcher.js
icons/
```
