import assert from 'node:assert/strict';
import { matchStarStories } from '../services/starMatcher.js';

const parsedJob = {
  requiredTechStack: ['Python', 'React'],
  domainConstraints: [
    'Regulated finance and mortgage servicing',
    'Compliance with federal, state, and agency regulations',
    'Legal authorization to work in the U.S.',
  ],
  keyResponsibilities: ['Design and maintain reliable software systems.'],
};

const projects = [
  {
    id: 'pipeline',
    title: 'Telemetry Data Processing Pipeline',
    tags: ['python', 'streaming'],
    situation: 'Product analytics lagged by hours.',
    task: 'Build a near-real-time pipeline.',
    action: 'Built Python stream processing jobs.',
    result: 'Reduced latency by 35 percent.',
  },
  {
    id: 'frontend',
    title: 'Design System Migration',
    tags: ['react', 'accessibility'],
    situation: 'UI patterns were inconsistent.',
    task: 'Create a component library.',
    action: 'Built typed React components.',
    result: 'Reduced UI defects.',
  },
];

assert.deepEqual(matchStarStories(parsedJob, []), []);

const matches = matchStarStories(parsedJob, projects, 2);
assert.equal(matches.length, 2);
assert.ok(matches.some((match) => match.matchedSignals.includes('Python')));
assert.ok(matches.some((match) => match.matchedSignals.includes('React')));
assert.ok(
  matches.every(
    (match) =>
      !match.matchedSignals.includes('Legal authorization to work in the U.S.') &&
      !match.matchedSignals.includes('and')
  )
);

console.log('STAR matcher signal tests passed');
