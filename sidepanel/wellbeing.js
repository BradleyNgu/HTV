/**
 * Daily check-in, 7-day trend, and the 60-second breathing reset.
 * Check-ins are saved through the background worker, which turns them
 * into an adjusted daily application cap.
 */

const SCALE_LABELS = {
  mood: ['Drained', 'Low', 'Okay', 'Good', 'Great'],
  energy: ['Empty', 'Low', 'Okay', 'Good', 'Full'],
};

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Today's energy if logged, else the 7-day average, else null. */
export async function getCurrentEnergy() {
  const { checkIns = [] } = await chrome.storage.local.get('checkIns');
  const today = checkIns.find((c) => c.date === localDateKey());
  if (today) return today.energy;
  const recent = checkIns.slice(-7);
  if (!recent.length) return null;
  return recent.reduce((sum, c) => sum + c.energy, 0) / recent.length;
}

export function initWellbeing({ onSaved }) {
  const els = {
    status: $('checkin-status'),
    save: $('btn-save-checkin'),
    note: $('checkin-note'),
    trend: $('trend'),
    circle: $('breathe-circle'),
    breatheText: $('breathe-text'),
    breatheBtn: $('btn-breathe'),
  };
  const selected = { mood: null, energy: null };

  // ---- Scale buttons -------------------------------------------------------
  function buildScale(kind) {
    const container = $(`${kind}-buttons`);
    container.innerHTML = '';
    SCALE_LABELS[kind].forEach((label, i) => {
      const value = i + 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scale-btn';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.value = String(value);
      btn.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      btn.addEventListener('click', () => {
        selected[kind] = value;
        paintScale(kind);
        els.save.disabled = !(selected.mood && selected.energy);
      });
      container.appendChild(btn);
    });
  }

  function paintScale(kind) {
    $(`${kind}-buttons`)
      .querySelectorAll('.scale-btn')
      .forEach((btn) => {
        const on = Number(btn.dataset.value) === selected[kind];
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-checked', String(on));
      });
  }

  // ---- Trend ---------------------------------------------------------------
  function renderTrend(checkIns) {
    els.trend.innerHTML = '';
    const byDate = new Map(checkIns.map((c) => [c.date, c]));
    const summary = [];

    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const entry = byDate.get(localDateKey(d));
      const score = entry ? (entry.mood + entry.energy) / 2 : null;

      const col = document.createElement('div');
      col.className = 'trend-col';
      const bar = document.createElement('div');
      bar.className = 'trend-bar';
      if (score == null) {
        bar.classList.add('empty');
        bar.style.height = '6%';
      } else {
        bar.style.height = `${Math.round((score / 5) * 100)}%`;
        if (score < 2.5) bar.classList.add('low');
      }
      const day = document.createElement('span');
      day.className = 'trend-day';
      day.textContent = d.toLocaleDateString(undefined, { weekday: 'narrow' });

      const label = `${d.toLocaleDateString(undefined, { weekday: 'long' })}: ${
        score == null ? 'no check-in' : `${score.toFixed(1)} of 5`
      }`;
      col.title = label;
      summary.push(label);
      col.append(bar, day);
      els.trend.appendChild(col);
    }
    els.trend.setAttribute('aria-label', `Wellbeing trend. ${summary.join('; ')}`);
  }

  function describe(res) {
    const { checkIn, adjusted, dailyAppCap, baseCap } = res;
    if (!checkIn) return '';
    if (adjusted) {
      return `Rough day noted. Today's cap is eased from ${baseCap} to ${dailyAppCap}, and study plans stay light. Rest counts as progress.`;
    }
    const score = (checkIn.mood + checkIn.energy) / 2;
    return score >= 3.5
      ? `Good to hear. Your cap stays at ${dailyAppCap}. It is a ceiling, not a target.`
      : `Steady day. Your cap stays at ${dailyAppCap}.`;
  }

  function showSaved(res) {
    els.status.textContent = 'Logged today';
    els.status.className = 'status-pill status-ok';
    const text = describe(res);
    els.note.textContent = text;
    els.note.classList.toggle('hidden', !text);
  }

  async function load() {
    const { checkIns = [] } = await chrome.storage.local.get('checkIns');
    const today = checkIns.find((c) => c.date === localDateKey());
    if (today) {
      selected.mood = today.mood;
      selected.energy = today.energy;
      paintScale('mood');
      paintScale('energy');
      els.save.disabled = false;
      const res = await chrome.runtime.sendMessage({ type: 'GET_PACING_STATE' });
      if (res?.ok) showSaved(res);
    }
    renderTrend(checkIns);
  }

  els.save.addEventListener('click', async () => {
    els.save.disabled = true;
    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_CHECKIN',
      mood: selected.mood,
      energy: selected.energy,
    });
    els.save.disabled = false;
    if (!res?.ok) {
      els.note.textContent = res?.error || 'Could not save check-in.';
      els.note.classList.remove('hidden');
      return;
    }
    showSaved(res);
    onSaved?.(res);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.checkIns) renderTrend(changes.checkIns.newValue || []);
  });

  // ---- Breathing reset -----------------------------------------------------
  let session = null;

  async function runBreathing() {
    if (session) {
      session.cancelled = true;
      session = null;
      els.breatheBtn.textContent = 'Start 60-second reset';
      return;
    }
    const mine = { cancelled: false };
    session = mine;
    els.breatheBtn.textContent = 'Stop';

    const phases = [
      ['Breathe in', 'in'],
      ['Hold', 'hold-in'],
      ['Breathe out', 'out'],
      ['Hold', 'hold-out'],
    ];
    const rounds = 4;
    const seconds = 4;

    for (let round = 1; round <= rounds && !mine.cancelled; round += 1) {
      for (const [label, phase] of phases) {
        if (mine.cancelled) break;
        els.circle.dataset.phase = phase;
        for (let s = seconds; s > 0 && !mine.cancelled; s -= 1) {
          els.breatheText.textContent = `${label} · ${s} (round ${round} of ${rounds})`;
          await sleep(1000);
        }
      }
    }

    // A newer session may have started while this one was winding down.
    if (session && session !== mine) return;
    els.circle.dataset.phase = 'idle';
    els.breatheText.textContent = mine.cancelled
      ? 'Stopped. Try again whenever you like.'
      : 'Nicely done. Notice your shoulders and jaw, and let them drop.';
    els.breatheBtn.textContent = 'Start 60-second reset';
    session = null;
  }

  els.breatheBtn.addEventListener('click', runBreathing);

  buildScale('mood');
  buildScale('energy');
  return load();
}
