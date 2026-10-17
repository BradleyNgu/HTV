/**
 * Interview prep: turns the parsed job + matched STAR stories into practice
 * prompts, each tied to a story you already have. Structured output only, no chat.
 */

import { callGeminiJson } from './gemini.js';

const QUESTIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          starStoryId: { type: 'STRING' },
          openingLine: { type: 'STRING' },
          tip: { type: 'STRING' },
        },
        required: ['question', 'starStoryId', 'openingLine', 'tip'],
      },
    },
  },
  required: ['questions'],
};

function shorten(text, max = 110) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function firstSentence(text) {
  const m = String(text || '').match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(text || '')).trim();
}

function heuristicQuestions(parsedJob, stories) {
  const techs = (parsedJob.requiredTechStack || []).filter((t) => !/^general\b/i.test(t));
  const domains = (parsedJob.domainConstraints || []).filter((d) => !/^general\b/i.test(d));
  const resp = parsedJob.keyResponsibilities || [];

  const items = [];
  if (techs[0]) {
    items.push({
      question: `Tell me about a time you used ${techs[0]} to solve a real problem.`,
      tip: 'Lead with the result, then walk through situation, task, action.',
    });
  }
  if (domains[0]) {
    items.push({
      question: `How have you handled ${domains[0]} requirements in something you built?`,
      tip: 'Name the constraint, the trade-off you chose, and how you measured success.',
    });
  }
  if (resp[0]) {
    items.push({
      question: `This role involves: "${shorten(resp[0])}" Walk me through a time you did something similar.`,
      tip: 'Pick the story whose action mirrors the responsibility, not the flashiest one.',
    });
  }
  items.push({
    question: 'Tell me about a time you had to learn something quickly under pressure.',
    tip: 'Be honest about what you did not know. Growth is the point of the answer.',
  });
  items.push({
    question: 'Describe a time you pushed back on scope or a deadline to protect quality.',
    tip: 'Show that you can set limits calmly. That signals sustainable performance.',
  });

  return items.slice(0, 5).map((item, i) => {
    const story = stories[i % Math.max(stories.length, 1)];
    return {
      ...item,
      starStoryId: story?.id || '',
      openingLine: story
        ? `"${firstSentence(story.situation)}"`
        : 'Start with the situation in one sentence.',
    };
  });
}

/**
 * @param {object} parsedJob
 * @param {Array} stories matched STAR stories (need id/title/situation/...)
 * @param {{ apiKey?: string }} opts
 */
export async function generatePracticePrompts(parsedJob, stories, { apiKey = '' } = {}) {
  const offline = () => heuristicQuestions(parsedJob, stories);
  if (!apiKey.trim() || !stories.length) {
    return { questions: offline(), _source: 'heuristic' };
  }

  const storyList = stories
    .map((s) => `- id=${s.id} | ${s.title}: ${shorten(s.situation, 140)} Result: ${shorten(s.result, 100)}`)
    .join('\n');

  const prompt = `You write interview PRACTICE prompts for a nervous candidate. Return ONLY JSON matching the schema.

Role signals
- Tech: ${(parsedJob.requiredTechStack || []).join(', ')}
- Domain: ${(parsedJob.domainConstraints || []).join(', ')}
- Seniority: ${parsedJob.seniorityLevel || 'unknown'}
- Responsibilities: ${(parsedJob.keyResponsibilities || []).slice(0, 4).join(' | ')}

The candidate's STAR stories (use ONLY these ids for starStoryId):
${storyList}

Write exactly 5 questions likely for THIS role (mix technical-behavioral and one about managing workload or pushback).
For each: pick the best-fitting story id, an "openingLine" (the first sentence of a strong answer, drawn from that story), and a one-sentence calm, practical "tip". No pep talk.`;

  try {
    const ai = await callGeminiJson({ apiKey, prompt, schema: QUESTIONS_SCHEMA, temperature: 0.4 });
    const ids = new Set(stories.map((s) => s.id));
    const questions = (ai.questions || [])
      .slice(0, 5)
      .map((q) => ({
        question: String(q.question || '').trim(),
        starStoryId: ids.has(q.starStoryId) ? q.starStoryId : stories[0].id,
        openingLine: String(q.openingLine || '').trim(),
        tip: String(q.tip || '').trim(),
      }))
      .filter((q) => q.question);
    if (!questions.length) throw new Error('Model returned no questions');
    return { questions, _source: 'gemini' };
  } catch (err) {
    return { questions: offline(), _source: 'heuristic-fallback', _error: err?.message };
  }
}
