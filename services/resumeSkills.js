/**
 * Resume PDF → skills list. Text is extracted locally with pdf.js; skills are
 * pulled out by Gemini when a key is set, otherwise by a keyword catalog.
 */

import * as pdfjs from '../lib/pdfjs/pdf.min.mjs';
import { callGeminiJson } from './gemini.js';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const SKILLS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    skills: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['skills'],
};

// [display name, ...aliases]. Aliases are matched case-insensitively on word boundaries.
const SKILL_CATALOG = [
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
  ['React', 'react', 'react.js', 'reactjs'],
  ['React Native', 'react native'],
  ['Next.js', 'next.js', 'nextjs'],
  ['Vue', 'vue', 'vue.js', 'vuejs'],
  ['Angular', 'angular'],
  ['Svelte', 'svelte'],
  ['Redux', 'redux'],
  ['Tailwind CSS', 'tailwind', 'tailwindcss'],
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
  ['Git', 'git'],
  ['Linux', 'linux'],
  ['Firebase', 'firebase'],
  ['TensorFlow', 'tensorflow'],
  ['PyTorch', 'pytorch'],
  ['scikit-learn', 'scikit-learn', 'sklearn'],
  ['Pandas', 'pandas'],
  ['NumPy', 'numpy'],
  ['Machine Learning', 'machine learning'],
  ['Deep Learning', 'deep learning'],
  ['NLP', 'nlp', 'natural language processing'],
  ['Computer Vision', 'computer vision'],
  ['LLMs', 'llm', 'llms', 'large language models'],
  ['Jest', 'jest'],
  ['Cypress', 'cypress'],
  ['Playwright', 'playwright'],
  ['Selenium', 'selenium'],
  ['Figma', 'figma'],
  ['Microservices', 'microservices'],
  ['Distributed Systems', 'distributed systems'],
  ['Agile', 'agile', 'scrum'],
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// These also appear as initials or plain English words, so they only count
// when they sit inside a comma/pipe/bullet-separated skills list.
const AMBIGUOUS = new Set(['c', 'r', 'go', 'rest']);

function catalogMatch(text) {
  const found = [];
  for (const [name, ...aliases] of SKILL_CATALOG) {
    const hit = aliases.some((alias) => {
      const core = escapeRegex(alias);
      if (AMBIGUOUS.has(alias)) {
        return new RegExp(`(?:^|[,|/•·:]\\s*)${core}(?=\\s*(?:[,|/•·]|$))`, 'im').test(text);
      }
      return new RegExp(`(?<![\\w.+#])${core}(?![\\w+#])`, 'i').test(text);
    });
    if (hit) found.push(name);
  }
  return found;
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

async function skillsWithGemini(text, apiKey) {
  const { skills } = await callGeminiJson({
    apiKey,
    temperature: 0.1,
    schema: SKILLS_SCHEMA,
    prompt: `Extract the candidate's technical skills from this resume: programming languages,
frameworks, libraries, databases, cloud platforms, tools, and technical practices.
Use canonical short names (e.g. "React", "PostgreSQL", "AWS"). No soft skills, no job titles,
no company names. Deduplicate. At most 40 items.

Resume:
${text.slice(0, 15000)}`,
  });
  return Array.isArray(skills) ? skills : [];
}

/**
 * @param {File} file resume PDF
 * @param {{ apiKey?: string }} opts
 * @returns {Promise<{ skills: string[], source: 'gemini' | 'catalog' | 'catalog-fallback', error?: string }>}
 */
export async function extractSkillsFromPdf(file, { apiKey = '' } = {}) {
  const text = await extractPdfText(file);
  if (!text) {
    throw new Error('No selectable text found in that PDF (it may be a scanned image).');
  }

  const key = apiKey.trim();
  if (key) {
    try {
      return { skills: await skillsWithGemini(text, key), source: 'gemini' };
    } catch (err) {
      return { skills: catalogMatch(text), source: 'catalog-fallback', error: err?.message };
    }
  }
  return { skills: catalogMatch(text), source: 'catalog' };
}
