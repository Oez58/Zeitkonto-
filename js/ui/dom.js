// Kleine Helfer für die Oberfläche: Elemente bauen, Hinweise, Dialoge.
// Texte werden immer als Text eingesetzt (kein innerHTML), damit Eingaben nichts kaputt machen.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'hidden', 'open']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ---------- Hinweis-Leiste (Toast) ----------
let toastTimer = null;
export function toast(text, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast ' + kind), 3200);
}

// ---------- Dialog von unten (Sheet) ----------
const stack = [];

export function openSheet(build, { title = '', wide = false, onClose } = {}) {
  const close = () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 180);
    document.removeEventListener('keydown', onKey);
    if (!stack.length) document.body.classList.remove('sheet-open');
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && stack[stack.length - 1] === close) close();
  };
  const body = h('div', { class: 'sheet-body' });
  const panel = h(
    'div',
    { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title' }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: close }, '×')),
    body
  );
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => e.target === backdrop && close() }, panel);
  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  stack.push(close);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const api = { close, body, rerender: () => (clear(body), append(body, [build(api)])) };
  api.rerender();
  setTimeout(() => panel.querySelector('[autofocus]')?.focus(), 50);
  return api;
}

/** Bestätigung im eigenen Dialog. Liefert true oder false. */
export function confirmSheet({ title, text, ok = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sheet.close();
      resolve(v);
    };
    const sheet = openSheet(
      () =>
        h(
          'div',
          { class: 'stack' },
          text ? h('p', { class: 'lead' }, text) : null,
          h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, cancel), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => finish(true) }, ok))
        ),
      { title, onClose: () => finish(false) }
    );
  });
}

export function field(label, control, hint) {
  const id = control.id || 'f' + Math.random().toString(36).slice(2, 8);
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function seg(options, value, onChange, { name = 'seg', small = false } = {}) {
  return h(
    'div',
    { class: 'seg' + (small ? ' small' : ''), role: 'radiogroup' },
    options.map(([v, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => onChange(v), 'data-name': name }, label)
    )
  );
}

export function signClass(min) {
  return min > 0.5 ? 'pos' : min < -0.5 ? 'neg' : '';
}
