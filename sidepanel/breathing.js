/**
 * Optional 60-second box-breathing reset used in interview preparation.
 * This is an action tool, not a mood/energy survey.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function initBreathing() {
  const circle = document.getElementById('breathe-circle');
  const text = document.getElementById('breathe-text');
  const button = document.getElementById('btn-breathe');
  let session = null;

  async function run() {
    if (session) {
      session.cancelled = true;
      session = null;
      button.textContent = 'Start 60-second reset';
      return;
    }

    const mine = { cancelled: false };
    session = mine;
    button.textContent = 'Stop';

    const phases = [
      ['Breathe in', 'in'],
      ['Hold', 'hold-in'],
      ['Breathe out', 'out'],
      ['Hold', 'hold-out'],
    ];

    for (let round = 1; round <= 4 && !mine.cancelled; round += 1) {
      for (const [label, phase] of phases) {
        if (mine.cancelled) break;
        circle.dataset.phase = phase;
        for (let seconds = 4; seconds > 0 && !mine.cancelled; seconds -= 1) {
          text.textContent = `${label} · ${seconds} (round ${round} of 4)`;
          await sleep(1000);
        }
      }
    }

    // A newer session may have started while this one was winding down.
    if (session && session !== mine) return;
    circle.dataset.phase = 'idle';
    text.textContent = mine.cancelled
      ? 'Stopped. Try again whenever you like.'
      : 'Nicely done. Notice your shoulders and jaw, and let them drop.';
    button.textContent = 'Start 60-second reset';
    session = null;
  }

  button.addEventListener('click', run);
}
