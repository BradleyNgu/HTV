/**
 * Skills-gap analysis + paced learning plan.
 *
 * The gap itself (what the job needs vs. what you have) is computed
 * deterministically so it is explainable and never hallucinated.
 * Gemini is only used to prioritise the gaps and write a realistic plan
 * sized to the learner's energy — output is structured JSON, not chat.
 */

import { callGeminiJson } from './gemini.js';

const ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  node: 'nodejs',
  'node.js': 'nodejs',
  golang: 'go',
  postgresql: 'postgres',
  k8s: 'kubernetes',
  'react.js': 'react',
  reactjs: 'react',
  'next.js': 'nextjs',
  'amazon web services': 'aws',
  'google cloud': 'gcp',
  'google cloud platform': 'gcp',
  'c sharp': 'c#',
  'machine learning': 'ml',
};

export function normalizeSkill(raw) {
  const key = String(raw || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (ALIASES[key]) return ALIASES[key];
  return key.replace(/\.js$/, '');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Exact match after normalising, or whole-word containment for skills of 3+ chars. */
export function skillMatches(a, b) {
  const na = normalizeSkill(a);
  const nb = normalizeSkill(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(short)}([^a-z0-9+#]|$)`).test(long);
}

/** Study hours per week scaled to current energy (1–5). Rest is part of the plan. */
export function hoursForEnergy(energy) {
  if (energy == null || Number.isNaN(energy)) return 5;
  if (energy < 2.5) return 3;
  if (energy < 3.5) return 5;
  return 7;
}

function unique(list) {
  const seen = new Set();
  return list.filter((s) => {
    const k = normalizeSkill(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Deterministic gap: required tech the user does / does not list. */
export function computeGap(parsedJob, userSkills) {
  const required = unique(parsedJob?.requiredTechStack || []).filter(
    (s) => !/^general\b/i.test(s)
  );
  const matched = [];
  const missing = [];
  for (const skill of required) {
    (userSkills.some((u) => skillMatches(skill, u)) ? matched : missing).push(skill);
  }
  const fitPercent = required.length ? Math.round((matched.length / required.length) * 100) : null;
  return { required, matched, missing, fitPercent };
}

function heuristicPlan(missing, hoursPerWeek) {
  const priorities = ['high', 'high', 'medium', 'medium', 'low'];
  const missingSkills = missing.map((skill, i) => ({
    skill,
    priority: priorities[Math.min(i, priorities.length - 1)],
    reason: 'Listed as a required technology in this posting.',
  }));

  const h = (share) => Math.max(1, Math.round(hoursPerWeek * share));
  const weeklyPlan = missing.slice(0, 4).map((skill, i) => ({
    week: i + 1,
    focus: skill,
    hours: hoursPerWeek,
    tasks: [
      `Work through a short intro or the official quick-start for ${skill} (~${h(0.3)}h)`,
      `Build one small project that uses ${skill} (~${h(0.5)}h)`,
      `Write 2–3 resume bullets or notes about what you built (~${h(0.2)}h)`,
    ],
  }));

  return { missingSkills, weeklyPlan };
}

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    missingSkills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          skill: { type: 'STRING' },
          priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          reason: { type: 'STRING' },
        },
        required: ['skill', 'priority', 'reason'],
      },
    },
    weeklyPlan: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          week: { type: 'INTEGER' },
          focus: { type: 'STRING' },
          hours: { type: 'INTEGER' },
          tasks: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['week', 'focus', 'hours', 'tasks'],
      },
    },
  },
  required: ['missingSkills', 'weeklyPlan'],
};

function buildPrompt(parsedJob, gap, userSkills, hoursPerWeek) {
  return `You help a job seeker close skill gaps WITHOUT burning out.
Return ONLY JSON matching the schema.

Target role seniority: ${parsedJob.seniorityLevel || 'unknown'}
Domain constraints: ${(parsedJob.domainConstraints || []).join(', ') || 'none listed'}
Key responsibilities: ${(parsedJob.keyResponsibilities || []).slice(0, 4).join(' | ')}

Skills the person already has: ${userSkills.join(', ') || 'none listed'}
Skills still missing (only use these): ${gap.missing.join(', ')}

Rules:
- missingSkills: one entry per missing skill, ordered most important first for THIS role; give a one-sentence reason tied to the role.
- weeklyPlan: at most 4 weeks; each week focuses on ONE skill; "hours" must be <= ${hoursPerWeek}.
- Each week has 3 concrete, small, finishable tasks (build/read/practice). No vague advice.
- Prefer building on skills the person already has. Do not add rest days or motivational text.`;
}

/**
 * @param {object} parsedJob
 * @param {string[]} userSkills
 * @param {{ apiKey?: string, energy?: number|null }} opts
 */
export async function analyzeSkillsGap(parsedJob, userSkills, { apiKey = '', energy = null } = {}) {
  const hoursPerWeek = hoursForEnergy(energy);
  const gap = computeGap(parsedJob, userSkills);
  const base = {
    matchedSkills: gap.matched,
    requiredCount: gap.required.length,
    fitPercent: gap.fitPercent,
    hoursPerWeek,
  };

  if (!gap.missing.length) {
    return { ...base, missingSkills: [], weeklyPlan: [], _source: 'local' };
  }

  const offline = heuristicPlan(gap.missing, hoursPerWeek);
  if (!apiKey.trim()) {
    return { ...base, ...offline, _source: 'heuristic' };
  }

  try {
    const ai = await callGeminiJson({
      apiKey,
      prompt: buildPrompt(parsedJob, gap, userSkills, hoursPerWeek),
      schema: PLAN_SCHEMA,
    });

    // Never trust the model blindly: keep only skills we computed as missing,
    // and clamp hours to the learner's budget.
    const missingSkills = (ai.missingSkills || [])
      .filter((m) => gap.missing.some((g) => skillMatches(g, m.skill)))
      .map((m) => ({
        skill: String(m.skill),
        priority: ['high', 'medium', 'low'].includes(m.priority) ? m.priority : 'medium',
        reason: String(m.reason || ''),
      }));

    const weeklyPlan = (ai.weeklyPlan || []).slice(0, 4).map((w, i) => ({
      week: i + 1,
      focus: String(w.focus || ''),
      hours: Math.min(hoursPerWeek, Math.max(1, Number(w.hours) || hoursPerWeek)),
      tasks: (w.tasks || []).map(String).filter(Boolean).slice(0, 4),
    }));

    if (!missingSkills.length || !weeklyPlan.length) throw new Error('Model returned an empty plan');
    return { ...base, missingSkills, weeklyPlan, _source: 'gemini' };
  } catch (err) {
    return { ...base, ...offline, _source: 'heuristic-fallback', _error: err?.message };
  }
}
