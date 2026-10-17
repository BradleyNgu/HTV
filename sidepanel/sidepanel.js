import { parseJob } from '../services/aiParser.js';
import { matchStarStoriesSemantic } from '../services/starMatcher.js';
import { extractSkillsFromPdf, SKILL_CATEGORIES } from '../services/resumeSkills.js';
import { callGeminiJson } from '../services/gemini.js';
import { initBreathing } from './breathing.js';
import { initCareerTools } from './careerTools.js';

function localDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const els = {
  starMethod: document.getElementById('star-method'),
  resumeDrop: document.getElementById('resume-drop'),
  resumeDropText: document.getElementById('resume-drop-text'),
  resumeFile: document.getElementById('resume-file'),
  resumeStatus: document.getElementById('resume-status'),
  resumeError: document.getElementById('resume-error'),
  skillProfile: document.getElementById('skill-profile'),
  pacingBadge: document.getElementById('pacing-badge'),
  pacingFill: document.getElementById('pacing-fill'),
  pacingMeter: document.getElementById('pacing-meter'),
  pacingCount: document.getElementById('pacing-count'),
  pacingCap: document.getElementById('pacing-cap'),
  appliedList: document.getElementById('applied-list'),
  appliedEmpty: document.getElementById('applied-empty'),
  recoveryCount: document.getElementById('recovery-count'),
  recoveryEmpty: document.getElementById('recovery-empty'),
  recoveryContent: document.getElementById('recovery-content'),
  recoveryGapsField: document.getElementById('recovery-gaps-field'),
  recoveryGaps: document.getElementById('recovery-gaps'),
  recoveryList: document.getElementById('recovery-list'),
  recoveryError: document.getElementById('recovery-error'),
  btnAddManual: document.getElementById('btn-add-manual'),
  btnWrapUp: document.getElementById('btn-wrap-up'),
  shutdownOverlay: document.getElementById('shutdown-overlay'),
  shutdownRoleCount: document.getElementById('shutdown-role-count'),
  shutdownRoleList: document.getElementById('shutdown-role-list'),
  shutdownRoleEmpty: document.getElementById('shutdown-role-empty'),
  shutdownSkillList: document.getElementById('shutdown-skill-list'),
  shutdownSkillEmpty: document.getElementById('shutdown-skill-empty'),
  shutdownAdviceLoading: document.getElementById('shutdown-advice-loading'),
  shutdownAdviceContent: document.getElementById('shutdown-advice-content'),
  shutdownSummary: document.getElementById('shutdown-summary'),
  shutdownStrategy: document.getElementById('shutdown-strategy'),
  shutdownStatus: document.getElementById('shutdown-status'),
  btnCompleteShutdown: document.getElementById('btn-complete-shutdown'),
  btnCloseShutdown: document.getElementById('btn-close-shutdown'),
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
  settingKey: document.getElementById('setting-key'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
};

let currentJob = null;
let currentParsed = null;
let currentMatches = [];
let settings = { apiKey: '', dailyAppCap: 4, userSkills: [], skillProfile: [], resumeName: '' };
// Skill profile shown in the open settings dialog; removals persist on Save.
let draftProfile = [];
let shutdownOpening = false;
let shutdownAutoShownDate = '';

const careerTools = initCareerTools({
  getContext: () => ({ job: currentJob, parsed: currentParsed, matches: currentMatches, settings }),
});

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

  if (atCap) {
    maybeOpenShutdown();
  } else {
    // If the user raises the cap and later reaches the new boundary, the
    // shutdown ritual should be eligible to open again.
    shutdownAutoShownDate = '';
  }
}

async function refreshPacing() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_PACING_STATE' });
  if (res?.ok) {
    updatePacingUI(res);
    await notifyContentScript(res.atCap);
  }
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
    heuristic: 'Parsed offline (heuristic — add a Gemini API key in settings for richer results)',
    'heuristic-fallback': 'API failed — showing heuristic fallback',
  };
  els.parseSource.textContent = sourceLabel[parsed._source] || 'Parsed';
  if (parsed._error) {
    showError(els.parseError, parsed._error);
  } else {
    showError(els.parseError, '');
  }
}

function renderStar(matches, method = 'keyword', error = '') {
  els.starContent.innerHTML = '';
  if (!matches?.length) {
    els.starEmpty.classList.remove('hidden');
    els.starMethod.classList.add('hidden');
    return;
  }
  els.starEmpty.classList.add('hidden');

  const methodLabel =
    method === 'semantic'
      ? 'Ranked by meaning (Gemini embeddings), not just keywords.'
      : `Ranked by keyword overlap${error ? ` (semantic matching unavailable: ${error})` : '. Add a Gemini key for semantic matching.'}`;
  els.starMethod.textContent = methodLabel;
  els.starMethod.classList.remove('hidden');

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
    careerTools.reset();
    currentParsed = null;
    currentMatches = [];

    const parsed = await parseJob(currentJob, settings);
    renderParsed(parsed);
    currentParsed = parsed;
    await chrome.runtime.sendMessage({
      type: 'ENRICH_SESSION_JOB',
      url: currentJob.url,
      parsedSkills: parsed.requiredTechStack || [],
    });

    const bankRes = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_BANK' });
    const { matches, method, error } = await matchStarStoriesSemantic(
      parsed,
      bankRes?.projectBank || [],
      { apiKey: settings.apiKey, limit: 2, job: currentJob }
    );
    currentMatches = matches;
    renderStar(matches, method, error);
  } catch (err) {
    showError(els.parseError, err?.message || 'Parse failed.');
  } finally {
    els.btnParse.disabled = false;
    els.btnParse.textContent = 'Parse requirements';
    careerTools.refresh();
  }
}

/** Tell the LinkedIn tab the cap changed so Easy Apply locks/unlocks right away. */
async function notifyContentScript(atCap) {
  const tab = await getActiveLinkedInTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'PACING_UPDATED', atCap }).catch(() => {});
  }
}

const METHOD_LABELS = {
  easy: 'Easy Apply',
  external: 'Company site',
  manual: 'Added manually',
};

async function renderApplications() {
  const { applicationLog = [] } = await chrome.storage.local.get('applicationLog');
  const entries = applicationLog.filter((entry) => entry.date === localDateKey()).reverse();

  els.appliedList.innerHTML = '';
  els.appliedEmpty.classList.toggle('hidden', entries.length > 0);

  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'applied-item';

    const info = document.createElement('div');
    info.className = 'applied-info';

    const title = document.createElement('span');
    title.className = 'applied-title';
    title.textContent = entry.company ? `${entry.title} · ${entry.company}` : entry.title;

    const meta = document.createElement('span');
    meta.className = 'muted';
    const time = new Date(entry.at).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    meta.textContent = `${METHOD_LABELS[entry.method] || 'Applied'} · ${time}`;
    info.append(title, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'applied-remove';
    remove.textContent = '×';
    remove.title = 'Remove this application from today’s count';
    remove.setAttribute('aria-label', `Remove ${entry.title} from today's count`);
    remove.addEventListener('click', async () => {
      const result = await chrome.runtime.sendMessage({
        type: 'REMOVE_APPLICATION',
        id: entry.id,
      });
      if (result?.ok) {
        updatePacingUI(result);
        await notifyContentScript(result.atCap);
      }
    });

    item.append(info, remove);
    els.appliedList.appendChild(item);
  });
}

function renderRejections(history = [], recurringGaps = []) {
  els.recoveryCount.textContent = `${history.length} logged`;
  els.recoveryEmpty.classList.toggle('hidden', history.length > 0);
  els.recoveryContent.classList.toggle('hidden', history.length === 0);
  els.recoveryGapsField.classList.toggle('hidden', !recurringGaps.length);
  els.recoveryGaps.innerHTML = '';
  recurringGaps.forEach((gap) => {
    const badge = document.createElement('span');
    badge.className = 'badge recovery-gap';
    badge.textContent = `${gap.name} · ${gap.count}×`;
    els.recoveryGaps.appendChild(badge);
  });

  els.recoveryList.innerHTML = '';
  history.slice(0, 10).forEach((record) => {
    const card = document.createElement('article');
    card.className = 'recovery-card';

    const head = document.createElement('div');
    head.className = 'recovery-head';
    const identity = document.createElement('div');
    identity.className = 'recovery-identity';
    const title = document.createElement('strong');
    title.textContent =
      [record.role, record.company].filter(Boolean).join(' · ') || 'Application outcome';
    const date = document.createElement('span');
    date.className = 'muted';
    date.textContent = new Date(record.analyzedAt).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    identity.append(title, date);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recovery-remove';
    remove.textContent = '×';
    remove.title = 'Remove this rejection record';
    remove.setAttribute('aria-label', `Remove ${title.textContent}`);
    remove.addEventListener('click', async () => {
      const result = await chrome.runtime.sendMessage({
        type: 'REMOVE_REJECTION',
        id: record.id,
      });
      if (result?.ok) {
        renderRejections(result.history, result.recurringGaps);
      } else {
        showError(els.recoveryError, result?.error || 'Could not remove this record.');
      }
    });
    head.append(identity, remove);

    const reflection = document.createElement('p');
    reflection.className = 'recovery-reflection';
    reflection.textContent = record.reflection;
    card.append(head, reflection);

    if (record.skillGaps?.length) {
      const gaps = document.createElement('div');
      gaps.className = 'badge-row recovery-card-gaps';
      record.skillGaps.forEach((gap) => {
        const badge = document.createElement('span');
        badge.className = 'badge domain';
        badge.textContent = gap.name;
        badge.title = gap.reason || '';
        gaps.appendChild(badge);
      });
      card.appendChild(gaps);
    }

    const next = document.createElement('p');
    next.className = 'recovery-next';
    const label = document.createElement('strong');
    label.textContent = 'One next step: ';
    next.append(label, document.createTextNode(record.nextStep || 'Record the outcome and close the loop.'));
    card.appendChild(next);
    els.recoveryList.appendChild(card);
  });
}

async function refreshRejections() {
  showError(els.recoveryError, '');
  const result = await chrome.runtime.sendMessage({ type: 'GET_REJECTIONS' });
  if (!result?.ok) {
    showError(els.recoveryError, result?.error || 'Could not load rejection history.');
    return;
  }
  renderRejections(result.history, result.recurringGaps);
}

async function addManualApplication() {
  const result = await chrome.runtime.sendMessage({
    type: 'RECORD_APPLICATION',
    jobKey: `manual-${Date.now()}`,
    title: 'Application added manually',
    method: 'manual',
  });
  if (result?.ok) {
    updatePacingUI(result);
    await notifyContentScript(result.atCap);
  }
}

// ---- Workday shutdown ritual ----------------------------------------------

const SHUTDOWN_ADVICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    congratulatorySummary: { type: 'STRING' },
    strategicAdvice: { type: 'STRING' },
  },
  required: ['congratulatorySummary', 'strategicAdvice'],
};

function fallbackShutdownAdvice(sessionJobs, uniqueSkills) {
  const count = sessionJobs.length;
  const focus = uniqueSkills.slice(0, 3);
  const focusText = focus.length ? focus.join(', ') : 'the roles you selected';
  const review = uniqueSkills.slice(0, 2);
  return {
    congratulatorySummary:
      count > 0
        ? `You moved ${count} focused application${count === 1 ? '' : 's'} forward today and protected a clear boundary around the work. Your session concentrated on ${focusText}.`
        : 'You chose to close the workday intentionally and protect your energy for tomorrow.',
    strategicAdvice: review.length
      ? `Tomorrow, spend one short review block on ${review.join(' and ')}. Stop after the planned block so preparation supports your interviews without becoming another endless task.`
      : 'Tomorrow, review one recurring requirement from your target roles for a single focused block, then step away.',
  };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Advice request timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Structured, non-chatbot Gemini output for the shutdown card.
 * Always resolves to the same two-field shape; failures use a local fallback.
 */
async function generateTailoredAdvice(sessionJobs, uniqueSkills) {
  const fallback = fallbackShutdownAdvice(sessionJobs, uniqueSkills);
  if (!settings.apiKey?.trim() || !sessionJobs.length) return fallback;

  const roles = sessionJobs
    .map(
      (job) =>
        `${job.title || 'Untitled role'} at ${job.company || 'Unknown company'}; skills: ${(job.parsedSkills || []).join(', ') || 'none extracted'}`
    )
    .join('\n');
  const prompt = `You create a concise end-of-day strategy for a job seeker. Return ONLY strict JSON matching the schema.

Applications completed today:
${roles}

Unique technical skills encountered:
${uniqueSkills.join(', ') || 'none extracted'}

Rules:
- congratulatorySummary: 1 sentence that celebrates focused progress and names the dominant role/domain pattern.
- strategicAdvice: 1 or 2 sentences naming exactly 1 or 2 specific technical topics to review tomorrow for likely interview screens.
- Do not prescribe more applications, hustle, networking, or a long study session.
- Do not use markdown, lists, generic wellness advice, or conversational filler.
- The total output should read as 2–3 short sentences.`;

  try {
    const advice = await withTimeout(
      callGeminiJson({
        apiKey: settings.apiKey,
        prompt,
        schema: SHUTDOWN_ADVICE_SCHEMA,
        temperature: 0.3,
      }),
      8000
    );
    if (!advice?.congratulatorySummary || !advice?.strategicAdvice) return fallback;
    return {
      congratulatorySummary: String(advice.congratulatorySummary).trim(),
      strategicAdvice: String(advice.strategicAdvice).trim(),
    };
  } catch {
    return fallback;
  }
}

function uniqueSessionSkills(sessionJobs) {
  const seen = new Set();
  const skills = [];
  sessionJobs.forEach((job) => {
    (job.parsedSkills || []).forEach((raw) => {
      const skill = String(raw || '').trim();
      const key = skill.toLowerCase();
      if (skill && !seen.has(key)) {
        seen.add(key);
        skills.push(skill);
      }
    });
  });
  return skills;
}

function renderShutdownSession(sessionJobs, uniqueSkills) {
  els.shutdownRoleCount.textContent = String(sessionJobs.length);
  els.shutdownRoleList.innerHTML = '';
  els.shutdownRoleEmpty.classList.toggle('hidden', sessionJobs.length > 0);

  sessionJobs.forEach((job) => {
    const item = document.createElement('li');
    item.className = 'shutdown-role-item';
    const dot = document.createElement('span');
    dot.className = 'shutdown-role-dot';
    dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'shutdown-role-title';
    title.textContent = job.title || 'Untitled role';
    const company = document.createElement('span');
    company.className = 'shutdown-role-company';
    company.textContent = job.company || 'Company not captured';
    copy.append(title, company);
    item.append(dot, copy);
    els.shutdownRoleList.appendChild(item);
  });

  els.shutdownSkillList.innerHTML = '';
  els.shutdownSkillEmpty.classList.toggle('hidden', uniqueSkills.length > 0);
  uniqueSkills.forEach((skill) => {
    const badge = document.createElement('span');
    badge.className = 'shutdown-skill';
    badge.textContent = skill;
    els.shutdownSkillList.appendChild(badge);
  });
}

async function renderShutdownAdvice(sessionJobs, uniqueSkills) {
  els.shutdownAdviceLoading.classList.remove('hidden');
  els.shutdownAdviceContent.classList.add('hidden');

  const date = localDateKey();
  const cacheKey = `shutdownAdvice_${date}`;
  const signature = JSON.stringify(
    sessionJobs.map((job) => [job.title, job.company, job.parsedSkills || []])
  );
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  let advice;
  if (cached?.signature === signature && cached?.advice) {
    advice = cached.advice;
  } else {
    advice = await generateTailoredAdvice(sessionJobs, uniqueSkills);
    await chrome.storage.local.set({
      [cacheKey]: { signature, advice, generatedAt: Date.now() },
    });
  }

  els.shutdownSummary.textContent = advice.congratulatorySummary;
  els.shutdownStrategy.textContent = advice.strategicAdvice;
  els.shutdownAdviceLoading.classList.add('hidden');
  els.shutdownAdviceContent.classList.remove('hidden');
}

async function openShutdownOverlay({ automatic = false, sessionState = null } = {}) {
  if (shutdownOpening || !els.shutdownOverlay.classList.contains('hidden')) return;
  shutdownOpening = true;
  try {
    const state =
      sessionState || (await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' }));
    if (!state?.ok || (automatic && state.shutdownCompleted)) return;

    const sessionJobs = state.currentSessionJobs || [];
    const uniqueSkills = uniqueSessionSkills(sessionJobs);
    renderShutdownSession(sessionJobs, uniqueSkills);

    els.shutdownStatus.textContent = '';
    els.shutdownStatus.classList.add('hidden');
    els.btnCompleteShutdown.disabled = false;
    els.btnCompleteShutdown.textContent = state.shutdownCompleted
      ? 'Workday Shutdown Complete'
      : 'Complete Workday Shutdown';

    els.shutdownOverlay.classList.remove('hidden');
    document.body.classList.add('shutdown-open');
    els.btnCompleteShutdown.focus();
    await renderShutdownAdvice(sessionJobs, uniqueSkills);
  } finally {
    shutdownOpening = false;
  }
}

async function maybeOpenShutdown() {
  const date = localDateKey();
  if (shutdownAutoShownDate === date || shutdownOpening) return;
  const state = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' });
  if (!state?.ok || !state.atCap || state.shutdownCompleted) return;
  shutdownAutoShownDate = date;
  await openShutdownOverlay({ automatic: true, sessionState: state });
}

function closeShutdownOverlay() {
  els.shutdownOverlay.classList.add('hidden');
  document.body.classList.remove('shutdown-open');
  els.btnWrapUp.focus();
}

async function completeShutdown() {
  els.btnCompleteShutdown.disabled = true;
  els.btnCompleteShutdown.textContent = 'Closing the workday…';
  const result = await chrome.runtime.sendMessage({ type: 'COMPLETE_SHUTDOWN' });
  if (!result?.ok) {
    els.btnCompleteShutdown.disabled = false;
    els.btnCompleteShutdown.textContent = 'Complete Workday Shutdown';
    els.shutdownStatus.textContent = result?.error || 'Could not complete shutdown.';
    els.shutdownStatus.classList.remove('hidden');
    return;
  }

  const tab = await getActiveLinkedInTab();
  if (tab?.id) {
    await chrome.tabs
      .sendMessage(tab.id, { type: 'SHUTDOWN_LOCK' })
      .catch(() => {});
  }
  els.shutdownStatus.textContent =
    'Workday closed. LinkedIn applications are locked until tomorrow.';
  els.shutdownStatus.classList.remove('hidden');
  els.btnCompleteShutdown.textContent = 'Workday Shutdown Complete';
  setTimeout(closeShutdownOverlay, 1200);
}

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (!res?.ok) return;
  settings = {
    apiKey: res.apiKey || '',
    dailyAppCap: res.dailyAppCap ?? 4,
    userSkills: res.userSkills || [],
    skillProfile: res.skillProfile || [],
    resumeName: res.resumeName || '',
  };
  els.settingCap.value = settings.dailyAppCap;
  els.settingKey.value = settings.apiKey;
  draftProfile = settings.skillProfile.map((s) => ({ ...s }));
  renderSkillProfile();
}

function renderSkillProfile() {
  els.skillProfile.innerHTML = '';
  if (!draftProfile.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No skills yet — drop a resume above.';
    els.skillProfile.appendChild(empty);
    return;
  }

  if (settings.resumeName) {
    const from = document.createElement('p');
    from.className = 'muted skill-from';
    from.textContent = `${draftProfile.length} skills from ${settings.resumeName}`;
    els.skillProfile.appendChild(from);
  }

  const groups = new Map(SKILL_CATEGORIES.map((c) => [c, []]));
  draftProfile.forEach((skill) => {
    const key = groups.has(skill.category) ? skill.category : 'Other';
    groups.get(key).push(skill);
  });

  for (const [category, skills] of groups) {
    if (!skills.length) continue;
    const group = document.createElement('div');
    group.className = 'skill-group';
    const title = document.createElement('span');
    title.className = 'field-label';
    title.textContent = category;
    group.appendChild(title);

    skills.forEach((skill) => {
      const row = document.createElement('div');
      row.className = 'skill-row';

      const head = document.createElement('div');
      head.className = 'skill-head';
      const name = document.createElement('span');
      name.className = 'skill-name';
      name.textContent = skill.name;
      head.appendChild(name);

      const meta = [skill.level, skill.years ? `${skill.years} yr${skill.years === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(' · ');
      if (meta) {
        const level = document.createElement('span');
        level.className = `skill-level level-${(skill.level || 'none').toLowerCase()}`;
        level.textContent = meta;
        head.appendChild(level);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${skill.name}`);
      remove.addEventListener('click', () => {
        draftProfile = draftProfile.filter((s) => s !== skill);
        renderSkillProfile();
      });
      head.appendChild(remove);
      row.appendChild(head);

      if (skill.evidence) {
        const evidence = document.createElement('p');
        evidence.className = 'skill-evidence';
        evidence.textContent = skill.evidence;
        row.appendChild(evidence);
      }
      group.appendChild(row);
    });
    els.skillProfile.appendChild(group);
  }
}

function setResumeStatus(message) {
  els.resumeStatus.textContent = message || '';
  els.resumeStatus.classList.toggle('hidden', !message);
}

let resumeReading = false;

/** While a resume is being read, the dialog can't be saved or closed. */
function setResumeReading(reading, fileName = '') {
  resumeReading = reading;
  els.resumeDrop.classList.toggle('busy', reading);
  els.resumeDrop.setAttribute('aria-busy', String(reading));
  els.resumeDropText.textContent = reading ? `Reading ${fileName}…` : 'Drop your resume PDF here';
  els.btnSaveSettings.disabled = reading;
  els.btnCloseSettings.disabled = reading;
  els.skillProfile.setAttribute('aria-busy', String(reading));

  if (reading) {
    els.skillProfile.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'skill-row skill-skeleton';
      row.innerHTML = '<span class="skeleton-line"></span><span class="skeleton-line short"></span>';
      els.skillProfile.appendChild(row);
    }
  }
}

/** A new resume fully replaces the old skills and is saved immediately. */
async function handleResumeFile(file) {
  if (!file || resumeReading) return;
  showError(els.resumeError, '');
  setResumeStatus('');
  const previous = draftProfile;
  draftProfile = [];
  setResumeReading(true, file.name);
  try {
    const { profile, source, error } = await extractSkillsFromPdf(file, {
      apiKey: els.settingKey.value,
    });
    if (!profile.length) {
      throw new Error('No recognizable skills found in that PDF.');
    }

    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', skillProfile: profile, resumeName: file.name });
    const saved = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    settings = {
      ...settings,
      userSkills: saved.userSkills || [],
      skillProfile: saved.skillProfile || [],
      resumeName: saved.resumeName || '',
    };
    draftProfile = settings.skillProfile.map((s) => ({ ...s }));
    setResumeReading(false);
    renderSkillProfile();

    const via = {
      gemini: 'Described by Gemini',
      catalog: 'Found by offline keyword match — add a Gemini key for proficiency levels and richer descriptions',
      'catalog-fallback': `Found by offline keyword match (Gemini failed: ${error})`,
    }[source];
    setResumeStatus(`Replaced your previous skills. ${via}.`);
  } catch (err) {
    draftProfile = previous;
    setResumeReading(false);
    renderSkillProfile();
    showError(els.resumeError, `${err?.message || 'Could not read that PDF.'} Your previous skills were kept.`);
  } finally {
    if (resumeReading) setResumeReading(false);
    els.resumeFile.value = '';
  }
}

function initResumeDrop() {
  const zone = els.resumeDrop;
  zone.addEventListener('click', () => els.resumeFile.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.resumeFile.click();
    }
  });
  els.resumeFile.addEventListener('change', () => handleResumeFile(els.resumeFile.files?.[0]));

  ['dragenter', 'dragover'].forEach((type) =>
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    })
  );
  ['dragleave', 'dragend'].forEach((type) =>
    zone.addEventListener(type, (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
    })
  );
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleResumeFile(e.dataTransfer?.files?.[0]);
  });

  // A PDF dropped outside the zone would otherwise replace the side panel with the file.
  ['dragover', 'drop'].forEach((type) => window.addEventListener(type, (e) => e.preventDefault()));
}

els.btnScrape.addEventListener('click', scrapeActiveJob);
els.btnParse.addEventListener('click', runParseAndMatch);
els.btnAddManual.addEventListener('click', addManualApplication);
els.btnWrapUp.addEventListener('click', () => openShutdownOverlay());
els.btnCloseShutdown.addEventListener('click', closeShutdownOverlay);
els.btnCompleteShutdown.addEventListener('click', completeShutdown);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.shutdownOverlay.classList.contains('hidden')) {
    closeShutdownOverlay();
  }
});

els.btnSettings.addEventListener('click', async () => {
  await loadSettings();
  showError(els.resumeError, '');
  setResumeStatus('');
  els.settingsDialog.showModal();
});

initResumeDrop();

els.btnCloseSettings.addEventListener('click', () => els.settingsDialog.close());

// Esc fires `cancel` on a modal dialog; keep it open until the resume is read.
// Chrome force-closes on a repeated Esc unless the keydown itself is prevented.
els.settingsDialog.addEventListener('cancel', (e) => {
  if (resumeReading) e.preventDefault();
});
els.settingsDialog.addEventListener('keydown', (e) => {
  if (resumeReading && e.key === 'Escape') e.preventDefault();
});

els.settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (resumeReading) return;
  settings = {
    dailyAppCap: Number(els.settingCap.value) || 4,
    apiKey: els.settingKey.value.trim(),
    skillProfile: draftProfile,
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', ...settings });
  els.settingsDialog.close();
  await loadSettings(); // pick up the cleaned/deduped skills list
  await refreshPacing();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.appsSubmittedToday || changes.dailyAppCap) {
    refreshPacing();
  }
  if (changes.applicationLog) renderApplications();
  if (changes.rejectionHistory) refreshRejections();
});

(async function init() {
  await loadSettings();
  await refreshPacing();
  await renderApplications();
  await refreshRejections();
  initBreathing();
  await scrapeActiveJob();
})();
