import { parseJob } from '../services/aiParser.js';
import { matchStarStories } from '../services/starMatcher.js';

const els = {
  pacingBadge: document.getElementById('pacing-badge'),
  pacingFill: document.getElementById('pacing-fill'),
  pacingMeter: document.getElementById('pacing-meter'),
  pacingCount: document.getElementById('pacing-count'),
  pacingCap: document.getElementById('pacing-cap'),
  btnLogApply: document.getElementById('btn-log-apply'),
  btnScrape: document.getElementById('btn-scrape'),
  btnParse: document.getElementById('btn-parse'),
  jobEmpty: document.getElementById('job-empty'),
  jobContent: document.getElementById('job-content'),
  jobTitle: document.getElementById('job-title'),
  jobCompany: document.getElementById('job-company'),
  jobUrl: document.getElementById('job-url'),
  jobError: document.getElementById('job-error'),
  parsedEmpty: document.getElementById('parsed-empty'),
  parsedContent: document.getElementById('parsed-content'),
  techBadges: document.getElementById('tech-badges'),
  domainBadges: document.getElementById('domain-badges'),
  seniorityBadges: document.getElementById('seniority-badges'),
  respList: document.getElementById('resp-list'),
  parseSource: document.getElementById('parse-source'),
  parseError: document.getElementById('parse-error'),
  starEmpty: document.getElementById('star-empty'),
  starContent: document.getElementById('star-content'),
  btnSettings: document.getElementById('btn-settings'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingCap: document.getElementById('setting-cap'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
};

let currentJob = null;
let settings = { dailyAppCap: 4 };

function showError(el, message) {
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function renderBadges(container, items, className = '') {
  container.innerHTML = '';
  (items || []).forEach((item) => {
    const span = document.createElement('span');
    span.className = `badge ${className}`.trim();
    span.textContent = item;
    container.appendChild(span);
  });
}

function updatePacingUI({ appsSubmittedToday, dailyAppCap, atCap }) {
  const used = appsSubmittedToday ?? 0;
  const cap = dailyAppCap ?? 4;
  const pct = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100));

  els.pacingCount.textContent = String(used);
  els.pacingCap.textContent = String(cap);
  els.pacingFill.style.width = `${pct}%`;
  els.pacingFill.classList.toggle('at-cap', Boolean(atCap));
  els.pacingMeter.setAttribute('aria-valuemax', String(cap));
  els.pacingMeter.setAttribute('aria-valuenow', String(used));

  els.pacingBadge.textContent = atCap ? 'Cap reached' : 'Ready';
  els.pacingBadge.classList.toggle('status-ok', !atCap);
  els.pacingBadge.classList.toggle('status-cap', Boolean(atCap));
  els.btnLogApply.disabled = Boolean(atCap);
}

async function refreshPacing() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_PACING_STATE' });
  if (res?.ok) updatePacingUI(res);
}

function isLinkedInJobsUrl(url = '') {
  return /linkedin\.com\/jobs(\/|$|\?)/i.test(url) || /linkedin\.com\/jobs\/view\//i.test(url);
}

async function getActiveLinkedInTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isLinkedInJobsUrl(active.url)) return active;

  // Side panel focus can leave another tab "active" — fall back to any Jobs tab
  const jobsTabs = await chrome.tabs.query({
    url: ['https://www.linkedin.com/jobs/*', 'https://www.linkedin.com/jobs/view/*'],
  });
  return jobsTabs.find((t) => t.active) || jobsTabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css'],
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function requestScrape(tabId) {
  await ensureContentScript(tabId);
  // Brief pause so injected script can register listeners
  await new Promise((r) => setTimeout(r, 50));
  return chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_JOB' });
}

async function scrapeActiveJob() {
  showError(els.jobError, '');
  const tab = await getActiveLinkedInTab();
  if (!tab) {
    currentJob = null;
    els.jobEmpty.classList.remove('hidden');
    els.jobContent.classList.add('hidden');
    showError(
      els.jobError,
      'No LinkedIn Jobs tab found. Open a posting like https://www.linkedin.com/jobs/view/… then Refresh.'
    );
    return;
  }

  try {
    const job = await requestScrape(tab.id);
    if (!job) throw new Error('No response from content script.');

    currentJob = job;
    els.jobEmpty.classList.add('hidden');
    els.jobContent.classList.remove('hidden');
    els.jobTitle.textContent = job.title || 'Title not found';
    els.jobCompany.textContent = job.company || 'Company not found';
    els.jobUrl.href = job.url || tab.url;
    els.jobUrl.textContent = job.url || tab.url;

    if (!job.ok) {
      const d = job.diagnostics || {};
      showError(
        els.jobError,
        `Could not fully scrape: missing ${job.missing?.join(', ') || 'fields'}. ` +
          'Reload the LinkedIn tab, then click Refresh again. ' +
          `[debug: "About the job" found=${d.hasAboutTheJob}, topFrame=${d.isTopFrame}, ` +
          `bodyChars=${d.bodyChars ?? '?'}, tabTitle="${d.docTitle || ''}"]`
      );
      return;
    }
  } catch (err) {
    currentJob = null;
    els.jobEmpty.classList.remove('hidden');
    els.jobContent.classList.add('hidden');
    showError(
      els.jobError,
      err?.message?.includes('Could not establish connection')
        ? 'Content script not ready. Refresh the LinkedIn tab, then click Refresh here.'
        : err?.message || 'Scrape failed.'
    );
  }
}

function renderParsed(parsed) {
  els.parsedEmpty.classList.add('hidden');
  els.parsedContent.classList.remove('hidden');
  renderBadges(els.seniorityBadges, [parsed.seniorityLevel], 'seniority');
  renderBadges(els.techBadges, parsed.requiredTechStack);
  renderBadges(els.domainBadges, parsed.domainConstraints, 'domain');

  els.respList.innerHTML = '';
  (parsed.keyResponsibilities || []).forEach((r) => {
    const li = document.createElement('li');
    li.textContent = r;
    els.respList.appendChild(li);
  });

  const sourceLabel = {
    gemini: 'Parsed via Gemini',
    heuristic: 'Parsed offline (heuristic — Gemini key missing)',
    'heuristic-fallback': 'API failed — showing heuristic fallback',
  };
  els.parseSource.textContent = sourceLabel[parsed._source] || 'Parsed';
  if (parsed._error) {
    showError(els.parseError, parsed._error);
  } else {
    showError(els.parseError, '');
  }
}

function renderStar(matches) {
  els.starContent.innerHTML = '';
  if (!matches?.length) {
    els.starEmpty.classList.remove('hidden');
    return;
  }
  els.starEmpty.classList.add('hidden');

  matches.forEach((m) => {
    const card = document.createElement('article');
    card.className = 'star-card';
    const matchHtml = (m.matchedSignals || [])
      .slice(0, 6)
      .map((s) => `<span class="badge">${escapeHtml(s)}</span>`)
      .join('');

    card.innerHTML = `
      <h3>${escapeHtml(m.title)}</h3>
      <div class="star-match">${matchHtml || '<span class="muted">General fit</span>'}</div>
      <div class="star-grid">
        <div class="star-block"><span>Situation</span><p>${escapeHtml(m.situation)}</p></div>
        <div class="star-block"><span>Task</span><p>${escapeHtml(m.task)}</p></div>
        <div class="star-block"><span>Action</span><p>${escapeHtml(m.action)}</p></div>
        <div class="star-block"><span>Result</span><p>${escapeHtml(m.result)}</p></div>
      </div>
    `;
    els.starContent.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runParseAndMatch() {
  showError(els.parseError, '');
  if (!currentJob?.description) {
    showError(els.parseError, 'Scrape a job with a description before parsing.');
    return;
  }

  els.btnParse.disabled = true;
  els.btnParse.textContent = 'Parsing…';
  try {
    const parsed = await parseJob(currentJob);
    renderParsed(parsed);

    const bankRes = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_BANK' });
    const matches = matchStarStories(parsed, bankRes?.projectBank || [], 2);
    renderStar(matches);
  } catch (err) {
    showError(els.parseError, err?.message || 'Parse failed.');
  } finally {
    els.btnParse.disabled = false;
    els.btnParse.textContent = 'Parse requirements';
  }
}

async function logApplication() {
  const res = await chrome.runtime.sendMessage({ type: 'INCREMENT_APP_COUNT' });
  if (res?.ok || res?.atCap != null) {
    updatePacingUI(res);
    // Notify content script on active tab
    const tab = await getActiveLinkedInTab();
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'PACING_UPDATED', atCap: res.atCap }).catch(() => {});
    }
  }
  if (!res?.ok && res?.error) {
    showError(els.jobError, res.error);
  }
}

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (!res?.ok) return;
  settings = { dailyAppCap: res.dailyAppCap ?? 4 };
  els.settingCap.value = settings.dailyAppCap;
}

els.btnScrape.addEventListener('click', scrapeActiveJob);
els.btnParse.addEventListener('click', runParseAndMatch);
els.btnLogApply.addEventListener('click', logApplication);

els.btnSettings.addEventListener('click', async () => {
  await loadSettings();
  els.settingsDialog.showModal();
});

els.btnCloseSettings.addEventListener('click', () => els.settingsDialog.close());

els.settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settings = { dailyAppCap: Number(els.settingCap.value) || 4 };
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', ...settings });
  els.settingsDialog.close();
  await refreshPacing();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.appsSubmittedToday || changes.dailyAppCap) {
    refreshPacing();
  }
});

(async function init() {
  await loadSettings();
  await refreshPacing();
  await scrapeActiveJob();
})();
