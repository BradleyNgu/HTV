import assert from 'node:assert/strict';

const storage = {
  apiKey: 'test-key',
  skillProfile: [{ name: 'JavaScript', level: 'Advanced' }],
  rejectionHistory: [],
};
let messageListener;

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      },
    },
  },
  storage: {
    local: {
      async get(key) {
        if (key == null) return { ...storage };
        if (typeof key === 'string') return { [key]: storage[key] };
        return { ...storage };
      },
      async set(values) {
        Object.assign(storage, values);
      },
    },
    onChanged: { addListener() {} },
  },
  action: {
    async setBadgeText() {},
    async setBadgeBackgroundColor() {},
  },
  sidePanel: { async setPanelBehavior() {} },
};

globalThis.fetch = async () => ({
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
                  confidencePercent: 99,
                  company: 'Example Corp',
                  role: 'Software Engineer',
                  reflection: 'The company decided not to advance this application.',
                  skillGaps: [{ name: 'System Design', reason: 'Explicit interview feedback.' }],
                  nextStep: 'Write down the system-design question you found difficult.',
                }),
              },
            ],
          },
        },
      ],
    };
  },
});
globalThis.setInterval = () => 0;

await import('../background.js');
assert.equal(typeof messageListener, 'function');

function send(message) {
  return new Promise((resolve) => {
    messageListener(message, {}, resolve);
  });
}

const email = {
  subject: 'Application update',
  sender: 'recruiting@example.com',
  body: 'We will not move forward. Your system design interview needed more depth.',
  sourceKey: '/mail/u/0/#inbox/thread-1',
};
const first = await send({ type: 'ANALYZE_REJECTION', email });
assert.equal(first.ok, true);
assert.equal(storage.rejectionHistory.length, 1);

const duplicate = await send({ type: 'ANALYZE_REJECTION', email });
assert.equal(duplicate.duplicate, true);
assert.equal(storage.rejectionHistory.length, 1);

const listed = await send({ type: 'GET_REJECTIONS' });
assert.equal(listed.history.length, 1);

const removed = await send({ type: 'REMOVE_REJECTION', id: first.record.id });
assert.equal(removed.ok, true);
assert.equal(storage.rejectionHistory.length, 0);

console.log('background rejection storage tests passed');
