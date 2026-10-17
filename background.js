/**
 * Service worker: storage init, side panel, daily pacing, badge,
 * wellbeing check-ins that adapt the daily application cap.
 */

const DEFAULTS = {
  dailyAppCap: 4,
  appsSubmittedToday: 0,
  lastResetDate: null,
  apiKey: '',
  userSkills: [],
  skillProfile: [],
  resumeName: '',
  checkIns: [],
  applicationLog: [],
  projectBank: [
    {
      id: 'proj-telemetry',
      title: 'Telemetry Data Processing Pipeline',
      tags: ['python', 'kafka', 'spark', 'real-time streams', 'data pipeline', 'low-latency'],
      situation: 'Product analytics lagged by hours, so ops could not react to live incidents.',
      task: 'Design a near-real-time pipeline from event producers to dashboards under 30s latency.',
      action:
        'Built Kafka → Spark Structured Streaming jobs with schema validation, backpressure controls, and idempotent writes to a columnar store.',
      result: 'Cut end-to-end latency from 4 hours to ~20 seconds and reduced incident MTTD by 35%.',
    },
    {
      id: 'proj-sysdesign',
      title: 'System Design Optimization — Hot Path Cache',
      tags: ['microservices', 'redis', 'nodejs', 'scalability', 'api', 'caching'],
      situation: 'A core read API was timing out under peak load during product launches.',
      task: 'Stabilize the hot path without a full rewrite of downstream services.',
      action:
        'Introduced a Redis read-through cache layer, request coalescing, and circuit breakers across three microservices.',
      result: 'p99 latency dropped from 1.8s to 140ms; error rate fell below 0.1% at 3× previous traffic.',
    },
    {
      id: 'proj-frontend',
      title: 'Design System Migration',
      tags: ['react', 'typescript', 'accessibility', 'frontend', 'design system'],
      situation: 'Inconsistent UI patterns slowed feature delivery and hurt accessibility scores.',
      task: 'Migrate critical flows to a shared component library with a11y baselines.',
      action:
        'Led a typed React + TypeScript design system rollout with Storybook, focus management, and automated axe checks in CI.',
      result: 'Shipped 40+ reusable components; reduced UI defects by 28% and improved Lighthouse a11y to 96.',
    },
  ],
};

/** Local calendar date (YYYY-MM-DD) so the reset happens at the user's midnight. */
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * A low-energy / low-mood check-in eases the cap to half (rounded up, min 1).
 * Check-ins never raise the cap above the user's own setting.
 */
function effectiveCap(baseCap, checkIn) {
  if (!checkIn) return baseCap;
  const score = (checkIn.mood + checkIn.energy) / 2;
  return score < 2.5 ? Math.max(1, Math.ceil(baseCap / 2)) : baseCap;
}

function pacingState(state) {
  const baseCap = state.dailyAppCap ?? DEFAULTS.dailyAppCap;
  const used = state.appsSubmittedToday ?? 0;
  const key = todayKey();
  const checkIn = (state.checkIns || []).find((c) => c.date === key) || null;
  const cap = effectiveCap(baseCap, checkIn);
  return {
    appsSubmittedToday: used,
    dailyAppCap: cap,
    baseCap,
    adjusted: cap < baseCap,
    atCap: used >= cap,
    checkIn,
  };
}

async function ensureDailyReset() {
  const data = await chrome.storage.local.get(null);

  const updates = {};
  if (data.dailyAppCap == null) updates.dailyAppCap = DEFAULTS.dailyAppCap;
  if (data.appsSubmittedToday == null) updates.appsSubmittedToday = DEFAULTS.appsSubmittedToday;
  if (data.projectBank == null) updates.projectBank = DEFAULTS.projectBank;
  if (data.apiKey == null) updates.apiKey = DEFAULTS.apiKey;
  if (data.userSkills == null) updates.userSkills = DEFAULTS.userSkills;
  if (data.checkIns == null) updates.checkIns = DEFAULTS.checkIns;
  if (data.applicationLog == null) updates.applicationLog = DEFAULTS.applicationLog;

  const today = todayKey();
  if (data.lastResetDate !== today) {
    updates.appsSubmittedToday = 0;
    updates.lastResetDate = today;
  }

  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
  }

  return chrome.storage.local.get(null);
}

async function updateBadge() {
  const state = await chrome.storage.local.get(null);
  const { appsSubmittedToday, dailyAppCap, atCap } = pacingState(state);
  const remaining = Math.max(dailyAppCap - appsSubmittedToday, 0);

  await chrome.action.setBadgeText({ text: String(remaining) });
  await chrome.action.setBadgeBackgroundColor({
    color: atCap ? '#B24020' : '#0A66C2',
  });
}

function cleanSkills(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const skill = String(raw || '').trim().slice(0, 40);
    const key = skill.toLowerCase();
    if (skill && !seen.has(key)) {
      seen.add(key);
      out.push(skill);
    }
  }
  return out.slice(0, 60);
}

const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

/** Profile entries: { name, category, level, years, evidence }. Deduped by name. */
function cleanProfile(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw?.name || '').trim().slice(0, 40);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const years = Number(raw.years);
    out.push({
      name,
      category: String(raw.category || 'Other').trim().slice(0, 40) || 'Other',
      level: SKILL_LEVELS.includes(raw.level) ? raw.level : '',
      years: years > 0 && years < 60 ? Math.round(years * 2) / 2 : null,
      evidence: String(raw.evidence || '').trim().slice(0, 240),
    });
  }
  return out.slice(0, 60);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDailyReset();
  await updateBadge();

  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDailyReset();
  await updateBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.appsSubmittedToday || changes.dailyAppCap || changes.checkIns) {
    updateBadge();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_PACING_STATE': {
          const state = await ensureDailyReset();
          sendResponse({ ok: true, ...pacingState(state) });
          break;
        }
        case 'RECORD_APPLICATION': {
          // Sent by the content script when the user applies on LinkedIn.
          // Always counted (even past the cap — it really happened), but each
          // job is only ever counted once.
          const jobKey = String(message.jobKey || '').slice(0, 100);
          if (!jobKey) {
            sendResponse({ ok: false, error: 'Missing job key.' });
            break;
          }
          const state = await ensureDailyReset();
          const log = state.applicationLog || [];
          if (log.some((e) => e.jobKey === jobKey)) {
            sendResponse({ ok: true, duplicate: true, ...pacingState(state) });
            break;
          }
          const clip = (v, n = 120) => String(v || '').trim().slice(0, n);
          const method = ['easy', 'external', 'manual'].includes(message.method)
            ? message.method
            : 'external';
          const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            jobKey,
            title: clip(message.title) || 'Untitled role',
            company: clip(message.company),
            url: clip(message.url, 300),
            method,
            date: todayKey(),
            at: Date.now(),
          };
          const next = {
            applicationLog: [...log, entry].slice(-200),
            appsSubmittedToday: state.appsSubmittedToday + 1,
            lastResetDate: todayKey(),
          };
          await chrome.storage.local.set(next);
          await updateBadge();
          sendResponse({ ok: true, entry, ...pacingState({ ...state, ...next }) });
          break;
        }
        case 'REMOVE_APPLICATION': {
          // Lets the user correct a miscount (e.g. closed the tab before applying).
          const state = await ensureDailyReset();
          const log = state.applicationLog || [];
          const entry = log.find((e) => e.id === message.id);
          if (!entry) {
            sendResponse({ ok: false, error: 'Application not found.' });
            break;
          }
          const next = {
            applicationLog: log.filter((e) => e.id !== message.id),
            appsSubmittedToday:
              entry.date === todayKey()
                ? Math.max(0, state.appsSubmittedToday - 1)
                : state.appsSubmittedToday,
          };
          await chrome.storage.local.set(next);
          await updateBadge();
          sendResponse({ ok: true, ...pacingState({ ...state, ...next }) });
          break;
        }
        case 'SAVE_CHECKIN': {
          const mood = Math.round(Number(message.mood));
          const energy = Math.round(Number(message.energy));
          const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 5;
          if (!valid(mood) || !valid(energy)) {
            sendResponse({ ok: false, error: 'Mood and energy must each be between 1 and 5.' });
            break;
          }
          const state = await ensureDailyReset();
          const today = todayKey();
          const checkIns = (state.checkIns || [])
            .filter((c) => c.date !== today)
            .concat({ date: today, mood, energy, savedAt: Date.now() })
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30);
          await chrome.storage.local.set({ checkIns });
          await updateBadge();
          sendResponse({ ok: true, ...pacingState({ ...state, checkIns }) });
          break;
        }
        case 'GET_PROJECT_BANK': {
          const state = await ensureDailyReset();
          sendResponse({ ok: true, projectBank: state.projectBank || [] });
          break;
        }
        case 'SAVE_PROJECT_BANK': {
          await chrome.storage.local.set({ projectBank: message.projectBank || [] });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_SETTINGS': {
          const state = await ensureDailyReset();
          sendResponse({
            ok: true,
            apiKey: state.apiKey || '',
            dailyAppCap: state.dailyAppCap,
            userSkills: state.userSkills || [],
            skillProfile: state.skillProfile?.length
              ? state.skillProfile
              : cleanProfile((state.userSkills || []).map((name) => ({ name }))),
            resumeName: state.resumeName || '',
          });
          break;
        }
        case 'SAVE_SETTINGS': {
          const payload = {};
          if (message.apiKey != null) payload.apiKey = message.apiKey;
          if (message.skillProfile != null) {
            payload.skillProfile = cleanProfile(message.skillProfile);
            payload.userSkills = payload.skillProfile.map((s) => s.name);
          } else if (message.userSkills != null) {
            payload.userSkills = cleanSkills(message.userSkills);
          }
          if (message.resumeName != null) payload.resumeName = String(message.resumeName).slice(0, 120);
          if (message.dailyAppCap != null) {
            payload.dailyAppCap = Math.max(1, Number(message.dailyAppCap) || DEFAULTS.dailyAppCap);
          }
          await chrome.storage.local.set(payload);
          await updateBadge();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'Background error' });
    }
  })();
  return true;
});

// Keep midnight reset responsive while the worker is alive.
setInterval(() => {
  ensureDailyReset().then(updateBadge);
}, 60_000);
