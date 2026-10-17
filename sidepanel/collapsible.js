/**
 * Collapsible side-panel sections. Mark a <section> with `data-collapsible`;
 * its first child is the header (an h2, or a row containing one) and every
 * other child is moved into a body that starts collapsed.
 */

function setExpanded(section, expanded) {
  const toggle = section.querySelector(':scope > .collapsible-head .collapse-toggle');
  const body = section.querySelector(':scope > .collapsible-body');
  if (!toggle || !body) return;
  section.classList.toggle('collapsed', !expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  body.hidden = !expanded;
}

export function expandSection(section) {
  if (section?.hasAttribute('data-collapsible')) setExpanded(section, true);
}

export function initCollapsibles(root = document) {
  root.querySelectorAll('section[data-collapsible]').forEach((section, i) => {
    const head = section.firstElementChild;
    const heading = head?.matches('h2') ? head : head?.querySelector('h2');
    if (!heading) return;
    head.classList.add('collapsible-head');

    const body = document.createElement('div');
    body.className = 'collapsible-body';
    body.id = `${section.id || `collapsible-${i}`}-body`;
    while (head.nextSibling) body.appendChild(head.nextSibling);
    section.appendChild(body);

    // The heading keeps its id (sections are aria-labelledby it); the button lives inside it.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'collapse-toggle';
    toggle.setAttribute('aria-controls', body.id);
    const chevron = document.createElement('span');
    chevron.className = 'collapse-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(chevron, ...heading.childNodes);
    heading.appendChild(toggle);

    toggle.addEventListener('click', () => {
      setExpanded(section, section.classList.contains('collapsed'));
    });

    // Running a section's action (Analyze, Estimate, …) should reveal its result.
    head.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (button && button !== toggle) setExpanded(section, true);
    });

    setExpanded(section, false);
  });
}
