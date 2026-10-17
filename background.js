/**
 * Service worker: storage init, side panel, daily pacing, badge.
 */

const DEFAULTS = {
  dailyAppCap: 4,
  appsSubmittedToday: 0,
  lastResetDate: null,
  apiKey: '',
  apiProvider: 'openai', // 'openai' | 'gemini'
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDailyReset() {
  const data = await chrome.storage.local.get([
    'appsSubmittedToday',
    'dailyAppCap',
    'lastResetDate',
    'projectBank',
    'apiKey',
    'apiProvider',
  ]);

  const updates = {};
  if (data.dailyAppCap == null) updates.dailyAppCap = DEFAULTS.dailyAppCap;
  if (data.appsSubmittedToday == null) updates.appsSubmittedToday = DEFAULTS.appsSubmittedToday;
  if (data.projectBank == null) updates.projectBank = DEFAULTS.projectBank;
  if (data.apiKey == null) updates.apiKey = DEFAULTS.apiKey;
  if (data.apiProvider == null) updates.apiProvider = DEFAULTS.apiProvider;

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

async function updateBadge(state) {
  const used = state.appsSubmittedToday ?? 0;
  const cap = state.dailyAppCap ?? DEFAULTS.dailyAppCap;
  const remaining = Math.max(cap - used, 0);
  const atCap = used >= cap;

  await chrome.action.setBadgeText({ text: String(remaining) });
  await chrome.action.setBadgeBackgroundColor({
    color: atCap ? '#B24020' : '#0A66C2',
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await ensureDailyReset();
  await updateBadge(state);

  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await ensureDailyReset();
  await updateBadge(state);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.appsSubmittedToday || changes.dailyAppCap) {
    chrome.storage.local.get(['appsSubmittedToday', 'dailyAppCap']).then(updateBadge);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_PACING_STATE': {
          const state = await ensureDailyReset();
          sendResponse({
            ok: true,
            appsSubmittedToday: state.appsSubmittedToday,
            dailyAppCap: state.dailyAppCap,
            atCap: state.appsSubmittedToday >= state.dailyAppCap,
          });
          break;
        }
        case 'INCREMENT_APP_COUNT': {
          const state = await ensureDailyReset();
          if (state.appsSubmittedToday >= state.dailyAppCap) {
            sendResponse({ ok: false, error: 'Daily application cap reached.', atCap: true, ...state });
            break;
          }
          const next = {
            appsSubmittedToday: state.appsSubmittedToday + 1,
            lastResetDate: todayKey(),
          };
          await chrome.storage.local.set(next);
          const updated = { ...state, ...next };
          await updateBadge(updated);
          sendResponse({
            ok: true,
            appsSubmittedToday: updated.appsSubmittedToday,
            dailyAppCap: updated.dailyAppCap,
            atCap: updated.appsSubmittedToday >= updated.dailyAppCap,
          });
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
            apiProvider: state.apiProvider || 'openai',
            dailyAppCap: state.dailyAppCap,
          });
          break;
        }
        case 'SAVE_SETTINGS': {
          const payload = {};
          if (message.apiKey != null) payload.apiKey = message.apiKey;
          if (message.apiProvider != null) payload.apiProvider = message.apiProvider;
          if (message.dailyAppCap != null) {
            payload.dailyAppCap = Math.max(1, Number(message.dailyAppCap) || DEFAULTS.dailyAppCap);
          }
          await chrome.storage.local.set(payload);
          const state = await chrome.storage.local.get(['appsSubmittedToday', 'dailyAppCap']);
          await updateBadge(state);
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
