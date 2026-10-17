import assert from 'node:assert/strict';
import {
  analyzeRejectionEmail,
  recurringRejectionGaps,
} from '../services/rejectionRecovery.js';

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
                    isRejection: true,
                    confidencePercent: 96,
                    company: 'Example Corp',
                    role: 'Backend Engineer',
                    reflection:
                      'The employer closed this application without providing detailed feedback.',
                    skillGaps: [],
                    nextStep: 'Record the outcome, then close the email.',
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

const result = await analyzeRejectionEmail(
  {
    subject: 'Application update',
    sender: 'recruiting@example.com',
    body: 'We will not be moving forward with your application.',
  },
  [{ name: 'Python', level: 'Advanced', evidence: 'Built data services.' }],
  { apiKey: 'test-key' }
);

assert.equal(result.isRejection, true);
assert.equal(result.company, 'Example Corp');
assert.deepEqual(result.skillGaps, []);
assert.match(requestBody.contents[0].parts[0].text, /Python/);
assert.match(requestBody.contents[0].parts[0].text, /Never infer a deficiency/);

await assert.rejects(
  () => analyzeRejectionEmail({ body: 'No' }, [], { apiKey: '' }),
  /Gemini API key/
);

const recurring = recurringRejectionGaps([
  { skillGaps: [{ name: 'System Design' }, { name: 'System Design' }] },
  { skillGaps: [{ name: 'system-design' }, { name: 'SQL' }] },
  { skillGaps: [{ name: 'SQL' }] },
]);
assert.deepEqual(recurring, [
  { name: 'SQL', count: 2 },
  { name: 'System Design', count: 2 },
]);

console.log('rejection recovery service tests passed');
