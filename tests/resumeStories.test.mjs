import assert from 'node:assert/strict';
import {
  storiesFromResumeText,
  cleanResumeStories,
  extractResumeStories,
} from '../services/resumeStories.js';
import { matchStarStories } from '../services/starMatcher.js';

const resume = `
Jane Doe
Software Engineer

EXPERIENCE
Software Engineer Intern | Acme Corp | 2024
- Built a Python data pipeline with Kafka, resulting in 20 second dashboard latency.
- Developed React dashboards for operations.

SKILLS
Python, React, Kafka, SQL, Go, AWS

EDUCATION
B.S. Computer Science
`;

const stories = storiesFromResumeText(resume);
assert.equal(stories.length, 2);
assert.equal(stories[0].title.includes('Acme'), true);
assert.match(stories[0].action, /Python data pipeline/i);
assert.match(stories[0].result, /20 second/i);
assert.match(stories[1].result, /Delivered React dashboards/i);
assert.ok(!/outcome not stated/i.test(stories[1].result));
assert.ok(stories[0].tags.includes('Python'));
assert.ok(stories.every((story) => !/python, react, kafka/i.test(story.action)));

const cleaned = cleanResumeStories([
  { title: 'Acme', action: 'Built a Python pipeline.', tags: ['Python', 'Python'] },
  { title: 'Acme', action: 'Built a Python pipeline.' },
  { title: '', action: 'Ignored' },
]);
assert.equal(cleaned.length, 1);
assert.deepEqual(cleaned[0].tags, ['Python']);
assert.match(cleaned[0].result, /Shipped a Python pipeline/i);

assert.deepEqual(matchStarStories({ requiredTechStack: ['Python'] }, []), []);

const matches = matchStarStories(
  {
    requiredTechStack: ['Python', 'React'],
    domainConstraints: ['Legal authorization to work in the U.S.'],
  },
  stories,
  2
);
assert.ok(matches.length);
assert.ok(matches.every((match) => !/Telemetry Data Processing Pipeline/.test(match.title)));
assert.ok(matches.every((match) => !match.matchedSignals.includes('Legal authorization to work in the U.S.')));
assert.ok(matches.some((match) => match.matchedSignals.includes('Python')));

let requestBody;
globalThis.fetch = async (_url, init) => {
  requestBody = JSON.parse(init.body);
  return {
    ok: true,
    async json() {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    stories: [
                      {
                        title: 'Acme intern',
                        tags: ['Python'],
                        situation: 'Acme needed faster analytics.',
                        task: 'Build a pipeline.',
                        action: 'Built a Python Kafka pipeline.',
                        result: 'Latency dropped to 20 seconds.',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      };
    },
  };
};

const gemini = await extractResumeStories(resume, { apiKey: 'test-key' });
assert.equal(gemini.source, 'gemini');
assert.equal(gemini.stories[0].title, 'Acme intern');
assert.match(requestBody.contents[0].parts[0].text, /BEGIN_UNTRUSTED_RESUME/);
assert.match(requestBody.contents[0].parts[0].text, /Do not invent metrics/);
assert.doesNotMatch(requestBody.contents[0].parts[0].text, /Outcome not stated/);

console.log('resume STAR story tests passed');
