const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) {
    this.values.add(value);
  }
  remove(value) {
    this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(text = '') {
    this.innerText = text;
    this.textContent = text;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.listeners = {};
    this.targetCell = null;
    this.subject = null;
    this.snippet = null;
  }
  matches() {
    return false;
  }
  querySelector(selector) {
    if (selector.startsWith('.bog')) return this.subject;
    if (selector.startsWith('.y2')) return this.snippet;
    if (selector.startsWith('td')) return this.targetCell;
    if (selector === '.sjsc-rejection-email-cover') {
      return this.targetCell?.children.find(
        (child) => child.className === 'sjsc-rejection-email-cover' && !child.removed
      );
    }
    return null;
  }
  querySelectorAll() {
    return [];
  }
  setAttribute() {}
  addEventListener(type, listener) {
    this.listeners[type] = listener;
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

function makeRow(subjectText, snippetText) {
  const row = new FakeElement();
  row.subject = new FakeElement(subjectText);
  row.snippet = new FakeElement(snippetText);
  row.targetCell = new FakeElement();
  return row;
}

const rejection = makeRow(
  'Cloudflare application update',
  'Thank you for applying. We will not be moving forward with your application.'
);
const interview = makeRow(
  'Interview invitation',
  'We would like to move forward and schedule an interview.'
);
const genericUpdate = makeRow(
  'Your application status update',
  'There is a new update regarding your recent application.'
);
const notSelected = makeRow(
  'Software Developer Co-op',
  'Unfortunately, you were not among those selected for further consideration.'
);
const differentCandidate = makeRow(
  'Application result',
  'Unfortunately, we have decided to pursue a different candidate.'
);
const rows = [rejection, interview, genericUpdate, notSelected, differentCandidate];
const document = {
  documentElement: new FakeElement(),
  querySelectorAll() {
    return rows;
  },
  createElement() {
    return new FakeElement();
  },
};

const context = {
  document,
  Element: FakeElement,
  MutationObserver: class {
    observe() {}
  },
  setTimeout,
  clearTimeout,
  console,
};

const source = fs.readFileSync(path.resolve(__dirname, '..', 'gmailFilter.js'), 'utf8');
vm.runInNewContext(source, context);

assert.equal(rejection.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(interview.classList.contains('sjsc-rejection-email-hidden'), false);
assert.equal(genericUpdate.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(notSelected.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(differentCandidate.classList.contains('sjsc-rejection-email-hidden'), true);

const cover = rejection.querySelector('.sjsc-rejection-email-cover');
assert.ok(cover);
const showButton = cover.children[1];
showButton.listeners.click({
  preventDefault() {},
  stopPropagation() {},
});
assert.equal(rejection.classList.contains('sjsc-rejection-email-hidden'), false);
assert.equal(cover.removed, true);

console.log('gmail inbox rejection filter tests passed');
