/**
 * Service worker: storage init, side panel, daily pacing, badge,
 * application sessions, and workday shutdown state.
 */

import { cleanResumeStories } from './services/resumeStories.js';

const DEFAULTS = {
  dailyAppCap: 4,
  appsSubmittedToday: 0,
  lastResetDate: null,
  apiKey: '',
  userSkills: [],
  skillProfile: [],
  resumeName: '',
  resumeStories: [],
  applicationLog: [],
  currentSessionJobs: [],
  parsedSkillsByUrl: {},
  shutdownCompletedDate: '',
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
      title: 'System Design Optimization: Hot Path Cache',
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

function pacingState(state) {
  const cap = state.dailyAppCap ?? DEFAULTS.dailyAppCap;
  const used = state.appsSubmittedToday ?? 0;
  const key = todayKey();
  return {
    appsSubmittedToday: used,
    dailyAppCap: cap,
    atCap: used >= cap,
    shutdownLocked: state.shutdownCompletedDate === key,
  };
}

async function persistDailyLog(date, jobs, extra = {}) {
  await chrome.storage.local.set({
    [`log_${date}`]: {
      date,
      jobs,
      updatedAt: Date.now(),
      ...extra,
    },
  });
}

async function ensureDailyReset() {
  const data = await chrome.storage.local.get(null);

  const updates = {};
  if (data.dailyAppCap == null) updates.dailyAppCap = DEFAULTS.dailyAppCap;
  if (data.appsSubmittedToday == null) updates.appsSubmittedToday = DEFAULTS.appsSubmittedToday;
  if (data.projectBank == null) updates.projectBank = DEFAULTS.projectBank;
  if (data.apiKey == null) updates.apiKey = DEFAULTS.apiKey;
  if (data.userSkills == null) updates.userSkills = DEFAULTS.userSkills;
  if (data.skillProfile == null) updates.skillProfile = DEFAULTS.skillProfile;
  if (data.resumeStories == null) updates.resumeStories = DEFAULTS.resumeStories;
  // Left over from the removed rejection-recovery feature; it held analyzed email outcomes.
  if (data.rejectionHistory != null) {
    await chrome.storage.local.remove('rejectionHistory');
    delete data.rejectionHistory;
  }
  if (data.applicationLog == null) updates.applicationLog = DEFAULTS.applicationLog;
  if (data.currentSessionJobs == null) updates.currentSessionJobs = DEFAULTS.currentSessionJobs;
  if (data.parsedSkillsByUrl == null) updates.parsedSkillsByUrl = DEFAULTS.parsedSkillsByUrl;
  if (data.shutdownCompletedDate == null) {
    updates.shutdownCompletedDate = DEFAULTS.shutdownCompletedDate;
  }

  const today = todayKey();
  if (data.lastResetDate !== today) {
    updates.appsSubmittedToday = 0;
    updates.lastResetDate = today;
    updates.currentSessionJobs = [];
  } else {
    // One-time migration for applications recorded before session tracking
    // existed. Preserve enriched jobs and only add missing entries.
    const sessionJobs = [...(data.currentSessionJobs || [])];
    const known = new Set(sessionJobs.map((job) => job.jobKey));
    for (const entry of (data.applicationLog || []).filter((item) => item.date === today)) {
      if (known.has(entry.jobKey)) continue;
      sessionJobs.push({
        id: entry.id,
        jobKey: entry.jobKey,
        title: entry.title,
        company: entry.company,
        url: entry.url,
        parsedSkills: [],
      });
      known.add(entry.jobKey);
    }
    if (sessionJobs.length !== (data.currentSessionJobs || []).length) {
      updates.currentSessionJobs = sessionJobs;
    }
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
    color: atCap ? '#B24020' : 'rgb(30, 136, 229)',
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

function cleanApiKey(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
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
  if (changes.appsSubmittedToday || changes.dailyAppCap) {
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
          // Always counted (even past the cap, since it really happened), but each
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
          const sessionJob = {
            id: entry.id,
            jobKey,
            title: entry.title,
            company: entry.company,
            url: entry.url,
            parsedSkills: cleanSkills(
              message.parsedSkills?.length
                ? message.parsedSkills
                : state.parsedSkillsByUrl?.[entry.url] || []
            ),
          };
          const currentSessionJobs = [...(state.currentSessionJobs || []), sessionJob];
          const next = {
            applicationLog: [...log, entry].slice(-200),
            currentSessionJobs,
            appsSubmittedToday: state.appsSubmittedToday + 1,
            lastResetDate: todayKey(),
          };
          await chrome.storage.local.set(next);
          await persistDailyLog(todayKey(), currentSessionJobs);
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
            currentSessionJobs: (state.currentSessionJobs || []).filter(
              (job) => job.jobKey !== entry.jobKey
            ),
            appsSubmittedToday:
              entry.date === todayKey()
                ? Math.max(0, state.appsSubmittedToday - 1)
                : state.appsSubmittedToday,
          };
          await chrome.storage.local.set(next);
          await persistDailyLog(todayKey(), next.currentSessionJobs);
          await updateBadge();
          sendResponse({ ok: true, ...pacingState({ ...state, ...next }) });
          break;
        }
        case 'ENRICH_SESSION_JOB': {
          const state = await ensureDailyReset();
          const skills = cleanSkills(message.parsedSkills);
          const targetUrl = String(message.url || '').split('?')[0];
          const parsedSkillsByUrl = {
            ...(state.parsedSkillsByUrl || {}),
            ...(targetUrl ? { [targetUrl]: skills } : {}),
          };
          const jobs = (state.currentSessionJobs || []).map((job) => {
            const matches =
              (message.jobKey && job.jobKey === message.jobKey) ||
              (targetUrl && String(job.url || '').split('?')[0] === targetUrl);
            return matches ? { ...job, parsedSkills: skills } : job;
          });
          await chrome.storage.local.set({ currentSessionJobs: jobs, parsedSkillsByUrl });
          await persistDailyLog(todayKey(), jobs);
          sendResponse({ ok: true, currentSessionJobs: jobs });
          break;
        }
        case 'GET_SESSION_STATE': {
          const state = await ensureDailyReset();
          sendResponse({
            ok: true,
            currentSessionJobs: state.currentSessionJobs || [],
            shutdownCompleted: state.shutdownCompletedDate === todayKey(),
            ...pacingState(state),
          });
          break;
        }
        case 'COMPLETE_SHUTDOWN': {
          const state = await ensureDailyReset();
          const date = todayKey();
          const jobs = state.currentSessionJobs || [];
          await chrome.storage.local.set({ shutdownCompletedDate: date });
          await persistDailyLog(date, jobs, { completedAt: Date.now() });
          sendResponse({
            ok: true,
            ...pacingState({ ...state, shutdownCompletedDate: date }),
          });
          break;
        }
        case 'RESET_DAY': {
          // Start today over: count, counted list, session, and shutdown lock.
          // Earlier days' history is untouched.
          const state = await ensureDailyReset();
          const today = todayKey();
          const next = {
            appsSubmittedToday: 0,
            currentSessionJobs: [],
            applicationLog: (state.applicationLog || []).filter((e) => e.date !== today),
            shutdownCompletedDate: '',
            lastResetDate: today,
          };
          await chrome.storage.local.set(next);
          await chrome.storage.local.remove([`log_${today}`, `shutdownAdvice_${today}`]);
          await updateBadge();
          sendResponse({ ok: true, ...pacingState({ ...state, ...next }) });
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
        case 'GET_RESUME_STORIES': {
          const state = await ensureDailyReset();
          const resumeStories = cleanResumeStories(state.resumeStories || []);
          if (JSON.stringify(resumeStories) !== JSON.stringify(state.resumeStories || [])) {
            await chrome.storage.local.set({ resumeStories });
          }
          sendResponse({ ok: true, resumeStories });
          break;
        }
        case 'GET_SETTINGS': {
          const state = await ensureDailyReset();
          sendResponse({
            ok: true,
            apiKey: cleanApiKey(state.apiKey),
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
          const state = await ensureDailyReset();
          const payload = {};
          if (message.apiKey != null) payload.apiKey = cleanApiKey(message.apiKey);
          if (message.skillProfile != null) {
            payload.skillProfile = cleanProfile(message.skillProfile);
            payload.userSkills = payload.skillProfile.map((s) => s.name);
          } else if (message.userSkills != null) {
            payload.userSkills = cleanSkills(message.userSkills);
          }
          if (message.resumeName != null) payload.resumeName = String(message.resumeName).slice(0, 120);
          if (message.resumeStories != null) payload.resumeStories = cleanResumeStories(message.resumeStories);
          if (message.dailyAppCap != null) {
            payload.dailyAppCap = Math.max(1, Number(message.dailyAppCap) || DEFAULTS.dailyAppCap);
            const capWasRaised = payload.dailyAppCap > state.dailyAppCap;
            const reopened = pacingState({
              ...state,
              dailyAppCap: payload.dailyAppCap,
              shutdownCompletedDate: '',
            });
            // Raising the cap is an explicit decision to resume. Clear a
            // completed shutdown only when the new effective cap has room.
            if (capWasRaised && state.appsSubmittedToday < reopened.dailyAppCap) {
              payload.shutdownCompletedDate = '';
            }
          }
          await chrome.storage.local.set(payload);
          await updateBadge();
          sendResponse({
            ok: true,
            ...pacingState({ ...state, ...payload }),
            shutdownReopened: payload.shutdownCompletedDate === '',
          });
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
