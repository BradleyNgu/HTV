/**
 * Skills-gap plan + interview prep panels. All output renders into fixed
 * UI components (badges, cards, checklists) — there is no chat surface.
 */

import { analyzeSkillsGap } from '../services/skillsGap.js';
import { generatePracticePrompts, CALM_CHECKLIST } from '../services/interviewPrep.js';
import { getCurrentEnergy } from './wellbeing.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setError(node, message) {
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

/**
 * @param {{ getContext: () => { parsed: object|null, matches: Array, settings: object } }} deps
 */
export function initCareerTools({ getContext }) {
  const gap = {
    btn: $('btn-gap'),
    empty: $('gap-empty'),
    content: $('gap-content'),
    fitFill: $('fit-fill'),
    fitLabel: $('fit-label'),
    matched: $('matched-badges'),
    missing: $('missing-list'),
    planLabel: $('plan-label'),
    plan: $('plan-list'),
    source: $('gap-source'),
    error: $('gap-error'),
  };
  const prep = {
    btn: $('btn-prep'),
    empty: $('prep-empty'),
    content: $('prep-content'),
    error: $('prep-error'),
  };

  // Static calm-down checklist is available any time.
  const calm = $('calm-list');
  CALM_CHECKLIST.forEach((text, i) => {
    const li = el('li', 'calm-item');
    const box = el('input');
    box.type = 'checkbox';
    box.id = `calm-${i}`;
    const label = el('label', '', text);
    label.htmlFor = box.id;
    li.append(box, label);
    calm.appendChild(li);
  });

  // ---- Skills gap ----------------------------------------------------------
  function renderGap(result, energy) {
    gap.empty.classList.add('hidden');
    gap.content.classList.remove('hidden');

    const pct = result.fitPercent;
    gap.fitFill.style.width = `${pct ?? 0}%`;
    gap.fitLabel.textContent =
      pct == null
        ? 'No specific technologies were listed in this posting.'
        : `${result.matchedSkills.length} of ${result.requiredCount} required technologies covered (${pct}%)`;

    gap.matched.innerHTML = '';
    if (result.matchedSkills.length) {
      result.matchedSkills.forEach((s) => gap.matched.appendChild(el('span', 'badge seniority', s)));
    } else {
      gap.matched.appendChild(el('span', 'muted', 'None of the listed technologies yet.'));
    }

    gap.missing.innerHTML = '';
    if (!result.missingSkills.length) {
      gap.missing.appendChild(el('li', 'muted', 'No gaps found. You list every required technology.'));
    }
    result.missingSkills.forEach((m) => {
      const li = el('li', 'gap-item');
      const head = el('div', 'gap-head');
      head.append(el('span', 'badge', m.skill), el('span', `prio prio-${m.priority}`, m.priority));
      li.append(head, el('p', 'gap-reason', m.reason));
      gap.missing.appendChild(li);
    });

    const light = energy != null && energy < 2.5;
    gap.planLabel.textContent = `Paced plan · ${result.hoursPerWeek}h per week${
      light ? ' (kept light for a low-energy day)' : ''
    }`;
    gap.plan.innerHTML = '';
    result.weeklyPlan.forEach((w) => {
      const card = el('article', 'plan-card');
      const head = el('div', 'plan-head');
      head.append(el('strong', '', `Week ${w.week} · ${w.focus}`), el('span', 'muted', `~${w.hours}h`));
      const list = el('ul', 'plan-tasks');
      w.tasks.forEach((t) => list.appendChild(el('li', '', t)));
      card.append(head, list);
      gap.plan.appendChild(card);
    });

    const labels = {
      gemini: 'Plan written by Gemini. Gaps computed locally.',
      heuristic: 'Offline plan. Add a Gemini key in settings for role-specific reasons and tasks.',
      'heuristic-fallback': 'Gemini unavailable. Showing the offline plan.',
      local: 'Computed locally.',
    };
    gap.source.textContent = labels[result._source] || '';
    setError(gap.error, result._error || '');
  }

  async function runGap() {
    const ctx = getContext();
    setError(gap.error, '');
    if (!ctx.parsed) {
      setError(gap.error, 'Parse a job first.');
      return;
    }
    const skills = ctx.settings.userSkills || [];
    if (!skills.length) {
      setError(gap.error, 'Upload your resume in ⚙ settings first so there is something to compare.');
      return;
    }

    gap.btn.disabled = true;
    gap.btn.textContent = 'Analyzing…';
    try {
      const energy = await getCurrentEnergy();
      const result = await analyzeSkillsGap(ctx.parsed, skills, {
        apiKey: ctx.settings.apiKey || '',
        energy,
        skillProfile: ctx.settings.skillProfile || [],
      });
      renderGap(result, energy);
    } catch (err) {
      setError(gap.error, err?.message || 'Skills analysis failed.');
    } finally {
      gap.btn.disabled = false;
      gap.btn.textContent = 'Analyze';
    }
  }

  // ---- Interview prep ------------------------------------------------------
  function renderPrep(result, stories) {
    prep.empty.classList.add('hidden');
    prep.content.classList.remove('hidden');
    prep.content.innerHTML = '';
    const byId = new Map(stories.map((s) => [s.id, s]));

    result.questions.forEach((q, i) => {
      const card = el('article', 'prep-card');
      card.appendChild(el('p', 'prep-q', `${i + 1}. ${q.question}`));
      if (q.openingLine) {
        const open = el('p', 'prep-open');
        open.append(el('span', 'prep-tag', 'Open with'), document.createTextNode(` ${q.openingLine}`));
        card.appendChild(open);
      }
      if (q.tip) card.appendChild(el('p', 'prep-tip', q.tip));

      const story = byId.get(q.starStoryId);
      if (story) {
        const details = el('details', 'prep-story');
        details.appendChild(el('summary', '', `Your story: ${story.title}`));
        [
          ['Situation', story.situation],
          ['Task', story.task],
          ['Action', story.action],
          ['Result', story.result],
        ].forEach(([label, text]) => {
          const row = el('p', 'prep-star-row');
          row.append(el('strong', '', `${label}: `), document.createTextNode(text));
          details.appendChild(row);
        });
        card.appendChild(details);
      }
      prep.content.appendChild(card);
    });

    setError(
      prep.error,
      result._source === 'heuristic-fallback' ? `Gemini unavailable (${result._error}). Showing offline prompts.` : ''
    );
  }

  async function runPrep() {
    const ctx = getContext();
    setError(prep.error, '');
    if (!ctx.parsed || !ctx.matches.length) {
      setError(prep.error, 'Parse a job and get STAR matches first.');
      return;
    }
    prep.btn.disabled = true;
    prep.btn.textContent = 'Generating…';
    try {
      const result = await generatePracticePrompts(ctx.parsed, ctx.matches, {
        apiKey: ctx.settings.apiKey || '',
      });
      renderPrep(result, ctx.matches);
    } catch (err) {
      setError(prep.error, err?.message || 'Could not generate prompts.');
    } finally {
      prep.btn.disabled = false;
      prep.btn.textContent = 'Generate prompts';
    }
  }

  gap.btn.addEventListener('click', runGap);
  prep.btn.addEventListener('click', runPrep);

  return {
    /** Enable/disable buttons based on what has been parsed/matched. */
    refresh() {
      const ctx = getContext();
      gap.btn.disabled = !ctx.parsed;
      prep.btn.disabled = !(ctx.parsed && ctx.matches.length);
    },
    /** Clear stale results when a new job is parsed. */
    reset() {
      gap.content.classList.add('hidden');
      gap.empty.classList.remove('hidden');
      prep.content.classList.add('hidden');
      prep.content.innerHTML = '';
      prep.empty.classList.remove('hidden');
      setError(gap.error, '');
      setError(prep.error, '');
    },
  };
}
