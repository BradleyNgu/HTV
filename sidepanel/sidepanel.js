import { parseJob } from '../services/aiParser.js';
import { matchStarStoriesSemantic } from '../services/starMatcher.js';
import { extractSkillsFromPdf, SKILL_CATEGORIES } from '../services/resumeSkills.js';
import { callGeminiJson } from '../services/gemini.js';
import { initCareerTools } from './careerTools.js';
import { initCollapsibles } from './collapsible.js';

initCollapsibles();

function localDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const els = {
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
  shutdownTheme: document.getElementById('shutdown-theme'),
  shutdownPlan: document.getElementById('shutdown-plan'),
  shutdownStop: document.getElementById('shutdown-stop'),
  shutdownStatus: document.getElementById('shutdown-status'),
  btnCompleteShutdown: document.getElementById('btn-complete-shutdown'),
  btnCloseShutdown: document.getElementById('btn-close-shutdown'),
  dayDone: document.getElementById('day-done'),
  dayDoneTitle: document.getElementById('day-done-title'),
  dayDoneStats: document.getElementById('day-done-stats'),
  btnDayDoneBack: document.getElementById('btn-day-done-back'),
  btnScrape: document.getElementById('btn-scrape'),
  btnParse: document.getElementById('btn-parse'),
  jobEmpty: document.getElementById('job-empty'),
  jobContent: document.getElementById('job-content'),
  jobTitle: document.getElementById('job-title'),
  jobCompany: document.getElementById('job-company'),
  jobUrl: document.getElementById('job-url'),
  jobError: document.getElementById('job-error'),
  sectionParsed: document.getElementById('section-parsed'),
  parsedContent: document.getElementById('parsed-content'),
  techBadges: document.getElementById('tech-badges'),
  domainBadges: document.getElementById('domain-badges'),
  seniorityBadges: document.getElementById('seniority-badges'),
  respList: document.getElementById('resp-list'),
  parseSource: document.getElementById('parse-source'),
  parseError: document.getElementById('parse-error'),
  btnMascot: document.getElementById('btn-mascot'),
  mascotBubble: document.getElementById('mascot-bubble'),
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
// URL of the job that currentParsed/currentMatches describe.
let analyzedJobUrl = '';
let settings = { apiKey: '', dailyAppCap: 4, userSkills: [], skillProfile: [], resumeName: '' };
// Skill profile shown in the open settings dialog; removals persist on Save.
let draftProfile = [];
let shutdownOpening = false;
let shutdownAutoShownDate = '';
// Date the user chose "Back to the panel" on the day-complete screen.
let dayDoneDismissedDate = '';

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
    await notifyContentScript(res);
  }
}

function isLinkedInJobsUrl(url = '') {
  return /linkedin\.com\/jobs(\/|$|\?)/i.test(url) || /linkedin\.com\/jobs\/view\//i.test(url);
}

async function getActiveLinkedInTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isLinkedInJobsUrl(active.url)) return active;

  // Side panel focus can leave another tab "active", so fall back to any Jobs tab
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

function updateSectionVisibility() {
  const hasParseError = !els.parseError.classList.contains('hidden');
  els.sectionParsed.classList.toggle('hidden', !currentParsed && !hasParseError);
  careerTools.refresh();
}

/** Drop results that belong to a job that is no longer the active one. */
function clearAnalysis() {
  currentParsed = null;
  currentMatches = [];
  analyzedJobUrl = '';
  careerTools.reset();
  els.parsedContent.classList.add('hidden');
  showError(els.parseError, '');
  updateSectionVisibility();
}

async function scrapeActiveJob() {
  try {
    await scrapeJobIntoPanel();
  } finally {
    if (!currentJob || (currentJob.url || '') !== analyzedJobUrl) clearAnalysis();
  }
}

async function scrapeJobIntoPanel() {
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
    heuristic: 'Parsed offline (heuristic; add a Gemini API key in settings for richer results)',
    'heuristic-fallback': 'API failed; showing heuristic fallback',
  };
  els.parseSource.textContent = sourceLabel[parsed._source] || 'Parsed';
  if (parsed._error) {
    showError(els.parseError, parsed._error);
  } else {
    showError(els.parseError, '');
  }
}

async function runParseAndMatch() {
  if (!currentJob?.description) {
    showError(els.jobError, 'Scrape a job with a description before parsing.');
    return;
  }

  els.btnParse.disabled = true;
  els.btnParse.textContent = 'Parsing…';
  clearAnalysis();
  try {
    const parsed = await parseJob(currentJob, settings);
    renderParsed(parsed);
    currentParsed = parsed;
    analyzedJobUrl = currentJob.url || '';
    await chrome.runtime.sendMessage({
      type: 'ENRICH_SESSION_JOB',
      url: currentJob.url,
      parsedSkills: parsed.requiredTechStack || [],
    });

    const storiesRes = await chrome.runtime.sendMessage({ type: 'GET_RESUME_STORIES' });
    const resumeStories = storiesRes?.resumeStories || [];
    if (!resumeStories.length) {
      currentMatches = [];
    } else {
      const { matches } = await matchStarStoriesSemantic(parsed, resumeStories, {
        apiKey: settings.apiKey,
        limit: 2,
        job: currentJob,
      });
      currentMatches = matches;
    }
  } catch (err) {
    showError(els.parseError, err?.message || 'Parse failed.');
  } finally {
    els.btnParse.disabled = false;
    els.btnParse.textContent = 'Parse requirements';
    updateSectionVisibility();
  }
}

/** Tell the LinkedIn tab the cap changed so Easy Apply locks/unlocks right away. */
async function notifyContentScript(pacing = {}) {
  const tab = await getActiveLinkedInTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'PACING_UPDATED',
      atCap: Boolean(pacing.atCap),
      shutdownLocked: Boolean(pacing.shutdownLocked),
      appsSubmittedToday: pacing.appsSubmittedToday,
      dailyAppCap: pacing.dailyAppCap,
    }).catch(() => {});
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
        await notifyContentScript(result);
      }
    });

    item.append(info, remove);
    els.appliedList.appendChild(item);
  });
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
    await notifyContentScript(result);
  }
}

// ---- Workday shutdown ritual ----------------------------------------------

const SHUTDOWN_ADVICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    congratulatorySummary: { type: 'STRING' },
    focusTheme: { type: 'STRING' },
    plan: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          minutes: { type: 'INTEGER' },
          title: { type: 'STRING' },
          why: { type: 'STRING' },
          how: { type: 'STRING' },
        },
        required: ['minutes', 'title', 'why', 'how'],
      },
    },
    stopRule: { type: 'STRING' },
  },
  required: ['congratulatorySummary', 'focusTheme', 'plan', 'stopRule'],
};

function fallbackShutdownAdvice(sessionJobs, uniqueSkills) {
  const count = sessionJobs.length;
  const focus = uniqueSkills.slice(0, 3);
  const focusText = focus.length ? focus.join(', ') : 'the roles you selected';
  const first = uniqueSkills[0] || 'one core requirement from today\'s postings';
  const second = uniqueSkills[1] || 'a second skill that showed up more than once';
  return {
    congratulatorySummary:
      count > 0
        ? `You moved ${count} focused application${count === 1 ? '' : 's'} forward today and protected a clear boundary around the work. Your session concentrated on ${focusText}.`
        : 'You chose to close the workday intentionally and protect your energy for tomorrow.',
    focusTheme: `A 75-minute review of ${first} and ${second}, then stop.`,
    plan: [
      {
        minutes: 25,
        title: `Review ${first}`,
        why: 'This showed up in today\'s applications, so a short refresh is more useful than starting a new topic.',
        how: 'Read one concise explanation, then write three interview talking points from memory.',
      },
      {
        minutes: 25,
        title: `Practice ${second}`,
        why: 'A second pass on a repeated skill beats spreading attention across the whole stack.',
        how: 'Work one small example or sketch, then note the trade-off you would explain in a screen.',
      },
      {
        minutes: 15,
        title: 'Connect one resume point to tomorrow\'s likely questions',
        why: 'Interviewers ask for proof, not a recap of the job description.',
        how: 'Pick one project bullet and write Situation, Task, Action, and Result in four short lines.',
      },
      {
        minutes: 10,
        title: 'Close the loop',
        why: 'A written stop time keeps preparation from turning into another workday.',
        how: 'Save notes, set the next review date, and leave the job boards closed.',
      },
    ],
    stopRule: 'When the 75 minutes are done, stop even if the notes feel unfinished. Rest is part of the plan.',
  };
}

function cleanShutdownAdvice(raw, fallback) {
  const plan = (Array.isArray(raw?.plan) ? raw.plan : [])
    .map((block) => ({
      minutes: Math.max(5, Math.min(40, Number(block?.minutes) || 20)),
      title: String(block?.title || '').trim().slice(0, 80),
      why: String(block?.why || '').trim().slice(0, 220),
      how: String(block?.how || '').trim().slice(0, 220),
    }))
    .filter((block) => block.title && block.why && block.how)
    .slice(0, 4);
  if (plan.length < 3) return fallback;
  return {
    congratulatorySummary: String(raw?.congratulatorySummary || fallback.congratulatorySummary).trim(),
    focusTheme: String(raw?.focusTheme || fallback.focusTheme).trim(),
    plan,
    stopRule: String(raw?.stopRule || fallback.stopRule).trim(),
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
 * Always resolves to summary + time-boxed plan; failures use a local fallback.
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
  const prompt = `You create a bounded next-day interview prep plan for a job seeker who just hit their daily application cap. Return ONLY strict JSON matching the schema.

Applications completed today:
${roles}

Unique technical skills encountered:
${uniqueSkills.join(', ') || 'none extracted'}

Rules:
- congratulatorySummary: 1-2 sentences naming the role/domain pattern from today. No hustle language.
- focusTheme: one line describing tomorrow's 60-90 minute theme, naming 1-2 technical topics drawn from today's skills.
- plan: exactly 4 blocks. minutes must sum to 60-90. Each block needs title, why (tied to today's jobs), and how (one concrete action).
- Block 1-2: technical review for likely screens. Block 3: connect one resume point to those topics. Block 4: close notes and stop.
- stopRule: one sentence that forbids extra applications, extra hours, or opening the job board after the last block.
- Do not invent tools or skills that were not listed. Do not prescribe more applications or networking.`;

  try {
    const advice = await withTimeout(
      callGeminiJson({
        apiKey: settings.apiKey,
        prompt,
        schema: SHUTDOWN_ADVICE_SCHEMA,
        temperature: 0.3,
      }),
      12000
    );
    return cleanShutdownAdvice(advice, fallback);
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
  if (cached?.signature === signature && cached?.advice?.plan?.length) {
    advice = cleanShutdownAdvice(cached.advice, fallbackShutdownAdvice(sessionJobs, uniqueSkills));
  } else {
    advice = await generateTailoredAdvice(sessionJobs, uniqueSkills);
    await chrome.storage.local.set({
      [cacheKey]: { signature, advice, generatedAt: Date.now() },
    });
  }

  els.shutdownSummary.textContent = advice.congratulatorySummary;
  els.shutdownTheme.textContent = advice.focusTheme;
  els.shutdownPlan.innerHTML = '';
  advice.plan.forEach((block) => {
    const item = document.createElement('li');
    item.className = 'shutdown-plan-item';
    const head = document.createElement('div');
    head.className = 'shutdown-plan-head';
    const title = document.createElement('strong');
    title.textContent = block.title;
    const mins = document.createElement('span');
    mins.className = 'muted';
    mins.textContent = `${block.minutes} min`;
    head.append(title, mins);
    const why = document.createElement('p');
    why.textContent = block.why;
    const how = document.createElement('p');
    how.className = 'shutdown-plan-how';
    how.textContent = block.how;
    item.append(head, why, how);
    els.shutdownPlan.appendChild(item);
  });
  els.shutdownStop.textContent = advice.stopRule;
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
  els.btnCompleteShutdown.textContent = 'Workday Shutdown Complete';
  closeShutdownOverlay();
  dayDoneDismissedDate = '';
  await syncDayDone();
}

// ---- Day complete screen ---------------------------------------------------

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function setPanelInert(inert) {
  for (const child of document.body.children) {
    if (child !== els.dayDone && child.tagName !== 'SCRIPT') child.inert = inert;
  }
}

function showDayDone(sessionJobs = []) {
  const skills = uniqueSessionSkills(sessionJobs).length;
  els.dayDoneStats.textContent = sessionJobs.length
    ? `${plural(sessionJobs.length, 'application')} sent${skills ? ` · ${plural(skills, 'skill')} noted` : ''}`
    : '';
  const wasHidden = els.dayDone.classList.contains('hidden');
  els.dayDone.classList.remove('hidden');
  document.body.classList.add('shutdown-open');
  setPanelInert(true);
  if (wasHidden) els.dayDoneTitle.focus();
}

function hideDayDone() {
  if (els.dayDone.classList.contains('hidden')) return;
  els.dayDone.classList.add('hidden');
  document.body.classList.remove('shutdown-open');
  setPanelInert(false);
}

/** Show the day-complete screen whenever today's shutdown is done (unless dismissed). */
async function syncDayDone() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' });
  if (!state?.ok) return;
  if (!state.shutdownCompleted) {
    hideDayDone();
  } else if (dayDoneDismissedDate !== localDateKey()) {
    showDayDone(state.currentSessionJobs || []);
  }
}

async function resetDay() {
  const res = await chrome.runtime.sendMessage({ type: 'RESET_DAY' });
  if (!res?.ok) throw new Error(res?.error || 'Could not reset today.');
  dayDoneDismissedDate = '';
  shutdownAutoShownDate = '';
  const fromDayDone = !els.dayDone.classList.contains('hidden');
  hideDayDone();
  updatePacingUI(res);
  await notifyContentScript(res);
  await renderApplications();
  if (fromDayDone) els.btnWrapUp.focus();
}

/** Reset buttons need a second click within a few seconds, since the reset can't be undone. */
function initResetDayButtons() {
  document.querySelectorAll('[data-reset-day]').forEach((button) => {
    const label = button.textContent;
    let timer = null;
    const disarm = () => {
      clearTimeout(timer);
      button.classList.remove('confirming');
      button.textContent = label;
    };
    button.addEventListener('click', async () => {
      if (!button.classList.contains('confirming')) {
        button.classList.add('confirming');
        button.textContent = 'Click again to reset';
        timer = setTimeout(disarm, 4000);
        return;
      }
      clearTimeout(timer);
      button.disabled = true;
      button.textContent = 'Resetting…';
      let failed = false;
      try {
        await resetDay();
      } catch {
        failed = true;
      }
      button.disabled = false;
      disarm();
      if (failed) {
        button.textContent = 'Reset failed. Try again';
        timer = setTimeout(disarm, 4000);
      } else if (!button.closest('.day-done')) {
        button.textContent = 'Today was reset';
        timer = setTimeout(disarm, 2500);
      }
    });
    button.addEventListener('blur', () => {
      if (!button.disabled) disarm();
    });
  });
}

async function wrapUpDay() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' });
  if (state?.ok && state.shutdownCompleted) {
    dayDoneDismissedDate = '';
    showDayDone(state.currentSessionJobs || []);
    return;
  }
  await openShutdownOverlay({ sessionState: state?.ok ? state : null });
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
    empty.textContent = 'No skills yet. Drop a resume above.';
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
    const { profile, stories = [], source, error } = await extractSkillsFromPdf(file, {
      apiKey: els.settingKey.value,
    });
    if (!profile.length) {
      throw new Error('No recognizable skills found in that PDF.');
    }

    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      skillProfile: profile,
      resumeStories: stories,
      resumeName: file.name,
    });
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
      catalog: 'Found by offline keyword match. Add a Gemini key for proficiency levels and richer descriptions',
      'catalog-fallback': `Found by offline keyword match (Gemini failed: ${error})`,
    }[source];
    const storyNote = stories.length
      ? ` ${stories.length} resume ${stories.length === 1 ? 'story' : 'stories'} ready for interview prep.`
      : ' No experience bullets were found for interview prep.';
    setResumeStatus(`Replaced your previous skills. ${via}.${storyNote}`);
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
els.btnWrapUp.addEventListener('click', wrapUpDay);
initResetDayButtons();
els.btnDayDoneBack.addEventListener('click', () => {
  dayDoneDismissedDate = localDateKey();
  hideDayDone();
  els.btnWrapUp.focus();
});
// A panel left open overnight should drop yesterday's screen when it's looked at again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncDayDone();
});
els.btnCloseShutdown.addEventListener('click', closeShutdownOverlay);
els.btnCompleteShutdown.addEventListener('click', completeShutdown);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.shutdownOverlay.classList.contains('hidden')) {
    closeShutdownOverlay();
  }
});

// Check-san's click lines. Add or edit strings here; one is picked at random.
const MASCOT_LINES = [
  'Never accept the world as it appears to be, dare to see it for what it could be.',
  'Good job, keep on going!'
  `I'm Check-San, I'll be here for you.`,
  'Stay hungry, stay foolish.',
`You've gotten through 100% of your worst days.`,
`I'm hungry.`
];

function hideMascotBubble() {
  els.mascotBubble.classList.add('hidden');
  els.mascotBubble.textContent = '';
}

function speakMascotLine() {
  const lines = MASCOT_LINES.filter(Boolean);
  if (!lines.length) return;
  const current = els.mascotBubble.textContent;
  const pool = lines.length > 1 ? lines.filter((line) => line !== current) : lines;
  els.mascotBubble.textContent = pool[Math.floor(Math.random() * pool.length)];
  els.mascotBubble.classList.remove('hidden');
}

els.btnMascot.addEventListener('click', (e) => {
  e.stopPropagation();
  speakMascotLine();
});

document.addEventListener('click', (e) => {
  if (!els.btnMascot.contains(e.target) && !els.mascotBubble.contains(e.target)) {
    hideMascotBubble();
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
  if (changes.shutdownCompletedDate) syncDayDone();
});

(async function init() {
  await syncDayDone();
  await loadSettings();
  await refreshPacing();
  await renderApplications();
  await scrapeActiveJob();
})();
