/**
 * Structured JSON job parser — no conversational chat UI.
 * Uses Gemini with schema-enforced JSON responses.
 */

import { callGeminiJson } from './gemini.js';

const PARSED_JOB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    requiredTechStack: { type: 'ARRAY', items: { type: 'STRING' } },
    domainConstraints: { type: 'ARRAY', items: { type: 'STRING' } },
    seniorityLevel: { type: 'STRING' },
    keyResponsibilities: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['requiredTechStack', 'domainConstraints', 'seniorityLevel', 'keyResponsibilities'],
};

const SYSTEM_PROMPT = `You extract structured hiring signals from LinkedIn job descriptions for software engineers.
Return ONLY valid JSON matching the schema. No prose, no markdown fences.
Be precise: prefer explicit requirements over guesses. Keep lists short and specific.`;

function buildUserPrompt(job) {
  return `Job title: ${job.title || 'Unknown'}
Company: ${job.company || 'Unknown'}
URL: ${job.url || ''}

Job description:
${(job.description || '').slice(0, 12000)}`;
}

function heuristicParse(job) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const techCatalog = [
    'javascript',
    'typescript',
    'python',
    'java',
    'go',
    'rust',
    'react',
    'node',
    'nodejs',
    'aws',
    'gcp',
    'azure',
    'kubernetes',
    'docker',
    'kafka',
    'spark',
    'redis',
    'postgres',
    'sql',
    'graphql',
    'next.js',
    'vue',
    'angular',
  ];
  const domainCatalog = [
    'low-latency',
    'real-time',
    'microservices',
    'distributed systems',
    'data pipeline',
    'machine learning',
    'security',
    'scalability',
    'observability',
  ];

  const requiredTechStack = techCatalog.filter((t) => text.includes(t.replace('.', '')));
  const domainConstraints = domainCatalog.filter((d) => text.includes(d));

  let seniorityLevel = 'Mid';
  if (/\b(staff|principal|distinguished)\b/.test(text)) seniorityLevel = 'Staff+';
  else if (/\b(senior|sr\.?)\b/.test(text)) seniorityLevel = 'Senior';
  else if (/\b(junior|jr\.?|entry[- ]level|new grad)\b/.test(text)) seniorityLevel = 'Junior';

  const sentences = (job.description || '')
    .split(/[\n•●▪‣]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 220)
    .slice(0, 5);

  return {
    requiredTechStack: requiredTechStack.length ? requiredTechStack : ['general software engineering'],
    domainConstraints: domainConstraints.length ? domainConstraints : ['general product engineering'],
    seniorityLevel,
    keyResponsibilities: sentences.length
      ? sentences
      : ['Contribute to product features', 'Collaborate with cross-functional partners'],
    _source: 'heuristic',
  };
}

async function parseWithGemini(job, apiKey) {
  const parsed = await callGeminiJson({
    apiKey,
    prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(job)}`,
    schema: PARSED_JOB_SCHEMA,
    temperature: 0.1,
  });
  return { ...parsed, _source: 'gemini' };
}

/**
 * @param {object} job scraped job
 * @param {{ apiKey?: string }} settings
 * @returns {Promise<object>} ParsedJob
 */
export async function parseJob(job, settings = {}) {
  const key = (settings.apiKey || '').trim();

  if (!job?.description) {
    throw new Error('No job description available to parse.');
  }

  if (!key) {
    return heuristicParse(job);
  }

  try {
    return await parseWithGemini(job, key);
  } catch (err) {
    const fallback = heuristicParse(job);
    fallback._error = err?.message || 'API parse failed';
    fallback._source = 'heuristic-fallback';
    return fallback;
  }
}
