/**
 * @askdown/html runtime — progressive enhancement for server-rendered forms.
 *
 * Without this script, the rendered form shows every page in sequence and the
 * server validates and follows jumps. With it, the form becomes paged: one
 * page at a time, Back/Next navigation, branching, inline validation that
 * matches the server exactly (it uses the same core functions), "other"
 * inputs, option shuffling and a progress indicator.
 *
 * Vanilla ES module, no framework. Bundle it with esbuild (it imports the
 * core package and the FormData reader).
 */
import {
  checkAnswer,
  countryForPhone,
  countryName,
  flagEmoji,
  isCountryCode,
  isQuestion,
  nextPage,
  PHONE_CODES,
  renderMarkdown,
  validateResponse,
} from '@askdown/core';
import { readAnswers } from './read-answers.ts';
import { addressPartsHtml } from './render.ts';

/** @typedef {import('@askdown/core').Form} Form */
/** @typedef {import('@askdown/core').Question} Question */
/** @typedef {import('@askdown/core').Answers} Answers */

/**
 * @typedef {object} InitOptions
 * @property {(answers: Answers, detail: { form: Form, raw: import('./index.ts').ReadResult, formEl: HTMLFormElement }) => void} [onSubmit]
 *   Intercepts submission: the form is validated but not sent. Also implied by data-preview.
 */

/**
 * @typedef {object} FormController
 * @property {HTMLFormElement} el
 * @property {Form} form
 * @property {() => number} currentPage
 * @property {(index: number, opts?: { focus?: boolean }) => void} goTo
 * @property {() => boolean} next
 * @property {() => void} back
 * @property {() => boolean} validatePage
 * @property {() => void} destroy
 */


/** @type {WeakMap<HTMLFormElement, FormController>} */
const controllers = new WeakMap();

/**
 * @param {HTMLFormElement} formEl
 * @returns {Form | null}
 */
function readDefinition(formEl) {
  const script = formEl.querySelector('script.askdown-definition');
  if (!script || !script.textContent) return null;
  try {
    return JSON.parse(script.textContent);
  } catch {
    return null;
  }
}

/**
 * @template T
 * @param {T[]} items
 */
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function h(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Enhances one rendered Askdown form.
 *
 * @param {HTMLFormElement} formEl
 * @param {InitOptions} [options]
 * @returns {FormController | null} null when the element has no definition.
 */
export function initForm(formEl, options = {}) {
  const existing = controllers.get(formEl);
  if (existing) return existing;
  const form = readDefinition(formEl);
  if (!form) return null;

  const preview = formEl.hasAttribute('data-preview');
  /** @type {HTMLElement[]} */
  const pages = Array.from(formEl.querySelectorAll('.askdown-page'));
  pages.sort((a, b) => Number(a.dataset.pageIndex) - Number(b.dataset.pageIndex));
  /** @type {Map<string, Question>} */
  const questions = new Map();
  for (const page of form.pages) for (const item of page.items) if (isQuestion(item)) questions.set(item.id, item);

  const live = /** @type {HTMLElement | null} */ (formEl.querySelector('.askdown-live'));
  const actions = /** @type {HTMLElement | null} */ (formEl.querySelector('.askdown-actions'));
  const originalSubmit = /** @type {HTMLButtonElement | null} */ (formEl.querySelector('.askdown-submit'));
  const submitLabel = (originalSubmit && originalSubmit.textContent) || form.settings?.submitLabel || 'Submit';
  const originalActionsHtml = actions ? actions.innerHTML : '';
  const hadNoValidate = formEl.noValidate;
  const idPrefix = formEl.dataset.idPrefix || 'askdown';

  /** @type {number[]} History of page indexes before the current one. */
  let history = [];
  let current = 0;
  let submitting = false;
  let destroyed = false;

  // --- Navigation UI -------------------------------------------------------

  const progress = h('div', 'askdown-progress');
  const progressText = h('span', 'askdown-progress-text');
  const progressBar = h('div', 'askdown-progress-bar');
  progressBar.setAttribute('role', 'progressbar');
  progressBar.setAttribute('aria-valuemin', '0');
  progressBar.setAttribute('aria-valuemax', '100');
  const progressFill = h('div', 'askdown-progress-fill');
  progressBar.appendChild(progressFill);
  progress.append(progressText, progressBar);

  const backButton = /** @type {HTMLButtonElement} */ (h('button', 'askdown-button askdown-button--secondary askdown-back', 'Back'));
  backButton.type = 'button';
  const nextButton = /** @type {HTMLButtonElement} */ (h('button', 'askdown-button askdown-button--primary askdown-next', 'Next'));
  nextButton.type = 'submit';
  const nav = h('div', 'askdown-nav');
  nav.append(backButton, nextButton);

  if (actions) {
    actions.innerHTML = '';
    actions.append(progress, nav);
  } else {
    formEl.append(progress, nav);
  }
  formEl.classList.add('askdown--paged');
  formEl.noValidate = true;

  // --- Answers & validation ------------------------------------------------

  function readRaw() {
    return readAnswers(form, new FormData(formEl));
  }

  /** Normalized answers for navigation, computed from the current inputs. */
  function currentAnswers() {
    /** @type {Answers} */
    const answers = {};
    const raw = readRaw().answers;
    for (const [id, q] of questions) {
      const check = checkAnswer(q, raw[id]);
      if (check.value !== undefined) answers[id] = check.value;
    }
    return answers;
  }

  /** @param {number} pageIndex */
  function questionsOn(pageIndex) {
    const page = form.pages[pageIndex];
    return page ? page.items.filter(isQuestion) : [];
  }

  /** @param {string} id */
  function questionEl(id) {
    return /** @type {HTMLElement | null} */ (
      pages[current]?.querySelector(`.askdown-question[data-question-id="${CSS.escape(id)}"]`) ||
        formEl.querySelector(`.askdown-question[data-question-id="${CSS.escape(id)}"]`)
    );
  }

  /**
   * @param {HTMLElement} el
   * @param {string} message
   */
  function setError(el, message) {
    const errorEl = el.querySelector('.askdown-error');
    el.classList.toggle('askdown-question--invalid', message !== '');
    if (errorEl) {
      errorEl.textContent = message;
      if (message) errorEl.removeAttribute('hidden');
      else errorEl.setAttribute('hidden', '');
    }
    for (const input of el.querySelectorAll('input, select, textarea, fieldset')) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  /** @param {string} message */
  function announce(message) {
    if (!live) return;
    live.textContent = '';
    // Re-insert on the next frame so repeated identical messages are announced.
    requestAnimationFrame(() => {
      live.textContent = message;
    });
  }

  /**
   * Validates the questions on the current page. Shows inline errors, focuses
   * the first invalid field and announces the result.
   * @returns {boolean}
   */
  function validatePage() {
    const raw = readRaw();
    /** @type {{ el: HTMLElement, message: string }[]} */
    const problems = [];
    const pageEl = pages[current];
    if (!pageEl) return true;

    for (const q of questionsOn(current)) {
      const el = questionEl(q.id);
      if (!el) continue;
      const check = checkAnswer(q, raw.answers[q.id]);
      setError(el, check.error || '');
      if (check.error) problems.push({ el, message: check.error });
    }

    if (problems.length) {
      const first = problems[0];
      // The first visible control; a ranking hides its selects behind buttons,
      // and a phone number's problem is in the number, not the country picker
      // that precedes it.
      const focusable =
        /** @type {HTMLElement | null} */ (first.el.querySelector('.askdown-phone-input')) ||
        Array.from(first.el.querySelectorAll('input:not([type=hidden]), select, textarea, button')).find(
          (c) => c instanceof HTMLElement && !(/** @type {HTMLButtonElement} */ (c).disabled) && c.offsetParent !== null,
        ) ||
        null;
      announce(
        `${problems.length === 1 ? '1 problem' : `${problems.length} problems`} on this page. ${first.message}`,
      );
      if (focusable) focusable.focus({ preventScroll: false });
      else first.el.scrollIntoView({ block: 'center' });
      return false;
    }
    return true;
  }

  // --- Paging --------------------------------------------------------------

  /** Projects the pages the respondent will visit with the current answers. */
  function projectedPath() {
    const answers = currentAnswers();
    const path = [...history, current];
    const seen = new Set(path);
    let idx = nextPage(form, current, answers);
    while (idx !== null && !seen.has(idx)) {
      path.push(idx);
      seen.add(idx);
      idx = nextPage(form, idx, answers);
    }
    return path;
  }

  function updateNav() {
    const isLast = nextPage(form, current, currentAnswers()) === null;
    nextButton.textContent = isLast ? submitLabel : 'Next';
    nextButton.classList.toggle('askdown-next--submit', isLast);
    backButton.hidden = history.length === 0;

    const path = projectedPath();
    const position = history.length + 1;
    const total = path.length;
    const percent = Math.round((position / total) * 100);
    progressText.textContent = `Page ${position} of ${total}`;
    progressBar.setAttribute('aria-valuenow', String(percent));
    progressBar.setAttribute('aria-label', `Page ${position} of ${total}`);
    progressFill.style.width = `${percent}%`;
    progress.hidden = form.pages.length <= 1;
  }

  /**
   * @param {number} index
   * @param {{ focus?: boolean }} [opts]
   */
  function showPage(index, opts = {}) {
    current = index;
    pages.forEach((page, i) => {
      page.hidden = i !== index;
    });
    updateNav();
    if (opts.focus !== false) {
      const page = pages[index];
      if (page) {
        const heading = /** @type {HTMLElement | null} */ (page.querySelector('.askdown-page-title'));
        const target = heading || page;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        formEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      announce(progressText.textContent || '');
    }
  }

  /** Advances to the next page. Returns false when the current page is invalid or is the last one. */
  function next() {
    if (!validatePage()) return false;
    const target = nextPage(form, current, currentAnswers());
    if (target === null || history.includes(target) || target === current) return false;
    history.push(current);
    showPage(target);
    return true;
  }

  function back() {
    const previous = history.pop();
    if (previous === undefined) return;
    showPage(previous);
  }

  /**
   * @param {number} index
   * @param {{ focus?: boolean }} [opts] Pass focus: false to switch pages without moving focus or scrolling.
   */
  function goTo(index, opts = {}) {
    if (index < 0 || index >= pages.length) return;
    // Rebuild the history by walking from the first page.
    const answers = currentAnswers();
    history = [];
    let idx = 0;
    const seen = new Set();
    while (idx !== index && idx !== null && !seen.has(idx)) {
      seen.add(idx);
      history.push(idx);
      idx = nextPage(form, idx, answers);
    }
    if (idx !== index) history = [];
    showPage(index, opts);
  }

  // --- Submission ----------------------------------------------------------

  function showPreviewConfirmation() {
    const wrapper = h('div', 'askdown-confirmation askdown-confirmation--preview');
    wrapper.setAttribute('role', 'status');
    const note = h('p', 'askdown-preview-note', 'Preview — this response was not submitted.');
    const body = h('div', 'askdown-confirmation-body');
    body.innerHTML = form.settings?.confirmation
      ? renderMarkdown(form.settings.confirmation, { headingOffset: 1 })
      : '<p>Your response has been recorded.</p>';
    const again = /** @type {HTMLButtonElement} */ (h('button', 'askdown-button askdown-button--secondary', 'Fill in again'));
    again.type = 'button';
    again.addEventListener('click', () => {
      wrapper.remove();
      formEl.reset();
      for (const page of pages) page.hidden = false;
      if (actions) actions.hidden = false;
      history = [];
      showPage(0);
    });
    wrapper.append(note, body, again);
    for (const page of pages) page.hidden = true;
    if (actions) actions.hidden = true;
    (pages[0]?.parentElement || formEl).appendChild(wrapper);
    wrapper.setAttribute('tabindex', '-1');
    wrapper.focus();
  }

  /** @param {SubmitEvent} event */
  function onSubmit(event) {
    if (submitting) {
      event.preventDefault();
      return;
    }
    if (!validatePage()) {
      event.preventDefault();
      return;
    }
    const answers = currentAnswers();
    const target = nextPage(form, current, answers);
    if (target !== null) {
      // Enter in a text field or the Next button: advance instead.
      event.preventDefault();
      next();
      return;
    }

    if (preview || options.onSubmit) {
      event.preventDefault();
      const raw = readRaw();
      const result = validateResponse(form, raw.answers);
      if (options.onSubmit) options.onSubmit(result.answers, { form, raw, formEl });
      else showPreviewConfirmation();
      return;
    }

    // Real submission: don't send answers from pages the respondent skipped.
    const visited = new Set([...history, current]);
    pages.forEach((page, i) => {
      if (visited.has(i)) return;
      for (const input of page.querySelectorAll('input, select, textarea')) {
        /** @type {HTMLInputElement} */ (input).disabled = true;
      }
    });
    submitting = true;
    nextButton.disabled = true;
    backButton.disabled = true;
    nextButton.textContent = 'Submitting…';
  }

  // --- Event handling ------------------------------------------------------

  /** @param {Event} event */
  function onInput(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!(target instanceof HTMLElement)) return;

    // Typing in an "other" text field selects its option.
    if (target.classList.contains('askdown-other-input')) {
      const option = target.closest('.askdown-option--other');
      const choice = option && /** @type {HTMLInputElement | null} */ (option.querySelector('.askdown-choice'));
      if (choice && /** @type {HTMLInputElement} */ (target).value.trim() !== '' && !choice.checked) {
        choice.checked = true;
        choice.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // A number typed or pasted with its country code picks that country.
    if (target instanceof HTMLInputElement && target.classList.contains('askdown-phone-input')) {
      followPhoneCountry(target, /** @type {InputEvent} */ (event).inputType === 'insertFromPaste');
    }

    // Clear the error of the question being edited.
    const questionEl = target.closest('.askdown-question--invalid');
    if (questionEl instanceof HTMLElement) setError(questionEl, '');

    updateNav();
  }

  // --- Phone numbers -------------------------------------------------------

  /** The two-letter region of the browser's language, when it has one we know a calling code for. */
  function browserCountry() {
    try {
      const region = new Intl.Locale(navigator.language).maximize().region;
      return region && PHONE_CODES[region] ? region : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Shows the selected country's flag and calling code in the compact label
   * over the select.
   * @param {HTMLSelectElement} select
   */
  function syncPhoneLabel(select) {
    const group = select.closest('.askdown-phone');
    if (!group) return;
    const flag = group.querySelector('.askdown-phone-flag');
    const code = group.querySelector('.askdown-phone-code');
    const country = select.value.toUpperCase();
    const calling = PHONE_CODES[country];
    if (flag) flag.textContent = calling ? flagEmoji(country) : '\u{1F310}';
    if (code) code.textContent = calling ? `+${calling}` : '';
  }

  /**
   * Switches the country picker to the code of a number that starts with "+"
   * or "00". A pasted number also has that code moved out of the field, so
   * "+49 30 1234567" becomes 🇩🇪 +49 | 30 1234567 — while typing, the text is
   * left alone. A country that shares the code (Canada and the US) is kept.
   * @param {HTMLInputElement} input
   * @param {boolean} pasted
   */
  function followPhoneCountry(input, pasted) {
    const group = input.closest('.askdown-phone');
    const select = group && /** @type {HTMLSelectElement | null} */ (group.querySelector('.askdown-phone-select'));
    if (!select) return;
    const text = input.value.trim();
    const international = /^\+/.test(text) ? text : /^00/.test(text) ? `+${text.slice(2)}` : undefined;
    if (international === undefined) return;
    const digits = international.replace(/[^\d+]/g, '');
    const country = countryForPhone(digits);
    if (country === undefined) return;
    const code = PHONE_CODES[country];
    const current = select.value.toUpperCase();
    const target = PHONE_CODES[current] === code ? current : country;

    if (target !== current) {
      select.value = target;
      syncPhoneLabel(select);
      announce(`Country set to ${countryName(target)}, +${code}.`);
    }

    if (pasted && /^(?:\+|00)[\d\s().\-\/]*$/.test(text)) {
      // Drop the "+" or "00" and the code's digits, keeping the rest as
      // pasted (minus separators and a "(0)" trunk prefix right after the code).
      let i = text.startsWith('+') ? 1 : 2;
      for (let seen = 0; i < text.length && seen < code.length; i++) {
        if (/\d/.test(text[i])) seen++;
      }
      const national = text.slice(i).replace(/^[\s.\-\/]*(?:\(0\))?[\s().\-\/]*/, '');
      if (national !== input.value) input.value = national;
    }
  }

  /**
   * Without an author's default (or an earlier answer), starts from the
   * respondent's own country, then shows the label.
   * @param {HTMLSelectElement} select
   */
  function preparePhone(select) {
    const group = select.closest('.askdown-phone');
    const input = group && /** @type {HTMLInputElement | null} */ (group.querySelector('.askdown-phone-input'));
    if (select.value === '' && input && input.value === '') {
      const guess = browserCountry();
      if (guess) select.value = guess;
    }
    syncPhoneLabel(select);
  }

  /** @type {HTMLSelectElement[]} The country pickers of the phone questions. */
  const phoneSelects = [];
  for (const group of formEl.querySelectorAll('.askdown-phone')) {
    const select = /** @type {HTMLSelectElement | null} */ (group.querySelector('.askdown-phone-select'));
    if (!select) continue;
    preparePhone(select);
    group.classList.add('askdown-phone--enhanced');
    phoneSelects.push(select);
  }

  /** After form.reset() the selects return to their rendered country; follow them. */
  function onPhoneReset() {
    setTimeout(() => {
      if (!destroyed) for (const select of phoneSelects) preparePhone(select);
    }, 0);
  }
  if (phoneSelects.length) formEl.addEventListener('reset', onPhoneReset);

  // --- Addresses -----------------------------------------------------------

  /**
   * Re-renders the parts of an address for the country in its select, keeping
   * the values of the parts the new country also has. The select itself stays
   * in place so focus and browser autofill aren't disturbed.
   * @param {HTMLSelectElement} select
   */
  function updateAddressParts(select) {
    const questionEl = select.closest('.askdown-question[data-type="address"]');
    if (!(questionEl instanceof HTMLElement)) return;
    const q = questions.get(questionEl.dataset.questionId || '');
    const parts = questionEl.querySelector('.askdown-address-parts');
    if (!q || q.type !== 'address' || !(parts instanceof HTMLElement)) return;
    const country = select.value.toUpperCase();
    if ((parts.dataset.country || '') === country) return;

    /** @type {Record<string, string>} */
    const values = {};
    const prefix = `q.${q.id}.`;
    for (const input of parts.querySelectorAll('input, select, textarea')) {
      const field = /** @type {HTMLInputElement} */ (input);
      if (field.name.startsWith(prefix) && field.value !== '') values[field.name.slice(prefix.length)] = field.value;
    }

    const template = document.createElement('template');
    template.innerHTML = addressPartsHtml(q, country, values, { idPrefix });
    const next = template.content.firstElementChild;
    if (next) parts.replaceWith(next);
    announce(isCountryCode(country) ? `Address fields updated for ${countryName(country)}.` : 'Address fields updated.');
  }

  /** @param {Event} event */
  function onChange(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!(target instanceof HTMLElement)) return;
    const questionEl = target.closest('.askdown-question--invalid');
    if (questionEl instanceof HTMLElement) setError(questionEl, '');

    if (target instanceof HTMLSelectElement && target.classList.contains('askdown-phone-select')) {
      syncPhoneLabel(target);
    }

    if (target instanceof HTMLSelectElement && target.getAttribute('autocomplete') === 'country') {
      // Browser autofill fills the address in field order, country first, and
      // fires this change before the other parts have their values. Swapping
      // after the current task lets the fill land, so it carries over.
      setTimeout(() => {
        if (!destroyed && formEl.contains(target)) updateAddressParts(target);
      }, 0);
    }

    updateNav();
  }

  /** @param {MouseEvent} event */
  function onBack(event) {
    event.preventDefault();
    back();
  }

  formEl.addEventListener('submit', onSubmit);
  formEl.addEventListener('input', onInput);
  formEl.addEventListener('change', onChange);
  backButton.addEventListener('click', onBack);

  // --- Shuffling -----------------------------------------------------------

  for (const container of formEl.querySelectorAll('[data-shuffle]')) {
    if (container instanceof HTMLSelectElement) {
      const opts = Array.from(container.options).filter((o) => o.value !== '');
      shuffle(opts).forEach((o) => container.appendChild(o));
    } else {
      const opts = Array.from(container.children).filter(
        (c) =>
          (c.classList.contains('askdown-option') || c.classList.contains('askdown-ranking-option')) &&
          !c.classList.contains('askdown-option--other'),
      );
      const other = container.querySelector(':scope > .askdown-option--other');
      shuffle(opts).forEach((o) => container.appendChild(o));
      if (other) container.appendChild(other);
    }
  }

  // --- Rankings ------------------------------------------------------------

  /** @type {(() => void)[]} Undo functions for the ranking widgets. */
  const rankingCleanups = [];
  for (const questionEl of formEl.querySelectorAll('.askdown-question[data-type="ranking"]')) {
    if (questionEl instanceof HTMLElement) {
      const cleanup = enhanceRanking(questionEl);
      if (cleanup) rankingCleanups.push(cleanup);
    }
  }

  /**
   * Turns the rank selects of a ranking into a click-to-rank widget: an
   * unranked pool of options above a numbered list. Choosing an option from
   * the pool appends it to the list; ranked options can be moved up or down,
   * removed, or dragged. The selects stay in the DOM (hidden) and are kept in
   * sync, so the submission and readAnswers() see the same ranks as without
   * the runtime. The initial state comes from the selects, which restores a
   * ranking re-rendered after a server-side error.
   *
   * @param {HTMLElement} questionEl
   * @returns {(() => void) | null} Undo, or null when nothing was enhanced.
   */
  function enhanceRanking(questionEl) {
    const q = questions.get(questionEl.dataset.questionId || '');
    const container = questionEl.querySelector('.askdown-ranking');
    if (!q || q.type !== 'ranking' || !(container instanceof HTMLElement)) return null;

    /** @typedef {{ index: number, label: string, select: HTMLSelectElement }} RankItem */
    /** @type {RankItem[]} In presentation (possibly shuffled) order; `index` is the option index. */
    const items = [];
    /** @type {Map<number, RankItem>} */
    const byIndex = new Map();
    for (const row of container.querySelectorAll(':scope > .askdown-ranking-option')) {
      const select = row.querySelector('select');
      const index = Number(/** @type {HTMLElement} */ (row).dataset.index);
      const option = q.options[index];
      if (!(select instanceof HTMLSelectElement) || !option || byIndex.has(index)) continue;
      const item = { index, label: option.label, select };
      items.push(item);
      byIndex.set(index, item);
    }
    if (items.length < 2) return null;
    const total = items.length;

    /** @type {number[]} Option indexes, best first. */
    let ranked = [];

    /** Reads the ranking back from the selects (ties broken by option order, like readAnswers). */
    function readSelects() {
      ranked = items
        .filter((item) => item.select.value !== '')
        .sort((a, b) => Number(a.select.value) - Number(b.select.value) || a.index - b.index)
        .map((item) => item.index);
    }

    function writeSelects() {
      for (const item of items) {
        const position = ranked.indexOf(item.index);
        item.select.value = position === -1 ? '' : String(position + 1);
      }
    }

    const hintId = `${idPrefix}-${q.id}-ranking-hint`;
    const widget = h('div', 'askdown-ranking-widget');
    const hint = h('p', 'askdown-ranking-hint');
    hint.id = hintId;
    const pool = h('div', 'askdown-ranking-pool');
    pool.setAttribute('role', 'group');
    pool.setAttribute('aria-label', 'Options to rank');
    const list = h('ol', 'askdown-ranking-ranked');
    list.setAttribute('aria-label', 'Your ranking');
    const empty = h('p', 'askdown-ranking-empty', 'Nothing ranked yet.');
    widget.append(hint, pool, list, empty);
    container.classList.add('askdown-ranking--enhanced');
    container.appendChild(widget);

    /**
     * @param {string} className
     * @param {string} label
     * @param {string} path
     */
    function actionButton(className, label, path) {
      const button = /** @type {HTMLButtonElement} */ (h('button', `askdown-ranking-action ${className}`));
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.innerHTML =
        `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
        `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      return button;
    }

    /** @type {{ index: number, action: string } | null} Which button to focus after the next render. */
    let pendingFocus = null;
    /** @type {number | null} Index of the item being dragged. */
    let dragging = null;

    function render() {
      writeSelects();
      const unranked = items.filter((item) => !ranked.includes(item.index));

      pool.replaceChildren();
      for (const item of unranked) {
        const button = /** @type {HTMLButtonElement} */ (h('button', 'askdown-ranking-pool-item', item.label));
        button.type = 'button';
        button.dataset.index = String(item.index);
        button.setAttribute('aria-describedby', hintId);
        pool.appendChild(button);
      }
      pool.hidden = unranked.length === 0;
      hint.textContent =
        unranked.length === 0
          ? 'All options are ranked.'
          : ranked.length === 0
            ? 'Pick the options in order, starting with your top choice.'
            : `Next, pick your number ${ranked.length + 1}.`;

      list.replaceChildren();
      ranked.forEach((index, position) => {
        const item = /** @type {RankItem} */ (byIndex.get(index));
        const li = h('li', 'askdown-ranking-item');
        li.dataset.index = String(index);
        li.draggable = true;
        const badge = h('span', 'askdown-ranking-badge', String(position + 1));
        badge.setAttribute('aria-hidden', 'true');
        const label = h('span', 'askdown-ranking-item-label', item.label);
        const actions = h('span', 'askdown-ranking-item-actions');
        const up = actionButton('askdown-ranking-action--up', `Move ${item.label} up`, 'M6 14.5l6-6 6 6');
        up.dataset.action = 'up';
        up.disabled = position === 0;
        const down = actionButton('askdown-ranking-action--down', `Move ${item.label} down`, 'M6 9.5l6 6 6-6');
        down.dataset.action = 'down';
        down.disabled = position === ranked.length - 1;
        const remove = actionButton('askdown-ranking-action--remove', `Remove ${item.label} from the ranking`, 'M7 7l10 10M17 7L7 17');
        remove.dataset.action = 'remove';
        actions.append(up, down, remove);
        li.append(badge, label, actions);
        list.appendChild(li);
      });
      empty.hidden = ranked.length > 0;
      list.hidden = ranked.length === 0;

      if (pendingFocus) {
        const { index, action } = pendingFocus;
        pendingFocus = null;
        const li = list.querySelector(`[data-index="${index}"]`);
        if (li) {
          // Prefer the same button; at the edge of the list, its opposite.
          const opposite = action === 'up' ? 'down' : 'up';
          const target = [action, opposite, 'remove']
            .map((a) => /** @type {HTMLButtonElement | null} */ (li.querySelector(`[data-action="${a}"]`)))
            .find((b) => b && !b.disabled);
          if (target) target.focus();
        } else {
          // Removed or nothing ranked: back to the pool, or the list.
          const poolButton = /** @type {HTMLElement | null} */ (pool.querySelector(`[data-index="${index}"]`) || pool.querySelector('button'));
          const fallback = /** @type {HTMLElement | null} */ (list.querySelector('button'));
          (poolButton || fallback)?.focus();
        }
      }
    }

    /** Applies a change: syncs the selects, clears the error and updates the navigation. */
    function commit() {
      render();
      setError(questionEl, '');
      updateNav();
    }

    /** @param {MouseEvent} event */
    function onClick(event) {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !widget.contains(button)) return;
      event.preventDefault();

      if (button.classList.contains('askdown-ranking-pool-item')) {
        const index = Number(button.dataset.index);
        const item = byIndex.get(index);
        if (!item || ranked.includes(index)) return;
        // Keep the focus in the pool so several options can be ranked in a row.
        const siblings = Array.from(pool.querySelectorAll('button'));
        const at = siblings.indexOf(button);
        const nextInPool = siblings[at + 1] || siblings[at - 1];
        ranked.push(index);
        commit();
        announce(`${item.label} ranked ${ranked.length} of ${total}.`);
        if (nextInPool) {
          const stillThere = /** @type {HTMLElement | null} */ (pool.querySelector(`[data-index="${nextInPool.dataset.index}"]`));
          if (stillThere) {
            stillThere.focus();
            return;
          }
        }
        const removeButton = /** @type {HTMLElement | null} */ (list.querySelector(`[data-index="${index}"] [data-action="remove"]`));
        if (removeButton) removeButton.focus();
        return;
      }

      const li = button.closest('.askdown-ranking-item');
      if (!(li instanceof HTMLElement)) return;
      const index = Number(li.dataset.index);
      const item = byIndex.get(index);
      const position = ranked.indexOf(index);
      if (!item || position === -1) return;
      const action = button.dataset.action;

      if (action === 'remove') {
        ranked.splice(position, 1);
        // Focus the next item's remove button, else the pool.
        const next = ranked[position] ?? ranked[position - 1];
        pendingFocus = next === undefined ? { index, action: 'remove' } : { index: next, action: 'remove' };
        commit();
        announce(`${item.label} removed. ${ranked.length === 0 ? 'Nothing ranked.' : `${ranked.length} of ${total} ranked.`}`);
        return;
      }

      const to = action === 'up' ? position - 1 : action === 'down' ? position + 1 : -1;
      if (to < 0 || to >= ranked.length) return;
      ranked.splice(position, 1);
      ranked.splice(to, 0, index);
      pendingFocus = { index, action: /** @type {string} */ (action) };
      commit();
      announce(`${item.label} moved ${action} to ${to + 1} of ${ranked.length}.`);
    }

    // Pointer reordering with native drag and drop; the buttons remain the
    // keyboard route. While dragging, the existing list items are moved
    // rather than re-rendered, so the dragged node stays attached and its
    // dragend still reaches the list.

    /** Moves the list items into the order of `ranked` and renumbers them. */
    function syncListOrder() {
      ranked.forEach((index, position) => {
        const li = list.querySelector(`:scope > [data-index="${index}"]`);
        if (!li) return;
        list.appendChild(li);
        const badge = li.querySelector('.askdown-ranking-badge');
        if (badge) badge.textContent = String(position + 1);
        const up = /** @type {HTMLButtonElement | null} */ (li.querySelector('[data-action="up"]'));
        const down = /** @type {HTMLButtonElement | null} */ (li.querySelector('[data-action="down"]'));
        if (up) up.disabled = position === 0;
        if (down) down.disabled = position === ranked.length - 1;
      });
    }

    /** @param {DragEvent} event */
    function onDragStart(event) {
      const li = event.target instanceof Element ? event.target.closest('.askdown-ranking-item') : null;
      if (!(li instanceof HTMLElement) || !list.contains(li)) return;
      dragging = Number(li.dataset.index);
      li.classList.add('askdown-ranking-item--dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', byIndex.get(dragging)?.label || '');
      }
    }

    /** @param {DragEvent} event */
    function onDragOver(event) {
      if (dragging === null) return;
      const li = event.target instanceof Element ? event.target.closest('.askdown-ranking-item') : null;
      if (!(li instanceof HTMLElement) || !list.contains(li)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const over = Number(li.dataset.index);
      if (over === dragging) return;
      // Reorder live as the pointer passes the middle of another item.
      const rect = li.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const from = ranked.indexOf(dragging);
      let to = ranked.indexOf(over) + (after ? 1 : 0);
      if (from < to) to--;
      if (from === to) return;
      ranked.splice(from, 1);
      ranked.splice(to, 0, dragging);
      syncListOrder();
    }

    /** @param {DragEvent} event */
    function onDrop(event) {
      if (dragging === null) return;
      event.preventDefault();
    }

    function onDragEnd() {
      if (dragging === null) return;
      const item = byIndex.get(dragging);
      const position = ranked.indexOf(dragging);
      dragging = null;
      commit();
      if (item && position !== -1) announce(`${item.label} moved to ${position + 1} of ${ranked.length}.`);
    }

    /** After form.reset() the selects return to their rendered ranks; follow them. */
    function onReset() {
      setTimeout(() => {
        if (!destroyed) {
          readSelects();
          render();
        }
      }, 0);
    }

    widget.addEventListener('click', onClick);
    list.addEventListener('dragstart', onDragStart);
    list.addEventListener('dragover', onDragOver);
    list.addEventListener('drop', onDrop);
    list.addEventListener('dragend', onDragEnd);
    formEl.addEventListener('reset', onReset);

    readSelects();
    render();

    return () => {
      formEl.removeEventListener('reset', onReset);
      widget.remove();
      container.classList.remove('askdown-ranking--enhanced');
    };
  }

  // --- Initial page --------------------------------------------------------

  const firstInvalid = /** @type {HTMLElement | null} */ (formEl.querySelector('.askdown-page .askdown-question--invalid'));
  const startPage = firstInvalid ? pages.findIndex((p) => p.contains(firstInvalid)) : 0;
  if (startPage > 0) goTo(startPage);
  else showPage(0, { focus: false });

  /** @type {FormController} */
  const controller = {
    el: formEl,
    form,
    currentPage: () => current,
    goTo,
    next,
    back,
    validatePage,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controllers.delete(formEl);
      formEl.removeEventListener('submit', onSubmit);
      formEl.removeEventListener('input', onInput);
      formEl.removeEventListener('change', onChange);
      backButton.removeEventListener('click', onBack);
      for (const cleanup of rankingCleanups) cleanup();
      if (phoneSelects.length) formEl.removeEventListener('reset', onPhoneReset);
      for (const select of phoneSelects) select.closest('.askdown-phone')?.classList.remove('askdown-phone--enhanced');
      for (const page of pages) page.hidden = false;
      progress.remove();
      nav.remove();
      if (actions) {
        actions.innerHTML = originalActionsHtml;
        actions.hidden = false;
      }
      formEl.classList.remove('askdown--paged');
      formEl.noValidate = hadNoValidate;
    },
  };
  controllers.set(formEl, controller);
  return controller;
}

/**
 * Returns the controller of an initialized form, if any.
 * @param {HTMLFormElement} formEl
 */
export function getController(formEl) {
  return controllers.get(formEl) || null;
}

/** Initializes every form[data-askdown] on the page that isn't marked data-askdown-manual. */
export function initAll() {
  /** @type {FormController[]} */
  const result = [];
  for (const el of document.querySelectorAll('form[data-askdown]:not([data-askdown-manual])')) {
    const ctrl = initForm(/** @type {HTMLFormElement} */ (el));
    if (ctrl) result.push(ctrl);
  }
  return result;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll(), { once: true });
  } else {
    initAll();
  }
}
