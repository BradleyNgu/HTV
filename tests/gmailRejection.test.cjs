const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor({ text = '', attrs = {} } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.attrs = attrs;
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.id = '';
  }

  closest() {
    return null;
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {
    this.removed = true;
  }
}

const subject = new FakeElement({ text: 'Application update' });
const body = new FakeElement({
  text: 'Thank you for applying. We will not be moving forward with your application.',
});
const sender = new FakeElement({ attrs: { email: 'recruiting@example.com' } });
const appended = [];

const document = {
  documentElement: new FakeElement(),
  body: new FakeElement(),
  querySelectorAll(selector) {
    if (selector.startsWith('h2.hP')) return [subject];
    if (selector.startsWith('.a3s.aiL')) return [body];
    if (selector.startsWith('.gD[email]')) return [sender];
    return [];
  },
  getElementById(id) {
    return appended.find((node) => node.id === id && !node.removed) || null;
  },
  createElement() {
    return new FakeElement();
  },
  createTextNode(text) {
    return { textContent: text };
  },
};
document.body.appendChild = (node) => {
  appended.push(node);
  return node;
};

let sentMessage;
const context = {
  document,
  location: { pathname: '/mail/u/0/', hash: '#inbox/thread-123' },
  chrome: {
    runtime: {
      async sendMessage(message) {
        sentMessage = message;
        return {
          ok: true,
          record: {
            reflection: 'The application was closed without detailed feedback.',
            nextStep: 'Record the outcome and close the email.',
          },
        };
      },
    },
  },
  MutationObserver: class {
    observe() {}
  },
  getComputedStyle() {
    return { display: 'block', visibility: 'visible' };
  },
  setTimeout,
  clearTimeout,
  console,
};
context.globalThis = context;

const source = fs.readFileSync(path.resolve(__dirname, '..', 'gmailRejection.js'), 'utf8');
vm.runInNewContext(source, context);

const button = appended.find((node) => node.id === 'sjsc-analyze-rejection');
assert.ok(button, 'Analyze rejection button should appear for an open Gmail message');
assert.match(button.title, /resume profile to Gemini/);

Promise.resolve(button.listeners.click())
  .then(() => {
    assert.equal(sentMessage.type, 'ANALYZE_REJECTION');
    assert.equal(sentMessage.email.subject, 'Application update');
    assert.equal(sentMessage.email.sender, 'recruiting@example.com');
    assert.match(sentMessage.email.body, /not be moving forward/);
    assert.equal(sentMessage.email.sourceKey, '/mail/u/0/#inbox/thread-123');
    console.log('gmail rejection extraction test passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
