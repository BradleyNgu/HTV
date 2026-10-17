/**
 * Resume PDF → skill profile. Text is extracted locally with pdf.js. With a
 * Gemini key, the model describes each skill (level, years, how it was used);
 * otherwise a keyword catalog finds skills and quotes where the resume mentions them.
 */

import * as pdfjs from '../lib/pdfjs/pdf.min.mjs';
import { callGeminiJson } from './gemini.js';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export const SKILL_CATEGORIES = [
  'Languages',
  'Frontend',
  'Backend',
  'Data & Databases',
  'Cloud & DevOps',
  'AI & ML',
  'Testing',
  'Tools & Practices',
  'Other',
];

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

const PROFILE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    skills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING', enum: SKILL_CATEGORIES },
          level: { type: 'STRING', enum: LEVELS },
          years: { type: 'NUMBER', nullable: true },
          evidence: { type: 'STRING' },
        },
        required: ['name', 'category', 'level', 'evidence'],
      },
    },
  },
  required: ['skills'],
};

// category → [display name, ...aliases]. Aliases match case-insensitively on word boundaries.
const SKILL_CATALOG = {
  Languages: [
    ['JavaScript', 'javascript', 'js', 'es6'],
    ['TypeScript', 'typescript'],
    ['Python', 'python'],
    ['Java', 'java'],
    ['Go', 'go', 'golang'],
    ['Rust', 'rust'],
    ['C', 'c'],
    ['C++', 'c++', 'cpp'],
    ['C#', 'c#', 'csharp'],
    ['Kotlin', 'kotlin'],
    ['Swift', 'swift'],
    ['Ruby', 'ruby'],
    ['PHP', 'php'],
    ['Scala', 'scala'],
    ['R', 'r'],
    ['SQL', 'sql'],
    ['Bash', 'bash', 'shell scripting'],
    ['HTML', 'html', 'html5'],
    ['CSS', 'css', 'css3'],
  ],
  Frontend: [
    ['React', 'react', 'react.js', 'reactjs'],
    ['React Native', 'react native'],
    ['Next.js', 'next.js', 'nextjs'],
    ['Vue', 'vue', 'vue.js', 'vuejs'],
    ['Angular', 'angular'],
    ['Svelte', 'svelte'],
    ['Redux', 'redux'],
    ['Tailwind CSS', 'tailwind', 'tailwindcss'],
    ['Figma', 'figma'],
  ],
  Backend: [
    ['Node.js', 'node', 'node.js', 'nodejs'],
    ['Express', 'express', 'express.js'],
    ['Django', 'django'],
    ['Flask', 'flask'],
    ['FastAPI', 'fastapi'],
    ['Spring', 'spring', 'spring boot'],
    ['Rails', 'rails', 'ruby on rails'],
    ['.NET', '.net', 'dotnet', 'asp.net'],
    ['GraphQL', 'graphql'],
    ['REST APIs', 'rest', 'restful', 'rest api', 'rest apis'],
    ['gRPC', 'grpc'],
    ['Microservices', 'microservices'],
    ['Distributed Systems', 'distributed systems'],
  ],
  'Data & Databases': [
    ['PostgreSQL', 'postgres', 'postgresql'],
    ['MySQL', 'mysql'],
    ['MongoDB', 'mongodb', 'mongo'],
    ['Redis', 'redis'],
    ['SQLite', 'sqlite'],
    ['DynamoDB', 'dynamodb'],
    ['Elasticsearch', 'elasticsearch'],
    ['Kafka', 'kafka'],
    ['RabbitMQ', 'rabbitmq'],
    ['Spark', 'spark', 'pyspark'],
    ['Hadoop', 'hadoop'],
    ['Airflow', 'airflow'],
    ['Snowflake', 'snowflake'],
    ['Pandas', 'pandas'],
    ['NumPy', 'numpy'],
  ],
  'Cloud & DevOps': [
    ['AWS', 'aws', 'amazon web services'],
    ['GCP', 'gcp', 'google cloud'],
    ['Azure', 'azure'],
    ['Docker', 'docker'],
    ['Kubernetes', 'kubernetes', 'k8s'],
    ['Terraform', 'terraform'],
    ['Ansible', 'ansible'],
    ['CI/CD', 'ci/cd', 'continuous integration'],
    ['GitHub Actions', 'github actions'],
    ['Jenkins', 'jenkins'],
    ['Linux', 'linux'],
    ['Firebase', 'firebase'],
  ],
  'AI & ML': [
    ['TensorFlow', 'tensorflow'],
    ['PyTorch', 'pytorch'],
    ['scikit-learn', 'scikit-learn', 'sklearn'],
    ['Machine Learning', 'machine learning'],
    ['Deep Learning', 'deep learning'],
    ['NLP', 'nlp', 'natural language processing'],
    ['Computer Vision', 'computer vision'],
    ['LLMs', 'llm', 'llms', 'large language models'],
  ],
  Testing: [
    ['Jest', 'jest'],
    ['Cypress', 'cypress'],
    ['Playwright', 'playwright'],
    ['Selenium', 'selenium'],
  ],
  'Tools & Practices': [
    ['Git', 'git'],
    ['Agile', 'agile', 'scrum'],
  ],
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// These also appear as initials or plain English words, so they only count
// when they sit inside a comma/pipe/bullet-separated skills list.
const AMBIGUOUS = new Set(['c', 'r', 'go', 'rest']);

function aliasRegex(alias) {
  const core = escapeRegex(alias);
  return AMBIGUOUS.has(alias)
    ? new RegExp(`(?:^|[,|/•·:]\\s*)${core}(?=\\s*(?:[,|/•·]|$))`, 'i')
    : new RegExp(`(?<![\\w.+#])${core}(?![\\w+#])`, 'i');
}

/** Bare skill lists ("Python, Go, SQL") are useful for detection but useless as evidence. */
function isListLine(line) {
  const parts = line.split(/[,|•·]/);
  return parts.length >= 4 && line.split(/\s+/).length / parts.length < 2.5;
}

function clip(s, max = 180) {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function describeFromLines(hits) {
  const prose = hits.filter((l) => !isListLine(l) && l.split(/\s+/).length >= 5);
  if (prose.length) {
    const more = prose.length > 1 ? ` (+${prose.length - 1} more mention${prose.length > 2 ? 's' : ''})` : '';
    return clip(prose[0].replace(/^[^\p{L}\p{N}]+/u, '')) + more;
  }
  const heading = hits[0].match(/^([A-Za-z &/]{3,30}):/);
  return heading ? `Listed under "${heading[1].trim()}" on your resume` : 'Listed in your skills section';
}

function catalogProfile(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const profile = [];
  for (const [category, entries] of Object.entries(SKILL_CATALOG)) {
    for (const [name, ...aliases] of entries) {
      const regexes = aliases.map(aliasRegex);
      const hits = lines.filter((line) => regexes.some((re) => re.test(line)));
      if (hits.length) {
        profile.push({ name, category, level: '', years: null, evidence: describeFromLines(hits) });
      }
    }
  }
  return profile;
}

export async function extractPdfText(file) {
  if (!file) throw new Error('No file provided.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) throw new Error('Please drop a PDF file.');
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF is larger than 10 MB.');

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => `${it.str}${it.hasEOL ? '\n' : ' '}`).join(''));
    }
    return pages.join('\n').replace(/[ \t]+/g, ' ').trim();
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('That PDF is password-protected.');
    if (err?.name === 'InvalidPDFException') throw new Error('That file is not a valid PDF.');
    throw err;
  } finally {
    task.destroy();
  }
}

async function profileWithGemini(text, apiKey) {
  const { skills } = await callGeminiJson({
    apiKey,
    temperature: 0.1,
    schema: PROFILE_SCHEMA,
    prompt: `Build a technical skill profile from this resume. Include programming languages,
frameworks, libraries, databases, cloud platforms, tools, and technical practices.
No soft skills, job titles, or company names. Deduplicate. At most 40 skills, strongest first.

For each skill:
- name: canonical short name (e.g. "React", "PostgreSQL", "AWS").
- category: the best fitting category.
- level: judge from depth, scope, and recency of use on the resume. Only "Advanced"/"Expert"
  when the resume shows substantial, sustained, or leading work with it. A skill that is
  only listed with no supporting experience is "Beginner" or "Intermediate".
- years: total years of hands-on use if the dates on the resume support it, else null.
- evidence: one specific sentence (max 25 words) on what the candidate did with it, citing
  the project, role, or result from the resume. If it is only listed, say so. Never invent facts.

Resume:
${text.slice(0, 15000)}`,
  });
  return Array.isArray(skills) ? skills : [];
}

/**
 * @param {File} file resume PDF
 * @param {{ apiKey?: string }} opts
 * @returns {Promise<{
 *   profile: { name: string, category: string, level: string, years: number|null, evidence: string }[],
 *   source: 'gemini' | 'catalog' | 'catalog-fallback',
 *   error?: string,
 * }>}
 */
export async function extractSkillsFromPdf(file, { apiKey = '' } = {}) {
  const text = await extractPdfText(file);
  if (!text) {
    throw new Error('No selectable text found in that PDF (it may be a scanned image).');
  }

  const key = apiKey.trim();
  if (key) {
    try {
      return { profile: await profileWithGemini(text, key), source: 'gemini' };
    } catch (err) {
      return { profile: catalogProfile(text), source: 'catalog-fallback', error: err?.message };
    }
  }
  return { profile: catalogProfile(text), source: 'catalog' };
}
