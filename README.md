# Checkpoint

[![Demo video](https://img.youtube.com/vi/uncoChSK1bU/maxresdefault.jpg)](https://youtu.be/uncoChSK1bU)

## Inspiration
Mental health is an extremely important, yet overlooked area of many lives. One thing that almost everyone goes through, the job hunt, can feel very overwhelming at times. Once you're off the clock and want to search for other positions, it can be hard to turn off work mode in your brain afterwards. Let's be real, sending applications knowing that there's a high chance that you'll get a rejection email back, it's not easy to stay motivated. Eventually, you start looking at how others are doing, and then see that one guy you hate get an internship at your dream company. Uncalled for. So, you realize it's important to continue the search, but in a way where you don't become your greatest enemy...

## What it does
Checkpoint is a browser extension designed to help you on the job/internship search process, and more importantly, keep yourself happy. 

When opening the dashboard, you can set a set number of positions to apply to for that day. You import your resume, and Checkpoint will parse your resume to see what skills you have related to each position. Additionally, when you apply, it'll tell you what you should practice/study, such as Leetcode questions, or general topics to learn. 

Once the daily goal of applications are reached, you need to take your mind off of the job search. Checkpoint will tell you that you've completed your goals for today, and will block off any further applications until the next day. 

However, we know that it's hard to leave Linkedin once you're on it, and seeing other people get positions while you're still searching can be very mentally taxing. So, Checkpoint will block detected posts about other's incoming positions, so you can focus on what really matters, yourself and your goals.

Nobody is perfect, and we're all bound to get a rejection email at some point in our lives. Checkpoint will also handle that for you, and block out those rejection emails that fill up the inbox. Nothing is worse than wanting to check your email and then getting hit with a reminder that you were rejected by a bunch of companies.

Checkpoint aims to be a checkpoint, a safe pitstop on someone's story as they continue to work towards their goals.

## How we built it
HTML, CSS, JavaScript, and #Love.

## Challenges we ran into
The blocking of the application button wouldn't work properly sometimes and it keep flashing. Taunting us in our time of despair. 

## Accomplishments that we're proud of
Somehow having an anime girl mascot, Check-san, be part of the finished product.

Chrome Manifest V3 side-panel extension for LinkedIn Jobs. Enforces daily application pacing, parses job descriptions into structured JSON signals, and prepares interview prompts from your resume without a chatbot UI.

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
| **Gmail rejection filter** | Locally detects likely rejection wording in visible Gmail inbox rows and replaces it with an **Application update hidden** cover. **Show anyway** reveals the original row; no email is opened, moved, deleted, or sent to an API |
| **AI parse** | Returns typed JSON (`tech`, `domain`, `seniority`, `responsibilities`) as badges, not chat |
| **Skills fit & paced plan** | Compares the job's required tech to the skills pulled from the resume PDF you drop into ⚙ settings (text is extracted on-device with pdf.js; with a Gemini key, Gemini describes each skill's category, proficiency, years, and how you used it; otherwise a keyword catalog groups skills and quotes the resume line that mentions each one). Uploading a new resume replaces the previous skills. The gap is computed locally; Gemini writes role-specific reasons and a sustainable 5-hour weekly plan |
| **Interview prep** | Practice prompts built from the strongest resume points for this job |
| **Workday shutdown** | Opens at the daily cap (or from **Wrap Up Day**) with today’s roles, unique technical skills, structured Gemini advice for tomorrow, and a final LinkedIn Apply lock |

Skills, stories, and application history stay in `chrome.storage.local` on your device.

Completed sessions are archived locally under `log_YYYY-MM-DD`; no external database is required.

## Gemini API key

Open the side panel, click the ⚙ gear, and paste your Gemini API key. It is stored locally in `chrome.storage.local`. Without a key, local heuristic job features still work.

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
services/resumeStories.js # resume PDF → STAR stories
lib/pdfjs/             # vendored pdf.js (Apache-2.0)
services/interviewPrep.js
sidepanel/careerTools.js # skills plan + interview prep UIservices/starMatcher.js
icons/
```
