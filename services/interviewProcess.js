/**
 * Estimates whether a software-role interview is likely to include
 * LeetCode-style coding and recommends role-relevant, verified problem URLs.
 * Company processes change, so every result is presented as an estimate.
 */

import { callGeminiJson } from './gemini.js';

const PROBLEMS = [
  { id: 'two-sum', title: 'Two Sum', topic: 'Arrays & hash maps' },
  { id: 'valid-parentheses', title: 'Valid Parentheses', topic: 'Stacks' },
  { id: 'group-anagrams', title: 'Group Anagrams', topic: 'Hash maps & strings' },
  {
    id: 'longest-substring-without-repeating-characters',
    title: 'Longest Substring Without Repeating Characters',
    topic: 'Sliding window',
  },
  { id: 'product-of-array-except-self', title: 'Product of Array Except Self', topic: 'Arrays' },
  { id: 'merge-intervals', title: 'Merge Intervals', topic: 'Intervals & sorting' },
  { id: 'top-k-frequent-elements', title: 'Top K Frequent Elements', topic: 'Heaps & hash maps' },
  { id: 'number-of-islands', title: 'Number of Islands', topic: 'Graphs' },
  { id: 'course-schedule', title: 'Course Schedule', topic: 'Graphs & topological sort' },
  {
    id: 'binary-tree-level-order-traversal',
    title: 'Binary Tree Level Order Traversal',
    topic: 'Trees & breadth-first search',
  },
  { id: 'lowest-common-ancestor-of-a-binary-tree', title: 'Lowest Common Ancestor of a Binary Tree', topic: 'Trees' },
  { id: 'lru-cache', title: 'LRU Cache', topic: 'Data structures & design' },
  { id: 'kth-largest-element-in-an-array', title: 'Kth Largest Element in an Array', topic: 'Heaps & selection' },
  { id: 'clone-graph', title: 'Clone Graph', topic: 'Graphs' },
  { id: 'second-highest-salary', title: 'Second Highest Salary', topic: 'SQL' },
  { id: 'rank-scores', title: 'Rank Scores', topic: 'SQL window functions' },
  { id: 'department-top-three-salaries', title: 'Department Top Three Salaries', topic: 'Advanced SQL' },
];

const PROBLEM_BY_ID = new Map(PROBLEMS.map((problem) => [problem.id, problem]));

const PROCESS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    leetcodeLikelihoodPercent: { type: 'INTEGER' },
    rationale: { type: 'STRING' },
    processNotes: { type: 'STRING' },
    recommendedProblemIds: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['leetcodeLikelihoodPercent', 'rationale', 'processNotes', 'recommendedProblemIds'],
};

function contextText(job, parsedJob) {
  return [
    job?.title,
    job?.company,
    job?.description,
    ...(parsedJob?.requiredTechStack || []),
    ...(parsedJob?.domainConstraints || []),
    ...(parsedJob?.keyResponsibilities || []),
  ]
    .join(' ')
    .toLowerCase();
}

function offlineEstimate(job, parsedJob) {
  const text = contextText(job, parsedJob);
  let likelihood = 45;

  if (/\b(software|backend|full.?stack|platform|infrastructure|distributed|algorithm)\b/.test(text)) likelihood += 25;
  if (/\b(data scientist|machine learning|ml engineer|data science)\b/.test(text)) likelihood += 12;
  if (/\b(front.?end|mobile|ios|android|qa|quality assurance|data analyst|designer)\b/.test(text)) likelihood -= 12;
  if (/\b(google|meta|amazon|microsoft|apple|uber|coinbase|shopify|netflix)\b/.test(text)) likelihood += 12;
  if (/\b(senior|staff|principal|lead)\b/.test(text)) likelihood += 5;
  likelihood = Math.max(10, Math.min(90, likelihood));

  const ids = [];
  if (/\b(sql|mysql|postgres|database|data scientist|data analyst)\b/.test(text)) {
    ids.push('rank-scores', 'department-top-three-salaries');
  }
  if (/\b(distributed|backend|platform|concurr|systems?|cache)\b/.test(text)) {
    ids.push('lru-cache', 'course-schedule');
  }
  if (/\b(data science|machine learning|ranking|recommendation|analytics)\b/.test(text)) {
    ids.push('top-k-frequent-elements', 'merge-intervals');
  }
  ids.push('two-sum', 'longest-substring-without-repeating-characters', 'number-of-islands');

  const selected = [...new Set(ids)].slice(0, 5);
  const company = job?.company || 'this company';
  const role = job?.title || 'this role';
  return {
    leetcodeLikelihoodPercent: likelihood,
    rationale: `${role} interviews at ${company} may include timed data-structure or algorithm questions. This estimate is based on the role, seniority, technical stack, and typical software interview patterns—not a confirmed company interview plan.`,
    processNotes:
      'Prepare for a practical technical screen as well: code discussion, debugging, system or domain design, and questions about past projects may matter as much as algorithms.',
    recommendedProblemIds: selected,
  };
}

function cleanResult(result, fallback) {
  const likelihood = Number(result?.leetcodeLikelihoodPercent);
  const ids = [...new Set(result?.recommendedProblemIds || [])]
    .filter((id) => PROBLEM_BY_ID.has(id))
    .slice(0, 5);

  return {
    leetcodeLikelihoodPercent: Number.isFinite(likelihood)
      ? Math.max(0, Math.min(100, Math.round(likelihood)))
      : fallback.leetcodeLikelihoodPercent,
    rationale: String(result?.rationale || fallback.rationale).trim(),
    processNotes: String(result?.processNotes || fallback.processNotes).trim(),
    problems: (ids.length ? ids : fallback.recommendedProblemIds).map((id) => {
      const problem = PROBLEM_BY_ID.get(id);
      return {
        ...problem,
        url: `https://leetcode.com/problems/${problem.id}/`,
      };
    }),
  };
}

/**
 * @param {object} job scraped job with title/company/description
 * @param {object} parsedJob parsed role signals
 * @param {{ apiKey?: string }} opts
 */
export async function analyzeInterviewProcess(job, parsedJob, { apiKey = '' } = {}) {
  const fallback = offlineEstimate(job, parsedJob);
  if (!apiKey.trim()) return { ...cleanResult(fallback, fallback), _source: 'heuristic' };

  const catalog = PROBLEMS.map((problem) => `${problem.id}: ${problem.title} (${problem.topic})`).join('\n');
  const prompt = `Estimate the interview process for this specific software-related job. Return ONLY JSON matching the schema.

Job
- Title: ${job?.title || 'unknown'}
- Company: ${job?.company || 'unknown'}
- Description: ${String(job?.description || '').slice(0, 5000)}
- Seniority: ${parsedJob?.seniorityLevel || 'unknown'}
- Tech: ${(parsedJob?.requiredTechStack || []).join(', ')}
- Domain: ${(parsedJob?.domainConstraints || []).join(', ')}
- Responsibilities: ${(parsedJob?.keyResponsibilities || []).slice(0, 5).join(' | ')}

Estimate the percentage likelihood that the interview includes LeetCode-style algorithms or data-structure coding. Do not claim access to private or current company question banks. Explain the role/company reasoning in 2 concise sentences and mention other likely technical stages in 1 concise sentence.

Choose 3 to 5 problem IDs from ONLY this verified catalog. Select questions most relevant to this role and the company's likely engineering interview emphasis:
${catalog}`;

  try {
    const ai = await callGeminiJson({
      apiKey,
      prompt,
      schema: PROCESS_SCHEMA,
      temperature: 0.2,
    });
    return { ...cleanResult(ai, fallback), _source: 'gemini' };
  } catch (err) {
    return {
      ...cleanResult(fallback, fallback),
      _source: 'heuristic-fallback',
      _error: err?.message || 'AI estimate unavailable',
    };
  }
}
