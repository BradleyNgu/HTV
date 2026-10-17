/**
 * STAR story alignment against the local project bank.
 *
 * - matchStarStories: fast offline keyword overlap (also the fallback).
 * - matchStarStoriesSemantic: Gemini embeddings + cosine similarity, with
 *   story vectors cached in chrome.storage.local so each story is embedded once.
 *
 * Returns matches as structured Situation / Task / Action / Result cards.
 */

import { embedTexts } from './gemini.js';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function unique(arr) {
  return [...new Set(arr)];
}

function scoreProject(project, signals) {
  const haystack = unique([
    ...tokenize(project.title),
    ...tokenize((project.tags || []).join(' ')),
    ...tokenize(project.situation),
    ...tokenize(project.task),
    ...tokenize(project.action),
    ...tokenize(project.result),
  ]);

  const hay = new Set(haystack);
  let hits = 0;
  const matched = [];

  for (const signal of signals) {
    const parts = tokenize(signal);
    const matchedPart = parts.some((p) => hay.has(p) || [...hay].some((h) => h.includes(p) || p.includes(h)));
    if (matchedPart) {
      hits += 1;
      matched.push(signal);
    }
  }

  // Soft boost for overlapping tag strings
  for (const tag of project.tags || []) {
    const t = tag.toLowerCase();
    if (signals.some((s) => s.toLowerCase().includes(t) || t.includes(s.toLowerCase()))) {
      hits += 0.5;
    }
  }

  return { score: hits, matchedSignals: unique(matched) };
}

/**
 * @param {object} parsedJob
 * @param {Array} projectBank
 * @param {number} limit
 */
export function matchStarStories(parsedJob, projectBank = [], limit = 2) {
  const signals = unique([
    ...(parsedJob?.requiredTechStack || []),
    ...(parsedJob?.domainConstraints || []),
    ...(parsedJob?.keyResponsibilities || []).flatMap((r) => tokenize(r).slice(0, 4)),
  ]);

  if (!projectBank.length) return [];

  const ranked = projectBank
    .map((project) => {
      const { score, matchedSignals } = scoreProject(project, signals);
      return {
        id: project.id,
        title: project.title,
        matchedSignals,
        score,
        situation: project.situation,
        task: project.task,
        action: project.action,
        result: project.result,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked.filter((r) => r.score > 0).slice(0, limit);
  if (top.length >= limit) return top;

  // Ensure we always surface up to `limit` stories for interview prep
  for (const r of ranked) {
    if (top.length >= limit) break;
    if (!top.find((t) => t.id === r.id)) top.push(r);
  }
  return top;
}

// ---------------------------------------------------------------------------
// Semantic matching
// ---------------------------------------------------------------------------

const EMBEDDING_CACHE_KEY = 'embeddingCache';

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function storyText(p) {
  return [p.title, (p.tags || []).join(', '), p.situation, p.task, p.action, p.result]
    .filter(Boolean)
    .join('. ');
}

function jobText(parsedJob, job) {
  return [
    job?.title,
    `Seniority: ${parsedJob?.seniorityLevel || ''}`,
    `Tech: ${(parsedJob?.requiredTechStack || []).join(', ')}`,
    `Domain: ${(parsedJob?.domainConstraints || []).join(', ')}`,
    `Responsibilities: ${(parsedJob?.keyResponsibilities || []).join('. ')}`,
  ]
    .filter(Boolean)
    .join('. ');
}

export function cosineSimilarity(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Rank stories by embedding similarity to the job. Falls back to keyword
 * matching (and reports why) if there is no key or the API call fails.
 *
 * @returns {Promise<{ matches: Array, method: 'semantic'|'keyword', error?: string }>}
 */
export async function matchStarStoriesSemantic(
  parsedJob,
  projectBank = [],
  { apiKey = '', limit = 2, job = null } = {}
) {
  // Keyword pass gives every story a matchedSignals list for the UI badges.
  const keywordRanked = matchStarStories(parsedJob, projectBank, projectBank.length);
  const keywordResult = { matches: keywordRanked.slice(0, limit), method: 'keyword' };

  if (!apiKey.trim() || !projectBank.length) return keywordResult;

  try {
    const stored = await chrome.storage.local.get(EMBEDDING_CACHE_KEY);
    const cache = stored[EMBEDDING_CACHE_KEY] || {};

    const texts = {};
    const stale = [];
    for (const p of projectBank) {
      const text = storyText(p);
      const hash = hashText(text);
      texts[p.id] = { text, hash };
      if (!cache[p.id] || cache[p.id].hash !== hash) stale.push(p.id);
    }

    // One request: any un-cached stories + the job.
    const batch = [...stale.map((id) => texts[id].text), jobText(parsedJob, job)];
    const vectors = await embedTexts({ apiKey, texts: batch });
    stale.forEach((id, i) => {
      cache[id] = { hash: texts[id].hash, values: vectors[i] };
    });
    const jobVector = vectors[vectors.length - 1];
    if (stale.length) await chrome.storage.local.set({ [EMBEDDING_CACHE_KEY]: cache });

    const ranked = keywordRanked
      .map((m) => ({ ...m, similarity: cosineSimilarity(jobVector, cache[m.id]?.values) }))
      .sort((a, b) => b.similarity - a.similarity);

    return { matches: ranked.slice(0, limit), method: 'semantic' };
  } catch (err) {
    return { ...keywordResult, error: err?.message || 'Semantic matching failed' };
  }
}
