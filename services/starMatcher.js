/**
 * Semantic-ish STAR story alignment against the local project bank.
 * Returns top 2 matches as structured Situation / Task / Action / Result cards.
 */

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
