/**
 * Structured JSON job parser — no conversational chat UI.
 * Uses OpenAI or Gemini with schema-enforced JSON responses.
 */

// Model IDs are retired periodically — update here if an API returns a 404.
const GEMINI_MODEL = 'gemini-3.8-flash';
const OPENAI_MODEL = 'gpt-4o-mini';

export const PARSED_JOB_SCHEMA = {
  type: 'object',
  properties: {
    requiredTechStack: {
      type: 'array',
      items: { type: 'string' },
      description: 'Technologies, languages, frameworks explicitly required',
    },
    domainConstraints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Domain constraints e.g. low-latency, real-time streams, microservices',
    },
    seniorityLevel: {
      type: 'string',
      description: 'Inferred seniority e.g. Junior, Mid, Senior, Staff',
    },
    keyResponsibilities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Top 4–6 concrete responsibilities',
    },
  },
  required: ['requiredTechStack', 'domainConstraints', 'seniorityLevel', 'keyResponsibilities'],
  additionalProperties: false,
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

async function parseWithOpenAI(job, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'parsed_job',
          strict: true,
          schema: PARSED_JOB_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(job) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty OpenAI response');
  return { ...JSON.parse(raw), _source: 'openai' };
}

async function parseWithGemini(job, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(job)}` }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            requiredTechStack: { type: 'ARRAY', items: { type: 'STRING' } },
            domainConstraints: { type: 'ARRAY', items: { type: 'STRING' } },
            seniorityLevel: { type: 'STRING' },
            keyResponsibilities: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: [
            'requiredTechStack',
            'domainConstraints',
            'seniorityLevel',
            'keyResponsibilities',
          ],
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty Gemini response');
  return { ...JSON.parse(raw), _source: 'gemini' };
}

/**
 * @param {object} job scraped job
 * @param {{ apiKey?: string, apiProvider?: string }} settings
 * @returns {Promise<object>} ParsedJob
 */
export async function parseJob(job, settings = {}) {
  const key = (settings.apiKey || '').trim();
  const provider = settings.apiProvider || 'openai';

  if (!job?.description) {
    throw new Error('No job description available to parse.');
  }

  if (!key) {
    return heuristicParse(job);
  }

  try {
    if (provider === 'gemini') return await parseWithGemini(job, key);
    return await parseWithOpenAI(job, key);
  } catch (err) {
    const fallback = heuristicParse(job);
    fallback._error = err?.message || 'API parse failed';
    fallback._source = 'heuristic-fallback';
    return fallback;
  }
}
