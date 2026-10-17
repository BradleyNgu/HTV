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
| **AI parse** | Returns typed JSON (`tech`, `domain`, `seniority`, `responsibilities`) as badges—not chat |
| **STAR match** | Ranks local project bank (Gemini embeddings when a key is set, keyword overlap otherwise) and surfaces top 2 Situation / Task / Action / Result cards |
| **Daily check-in** | 10-second mood + energy check-in. A rough day eases today's application cap (halved, rounded up) and keeps study load light. Never raises the cap above your own setting. 7-day trend included |
| **Skills fit & paced plan** | Compares the job's required tech to the skills pulled from the resume PDF you drop into ⚙ settings (text is extracted on-device with pdf.js; with a Gemini key, Gemini describes each skill's category, proficiency, years, and how you used it; otherwise a keyword catalog groups skills and quotes the resume line that mentions each one). Uploading a new resume replaces the previous skills. The gap is computed locally; Gemini writes role-specific reasons and a weekly plan sized to your energy (3 / 5 / 7 hours per week) |
| **Interview prep** | Practice prompts tied to your matched STAR stories, a calm-down checklist, and a 60-second box-breathing reset |

All wellbeing data (check-ins, skills, stories) stays in `chrome.storage.local` on your device. The only network calls are to Gemini, and only when you add a key.

## Gemini API key

Open the side panel, click the ⚙ gear, and paste your Gemini API key. It is stored locally in `chrome.storage.local`. Without a key, a local heuristic parser still fills the UI.

## Project layout

```
manifest.json
background.js          # storage, badge, side panel, pacing
content.js / content.css
sidepanel/             # LinkedIn-inspired UI
services/gemini.js     # shared Gemini client (JSON + embeddings)
services/aiParser.js   # job description -> structured JSON
services/skillsGap.js  # skills gap + paced learning plan
services/resumeSkills.js # resume PDF → skills list
lib/pdfjs/             # vendored pdf.js (Apache-2.0)
services/interviewPrep.js
sidepanel/wellbeing.js # check-in, trend, breathing reset
sidepanel/careerTools.js # skills plan + interview prep UIservices/starMatcher.js
icons/
```
