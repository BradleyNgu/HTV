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
const furtherConsideration = makeRow(
  'AMD application',
  "Unfortunately, you weren't selected for further consideration."
);
const noFit = makeRow(
  'Application review',
  "Unfortunately, our team didn't find a fit at this time."
);
const unableToProcess = makeRow(
  'Update on your application',
  'Unfortunately, we were not able to process your application at this time.'
);
const movingForward = makeRow(
  'Thanks for your interest',
  'Unfortunately, the team will be moving forward with other candidates at this time.'
);
const movingAhead = makeRow(
  'Thank you for your interest',
  'Unfortunately, we have decided to move ahead with other candidates.'
);
const positionClosed = makeRow(
  'Your application with Pinterest',
  'The Software Engineer Intern position you applied for has been closed and we are no longer reviewing applications.'
);
const unrelatedUnfortunately = makeRow(
  'Travel insurance claim',
  'While falling ill is never part of the plan, it can unfortunately happen.'
);
// BMO-style: rejection buried after a long preamble; Gmail snippet often
// truncates before "will not be moving forward".
const bmoTruncatedSnippet = makeRow(
  'BMO Financial Group - Data Analytics Intern, Winter 2027 (Co-op/Internship) - 8 months - R260024336',
  'Thank you for your interest in BMO. We received a high volume of applications for Data Analytics Intern, Winter 2027 (Co-op/Internship) - 8 months , R260024336 , making this process very competitive.'
);
const bmoFullBody = makeRow(
  'BMO Financial Group - Data Analytics Intern, Winter 2027 (Co-op/Internship) - 8 months - R260024336',
  'Hello Bradley , Thank you for your interest in BMO. We received a high volume of applications for Data Analytics Intern, Winter 2027 (Co-op/Internship) - 8 months , R260024336 , making this process very competitive. While we will not be moving forward with your application, we encourage you to stay connected with us. Here are some ways to make sure you’re the first to know about new job opportunities at BMO:'
);
const rows = [
  rejection,
  interview,
  genericUpdate,
  notSelected,
  differentCandidate,
  furtherConsideration,
  noFit,
  unableToProcess,
  movingForward,
  movingAhead,
  positionClosed,
  unrelatedUnfortunately,
  bmoTruncatedSnippet,
  bmoFullBody,
];
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
assert.equal(furtherConsideration.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(noFit.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(unableToProcess.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(movingForward.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(movingAhead.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(positionClosed.classList.contains('sjsc-rejection-email-hidden'), true);
assert.equal(
  unrelatedUnfortunately.classList.contains('sjsc-rejection-email-hidden'),
  false
);
assert.equal(
  bmoTruncatedSnippet.classList.contains('sjsc-rejection-email-hidden'),
  true
);
assert.equal(bmoFullBody.classList.contains('sjsc-rejection-email-hidden'), true);

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
