/**
 * Server-side (isomorphic) rendering of an Askdown form to HTML.
 *
 * No DOM or Node APIs are used, so this runs on Cloudflare Workers, in the
 * browser (the builder preview) and in Node. Every piece of user content is
 * escaped with escapeHtml() or rendered with the safe Markdown renderer from
 * the core package.
 */
import {
  type AddressPart,
  type AddressQuestion,
  addressFormat,
  type Cell,
  type CheckboxQuestion,
  choiceValue,
  COUNTRY_CODES,
  countryForPhone,
  countryName,
  escapeHtml,
  flagEmoji,
  isCountryCode,
  type FileQuestion,
  type Form,
  formatSize,
  type GridQuestion,
  isQuestion,
  type Page,
  PHONE_CODES,
  type PhoneQuestion,
  type Question,
  type RadioQuestion,
  type RankingQuestion,
  type RatingQuestion,
  renderMarkdown,
  type ScaleQuestion,
  type SelectQuestion,
} from '@askdown/core';
import { OTHER_VALUE, type RenderOptions } from './index.ts';

/** The star used by rating questions. */
const STAR_PATH =
  'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z';

interface Ctx {
  prefix: string;
  values: Record<string, unknown> | undefined;
  errors: Record<string, string>;
}

const esc = escapeHtml;

/** Renders an attribute when the value is defined (and true for booleans). */
function attr(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === false || value === null) return '';
  if (value === true) return ` ${name}`;
  return ` ${name}="${esc(String(value))}"`;
}

function elementId(ctx: Ctx, ...parts: (string | number)[]): string {
  return [ctx.prefix, ...parts].map((p) => String(p)).join('-');
}

function hasError(ctx: Ctx, id: string): boolean {
  return typeof ctx.errors[id] === 'string' && ctx.errors[id] !== '';
}

function describedBy(ctx: Ctx, q: { id: string; help?: string }): string {
  const ids = [];
  if (q.help) ids.push(elementId(ctx, q.id, 'help'));
  ids.push(elementId(ctx, q.id, 'error'));
  return ids.join(' ');
}

/** Attributes shared by every input of a question. */
function inputState(ctx: Ctx, q: { id: string; help?: string }): string {
  return attr('aria-describedby', describedBy(ctx, q)) + attr('aria-invalid', hasError(ctx, q.id) ? 'true' : undefined);
}

/** The raw value for a question: from `values` when given, otherwise undefined. */
function valueOf(ctx: Ctx, id: string): unknown {
  return ctx.values ? ctx.values[id] : undefined;
}

function stringValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function listValue(v: unknown): string[] {
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

type Sentiment = 'positive' | 'neutral' | 'negative';

const SENTIMENT_FLAGS: readonly Sentiment[] = ['positive', 'neutral', 'negative'];
const SENTIMENT_VALUES: Record<string, Sentiment> = { yes: 'positive', maybe: 'neutral', no: 'negative' };

/**
 * The sentiment of an option or grid column (spec §3.3): a "positive",
 * "neutral" or "negative" flag wins; otherwise a value of "yes", "maybe" or
 * "no" (case-insensitive) implies one. Rows have no sentiment.
 */
export function sentimentOf(choice: Cell): Sentiment | undefined {
  const flagged = choice.flags?.find((f): f is Sentiment => (SENTIMENT_FLAGS as readonly string[]).includes(f));
  return flagged ?? SENTIMENT_VALUES[choiceValue(choice).toLowerCase()];
}

/**
 * The presentation hooks of a selectable choice (an option, or a grid column
 * and its cells): the classes `askdown-sentiment-<s>` when it has a sentiment
 * and `askdown-flag-<flag>` for each other flag, plus the attributes
 * `data-value="<value>"` and, when there are other flags, `data-flags="a b"`.
 * A flag only becomes a class when it is safe as one (lowercase letters,
 * digits and dashes; the parser already lowercases flags).
 */
function flagAttrs(choice: Cell, { withValue = true } = {}): { classes: string[]; attrs: string } {
  const classes: string[] = [];
  const sentiment = sentimentOf(choice);
  if (sentiment) classes.push(`askdown-sentiment-${sentiment}`);
  const others = (choice.flags ?? []).filter((f) => !(SENTIMENT_FLAGS as readonly string[]).includes(f));
  for (const f of others) if (/^[a-z0-9-]+$/.test(f)) classes.push(`askdown-flag-${f}`);
  return {
    classes,
    attrs: (withValue ? attr('data-value', choiceValue(choice)) : '') + attr('data-flags', others.length ? others.join(' ') : undefined),
  };
}

/** `class="…"` for the classes of flagAttrs(), or nothing when there are none. */
function classAttr(base: string | undefined, classes: string[]): string {
  const all = base ? [base, ...classes] : classes;
  return all.length ? ` class="${all.join(' ')}"` : '';
}

function requiredMark(q: { required?: boolean }, describe: boolean): string {
  if (!q.required) return '';
  return (
    `<span class="askdown-required" aria-hidden="true">*</span>` +
    (describe ? `<span class="askdown-sr-only"> (required)</span>` : '')
  );
}

function helpHtml(ctx: Ctx, q: { id: string; help?: string }): string {
  if (!q.help) return '';
  return `<div class="askdown-help" id="${esc(elementId(ctx, q.id, 'help'))}">${renderMarkdown(q.help)}</div>`;
}

function errorHtml(ctx: Ctx, id: string): string {
  const message = hasError(ctx, id) ? ctx.errors[id]! : '';
  return `<p class="askdown-error" id="${esc(elementId(ctx, id, 'error'))}"${message ? '' : ' hidden'}>${esc(message)}</p>`;
}

/** Wraps the parts of a single-input question: label, help, control, error. */
function single(ctx: Ctx, q: Question, control: string, extra = ''): string {
  const inputId = elementId(ctx, q.id);
  return (
    `<label class="askdown-label" for="${esc(inputId)}">${esc(q.label)}${requiredMark(q, false)}</label>` +
    helpHtml(ctx, q) +
    `<div class="askdown-control">${control}${extra}</div>` +
    errorHtml(ctx, q.id)
  );
}

/** Wraps the parts of a grouped question in a fieldset with a legend. */
function grouped(ctx: Ctx, q: Question, control: string, describeRequired: boolean): string {
  return (
    `<fieldset class="askdown-fieldset"${attr('aria-describedby', describedBy(ctx, q))}${attr('aria-invalid', hasError(ctx, q.id) ? 'true' : undefined)}>` +
    `<legend class="askdown-label">${esc(q.label)}${requiredMark(q, describeRequired)}</legend>` +
    helpHtml(ctx, q) +
    `<div class="askdown-control">${control}</div>` +
    errorHtml(ctx, q.id) +
    `</fieldset>`
  );
}

function textLike(ctx: Ctx, q: Question): string {
  const id = elementId(ctx, q.id);
  const name = `q.${q.id}`;
  const value = stringValue(valueOf(ctx, q.id));
  const common = `id="${esc(id)}" name="${esc(name)}"${attr('required', q.required)}${inputState(ctx, q)}`;

  switch (q.type) {
    case 'paragraph':
      return (
        `<textarea class="askdown-input askdown-textarea" ${common} rows="4"` +
        attr('placeholder', q.placeholder) +
        attr('minlength', q.minLength) +
        attr('maxlength', q.maxLength) +
        `>${esc(value)}</textarea>`
      );
    case 'text':
      return (
        `<input class="askdown-input" type="text" ${common}` +
        attr('value', value || undefined) +
        attr('placeholder', q.placeholder) +
        attr('minlength', q.minLength) +
        attr('maxlength', q.maxLength) +
        attr('pattern', q.pattern) +
        `>`
      );
    case 'email':
      return (
        `<input class="askdown-input" type="email" ${common} autocomplete="email" inputmode="email"` +
        attr('value', value || undefined) +
        attr('placeholder', q.placeholder) +
        `>`
      );
    case 'url':
      return (
        `<input class="askdown-input" type="url" ${common} inputmode="url"` +
        attr('value', value || undefined) +
        attr('placeholder', q.placeholder) +
        `>`
      );
    case 'number':
      return (
        `<input class="askdown-input askdown-input--number" type="number" ${common} inputmode="decimal"` +
        attr('value', value || undefined) +
        attr('placeholder', q.placeholder) +
        attr('min', q.min) +
        attr('max', q.max) +
        attr('step', q.step ?? 'any') +
        `>`
      );
    case 'date':
      return (
        `<input class="askdown-input askdown-input--date" type="date" ${common}` +
        attr('value', value || undefined) +
        attr('min', q.min) +
        attr('max', q.max) +
        `>`
      );
    case 'time':
      return (
        `<input class="askdown-input askdown-input--time" type="time" ${common}` +
        attr('value', value || undefined) +
        attr('min', q.min) +
        attr('max', q.max) +
        `>`
      );
    default:
      return '';
  }
}

interface ChoiceState {
  selected: Set<string>;
  other: boolean;
  otherText: string;
}

/** Works out which options are selected: from `values`, or from defaults. */
function choiceState(ctx: Ctx, q: RadioQuestion | CheckboxQuestion | SelectQuestion): ChoiceState {
  const state: ChoiceState = { selected: new Set(), other: false, otherText: '' };
  if (ctx.values) {
    const raw = valueOf(ctx, q.id);
    const list = q.type === 'checkbox' ? listValue(raw) : [stringValue(raw)].filter(Boolean);
    for (const v of list) {
      if (q.options.some((o) => choiceValue(o) === v)) {
        state.selected.add(v);
      } else if (q.type !== 'select' && q.other !== undefined) {
        state.other = true;
        state.otherText = v;
      }
    }
    if (q.type !== 'select' && !state.other && raw === OTHER_VALUE) state.other = true;
  } else {
    for (const o of q.options) if (o.default) state.selected.add(choiceValue(o));
  }
  return state;
}

function choiceOptions(ctx: Ctx, q: RadioQuestion | CheckboxQuestion): string {
  const kind = q.type === 'radio' ? 'radio' : 'checkbox';
  const name = `q.${q.id}`;
  const state = choiceState(ctx, q);
  // Native `required` on a checkbox means "this box must be checked", so it
  // only applies to radios; checkbox groups are validated by the runtime and
  // the server.
  const required = q.type === 'radio' && q.required;
  const invalid = hasError(ctx, q.id) ? ' aria-invalid="true"' : '';

  let html = `<div class="askdown-options"${attr('data-shuffle', q.shuffle)}>`;
  q.options.forEach((o, i) => {
    const id = elementId(ctx, q.id, `o${i}`);
    const value = choiceValue(o);
    const flags = flagAttrs(o);
    html +=
      `<div${classAttr('askdown-option', flags.classes)}${flags.attrs}>` +
      `<input class="askdown-choice" type="${kind}" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"` +
      attr('checked', state.selected.has(value)) +
      attr('required', required) +
      attr('data-goto', o.goto) +
      invalid +
      `>` +
      `<label class="askdown-option-label" for="${esc(id)}">${esc(o.label)}</label>` +
      `</div>`;
  });
  if (q.other !== undefined) {
    const id = elementId(ctx, q.id, 'other');
    const labelId = `${id}-label`;
    html +=
      `<div class="askdown-option askdown-option--other">` +
      `<input class="askdown-choice" type="${kind}" id="${esc(id)}" name="${esc(name)}" value="${OTHER_VALUE}"` +
      attr('checked', state.other) +
      attr('required', required) +
      invalid +
      `>` +
      `<label class="askdown-option-label" id="${esc(labelId)}" for="${esc(id)}">${esc(q.other)}</label>` +
      `<input class="askdown-input askdown-other-input" type="text" name="${esc(name)}.other" aria-labelledby="${esc(labelId)}"` +
      attr('value', state.otherText || undefined) +
      `>` +
      `</div>`;
  }
  return html + `</div>`;
}

function selectHtml(ctx: Ctx, q: SelectQuestion): string {
  const id = elementId(ctx, q.id);
  const state = choiceState(ctx, q);
  let html =
    `<select class="askdown-input askdown-select" id="${esc(id)}" name="q.${esc(q.id)}"` +
    attr('required', q.required) +
    attr('data-shuffle', q.shuffle) +
    inputState(ctx, q) +
    `>` +
    `<option value=""${state.selected.size ? '' : ' selected'}>Choose…</option>`;
  for (const o of q.options) {
    const value = choiceValue(o);
    // The value attribute already carries the value, so no data-value here.
    const flags = flagAttrs(o, { withValue: false });
    html +=
      `<option value="${esc(value)}"` +
      attr('selected', state.selected.has(value)) +
      attr('data-goto', o.goto) +
      classAttr(undefined, flags.classes) +
      flags.attrs +
      `>${esc(o.label)}</option>`;
  }
  return html + `</select>`;
}

function scaleHtml(ctx: Ctx, q: ScaleQuestion): string {
  const current = stringValue(valueOf(ctx, q.id));
  const invalid = hasError(ctx, q.id) ? ' aria-invalid="true"' : '';
  let html = `<div class="askdown-scale">`;
  if (q.minLabel !== undefined) html += `<span class="askdown-scale-label askdown-scale-label--min">${esc(q.minLabel)}</span>`;
  html += `<div class="askdown-scale-options">`;
  for (let n = q.min; n <= q.max; n++) {
    const id = elementId(ctx, q.id, `v${n}`);
    html +=
      `<label class="askdown-scale-option" for="${esc(id)}">` +
      `<input type="radio" id="${esc(id)}" name="q.${esc(q.id)}" value="${n}"` +
      attr('checked', current !== '' && Number(current) === n) +
      attr('required', q.required) +
      invalid +
      `>` +
      `<span class="askdown-scale-value">${n}</span>` +
      `</label>`;
  }
  html += `</div>`;
  if (q.maxLabel !== undefined) html += `<span class="askdown-scale-label askdown-scale-label--max">${esc(q.maxLabel)}</span>`;
  return html + `</div>`;
}

function ratingHtml(ctx: Ctx, q: RatingQuestion): string {
  const current = stringValue(valueOf(ctx, q.id));
  const invalid = hasError(ctx, q.id) ? ' aria-invalid="true"' : '';
  let html = `<div class="askdown-rating">`;
  for (let n = 1; n <= q.max; n++) {
    const id = elementId(ctx, q.id, `v${n}`);
    html +=
      `<input class="askdown-rating-input" type="radio" id="${esc(id)}" name="q.${esc(q.id)}" value="${n}"` +
      attr('checked', current !== '' && Number(current) === n) +
      attr('required', q.required) +
      invalid +
      `>` +
      `<label class="askdown-rating-star" for="${esc(id)}" title="${n} of ${q.max}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>` +
      `<span class="askdown-sr-only">${n} of ${q.max}</span>` +
      `</label>`;
  }
  return html + `</div>`;
}

/**
 * Ranking, no-JS baseline: one row per option with a select for its rank
 * (empty = unranked). The runtime turns this into a click-to-rank widget and
 * keeps the selects in sync, so the submission is the same either way.
 *
 * Every row is rendered unranked unless `values` holds an answer, so the
 * initial order never counts as a ranking.
 */
function rankingHtml(ctx: Ctx, q: RankingQuestion): string {
  const name = `q.${q.id}`;
  const invalid = hasError(ctx, q.id) ? ' aria-invalid="true"' : '';
  const count = q.options.length;
  // A string[] answer lists the option values highest ranked first, so the
  // rank of a value is its position. Only the first occurrence counts.
  const rankOf = new Map<string, number>();
  listValue(valueOf(ctx, q.id)).forEach((value, i) => {
    if (!rankOf.has(value)) rankOf.set(value, i + 1);
  });

  let html = `<div class="askdown-ranking"${attr('data-shuffle', q.shuffle)}>`;
  q.options.forEach((o, i) => {
    const id = elementId(ctx, q.id, `r${i}`);
    const current = rankOf.get(choiceValue(o));
    const flags = flagAttrs(o);
    let options = `<option value=""${current === undefined ? ' selected' : ''}>–</option>`;
    for (let rank = 1; rank <= count; rank++) {
      options += `<option value="${rank}"${attr('selected', current === rank)}>${rank}</option>`;
    }
    html +=
      `<div${classAttr('askdown-ranking-option', flags.classes)} data-index="${i}"${flags.attrs}>` +
      `<label class="askdown-ranking-option-label" for="${esc(id)}">${esc(o.label)}</label>` +
      `<select class="askdown-input askdown-select askdown-ranking-select" id="${esc(id)}" name="${esc(`${name}.${i}`)}" aria-label="${esc(`Rank for ${o.label}`)}"` +
      invalid +
      `>${options}</select>` +
      `</div>`;
  });
  return html + `</div>`;
}

function gridHtml(ctx: Ctx, q: GridQuestion): string {
  const multi = q.type === 'checkbox-grid';
  const kind = multi ? 'checkbox' : 'radio';
  const raw = valueOf(ctx, q.id);
  const answers: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const invalid = hasError(ctx, q.id) ? ' aria-invalid="true"' : '';

  // Columns carry the sentiment and flags; rows only their value.
  const columns = q.columns.map((col) => ({ col, value: choiceValue(col), flags: flagAttrs(col) }));

  let html = `<div class="askdown-grid-scroll"><table class="askdown-grid"><thead><tr><td></td>`;
  for (const { col, flags } of columns) html += `<th scope="col"${classAttr(undefined, flags.classes)}${flags.attrs}>${esc(col.label)}</th>`;
  html += `</tr></thead><tbody>`;
  q.rows.forEach((row, r) => {
    const name = `q.${q.id}.${r}`;
    const chosen = new Set(listValue(answers[choiceValue(row)]));
    html += `<tr><th scope="row" data-value="${esc(choiceValue(row))}">${esc(row.label)}</th>`;
    columns.forEach(({ col, value, flags }, c) => {
      const id = elementId(ctx, q.id, `r${r}c${c}`);
      html +=
        `<td><label${classAttr('askdown-grid-cell', flags.classes)} for="${esc(id)}"${flags.attrs}>` +
        `<input class="askdown-choice" type="${kind}" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"` +
        attr('checked', chosen.has(value)) +
        attr('required', !multi && q.required) +
        invalid +
        `>` +
        `<span class="askdown-sr-only">${esc(row.label)}: ${esc(col.label)}</span>` +
        `</label></td>`;
    });
    html += `</tr>`;
  });
  return html + `</tbody></table></div>`;
}

function fileHtml(ctx: Ctx, q: FileQuestion): string {
  const id = elementId(ctx, q.id);
  const maxFiles = q.maxFiles ?? 1;
  const hints: string[] = [];
  if (maxFiles > 1) hints.push(`Up to ${maxFiles} files`);
  if (q.maxSize !== undefined) hints.push(`${formatSize(q.maxSize)} max${maxFiles > 1 ? ' each' : ''}`);
  if (q.accept?.length) hints.push(q.accept.join(', '));
  const prev = valueOf(ctx, q.id);
  const previous = Array.isArray(prev) && prev.length > 0;

  const control =
    `<input class="askdown-file" type="file" id="${esc(id)}" name="q.${esc(q.id)}"` +
    attr('required', q.required) +
    attr('accept', q.accept?.length ? q.accept.join(',') : undefined) +
    attr('multiple', maxFiles > 1) +
    attr('data-max-files', maxFiles) +
    attr('data-max-size', q.maxSize) +
    inputState(ctx, q) +
    `>`;
  let extra = '';
  if (hints.length) extra += `<p class="askdown-hint">${esc(hints.join(' · '))}</p>`;
  if (previous) extra += `<p class="askdown-hint askdown-hint--refile">Please choose your file${maxFiles > 1 ? 's' : ''} again.</p>`;
  return single(ctx, q, control, extra);
}

/** Country codes sorted by their display name, computed once at module load. */
const SORTED_COUNTRIES: readonly string[] = [...COUNTRY_CODES].sort((a, b) => countryName(a).localeCompare(countryName(b)));

const PART_AUTOCOMPLETE: Record<AddressPart, string> = {
  street: 'street-address',
  city: 'address-level2',
  region: 'address-level1',
  postalCode: 'postal-code',
};

const PART_CLASS: Record<AddressPart, string> = {
  street: 'street',
  city: 'city',
  region: 'region',
  postalCode: 'postal-code',
};

/** Postal code and city share a row when the country's format puts them next to each other. */
function isRowPair(a: AddressPart, b: AddressPart | undefined): boolean {
  return (a === 'postalCode' && b === 'city') || (a === 'city' && b === 'postalCode');
}

export interface AddressPartsOptions {
  /** Prefix for element ids; the same as RenderOptions.idPrefix. Defaults to "askdown". */
  idPrefix?: string;
  /** Marks every part aria-invalid (the question has an error). */
  invalid?: boolean;
}

/**
 * Renders the parts of an address after the country (street, city, region,
 * postal code), in the order and with the labels of that country's format.
 * The runtime calls this again when the respondent picks another country.
 *
 * `country` is an ISO 3166-1 alpha-2 code; undefined or "" gives the generic
 * format. `values` holds the current part values, keyed by part name.
 */
export function addressPartsHtml(
  q: AddressQuestion,
  country: string | undefined,
  values?: Record<string, unknown>,
  options: AddressPartsOptions = {},
): string {
  const ctx: Ctx = { prefix: options.idPrefix || 'askdown', values: undefined, errors: {} };
  const code = (country ?? '').toUpperCase();
  const format = addressFormat(code || undefined);
  const part = (key: AddressPart) => stringValue(values?.[key]);
  const invalid = options.invalid ? ' aria-invalid="true"' : '';
  // Every part points at the question's error message, so a screen reader
  // hears it on whichever field it lands on.
  const describedBy = attr('aria-describedby', elementId(ctx, q.id, 'error'));

  const field = (key: AddressPart): string => {
    const id = elementId(ctx, q.id, key);
    const name = `q.${q.id}.${key}`;
    // Only a required question requires its parts; core still checks the
    // parts of an optional address once anything is filled in.
    const required = q.required === true && format.required.includes(key);
    const common =
      `id="${esc(id)}" name="${esc(name)}" autocomplete="${PART_AUTOCOMPLETE[key]}"` +
      attr('required', required) +
      describedBy +
      invalid;
    const value = part(key);

    let control: string;
    if (key === 'street') {
      control = `<textarea class="askdown-input askdown-textarea askdown-textarea--address" ${common} rows="2">${esc(value)}</textarea>`;
    } else if (key === 'region' && format.regions) {
      // Accept a code in any case, or a region name (typed before the
      // country was chosen, or filled in by the browser).
      const upper = value.toUpperCase();
      const lower = value.trim().toLowerCase();
      const selected = format.regions.some(([c]) => c === upper)
        ? upper
        : (format.regions.find(([, n]) => n.toLowerCase() === lower)?.[0] ?? '');
      control = `<select class="askdown-input askdown-select" ${common}><option value=""${selected ? '' : ' selected'}>Choose…</option>`;
      for (const [regionCode, regionName] of format.regions) {
        control += `<option value="${esc(regionCode)}"${attr('selected', selected === regionCode)}>${esc(regionName)}</option>`;
      }
      control += `</select>`;
    } else if (key === 'postalCode' && format.postalCodeRule) {
      // Hint at the country's form of postal code; core normalizes whatever is typed.
      const rule = format.postalCodeRule;
      control =
        `<input class="askdown-input" type="text" ${common}` +
        attr('placeholder', rule.example) +
        (rule.numeric ? ' inputmode="numeric"' : ' autocapitalize="characters"') +
        attr('value', value || undefined) +
        `>`;
    } else {
      control = `<input class="askdown-input" type="text" ${common}${attr('value', value || undefined)}>`;
    }

    return (
      `<div class="askdown-address-field askdown-address-field--${PART_CLASS[key]}">` +
      `<label class="askdown-label" for="${esc(id)}">${esc(format.labels[key])}</label>` +
      control +
      `</div>`
    );
  };

  let html = `<div class="askdown-address-parts" data-country="${esc(code)}">`;
  for (let i = 0; i < format.parts.length; i++) {
    const current = format.parts[i]!;
    const next = format.parts[i + 1];
    if (next !== undefined && isRowPair(current, next)) {
      html += `<div class="askdown-address-row">${field(current)}${field(next)}</div>`;
      i++;
    } else {
      html += field(current);
    }
  }
  return html + `</div>`;
}

function addressHtml(ctx: Ctx, q: AddressQuestion): string {
  const raw = valueOf(ctx, q.id);
  const values: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const invalid = hasError(ctx, q.id);

  let html = `<div class="askdown-address">`;
  let country = q.country;

  // The country comes first because it decides which parts follow.
  if (country === undefined) {
    const countryId = elementId(ctx, q.id, 'country');
    const current = stringValue(values.country).toUpperCase();
    if (isCountryCode(current)) country = current;
    let options = `<option value=""${country ? '' : ' selected'}>Choose…</option>`;
    for (const code of SORTED_COUNTRIES) {
      options += `<option value="${esc(code)}"${attr('selected', country === code)}>${esc(countryName(code))}</option>`;
    }
    html +=
      `<div class="askdown-address-field askdown-address-field--country">` +
      `<label class="askdown-label" for="${esc(countryId)}">Country</label>` +
      `<select class="askdown-input askdown-select" id="${esc(countryId)}" name="${esc(`q.${q.id}.country`)}" autocomplete="country"` +
      attr('required', q.required) +
      attr('aria-describedby', elementId(ctx, q.id, 'error')) +
      attr('aria-invalid', invalid ? 'true' : undefined) +
      `>${options}</select>` +
      `</div>`;
  }

  html += addressPartsHtml(q, country, values, { idPrefix: ctx.prefix, invalid });
  return html + `</div>`;
}

/** Countries with a calling code, sorted by their display name, computed once at module load. */
const SORTED_PHONE_COUNTRIES: readonly string[] = Object.keys(PHONE_CODES).sort((a, b) =>
  countryName(a).localeCompare(countryName(b)),
);

/** Shown in the country slot when no country is selected. */
const NO_COUNTRY_FLAG = '\u{1F310}'; // 🌐

/**
 * A stored E.164 number split back into the country and the national part
 * the respondent typed, so "+31612345678" re-fills as 🇳🇱 +31 | 612345678.
 * Anything that isn't E.164 (raw text kept by readAnswers after a failed
 * conversion) is shown as typed.
 */
function splitPhone(value: string): { country: string | undefined; number: string } {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+')) return { country: undefined, number: trimmed };
  const country = countryForPhone(trimmed.replace(/[^\d+]/g, ''));
  if (country === undefined) return { country: undefined, number: trimmed };
  const code = `+${PHONE_CODES[country]}`;
  const national = /^\+\d+$/.test(trimmed) ? trimmed.slice(code.length) : '';
  // A number with spaces or other punctuation is shown as typed.
  return national ? { country, number: national } : { country, number: trimmed };
}

/**
 * Phone: a country picker and a national number, joined into one control.
 *
 * The picker is a native select (accessible, and a real picker on mobile)
 * whose options read "🇳🇱 Netherlands +31". The runtime overlays a compact
 * label ("🇳🇱 +31") on top of it and keeps that in sync, so the closed control
 * stays short while the open list still has the full names. Without the
 * runtime the select is shown as is.
 */
function phoneHtml(ctx: Ctx, q: PhoneQuestion): string {
  const id = elementId(ctx, q.id);
  const countryId = elementId(ctx, q.id, 'country');
  const name = `q.${q.id}`;
  const invalid = hasError(ctx, q.id);

  const raw = stringValue(valueOf(ctx, q.id));
  const split = ctx.values ? splitPhone(raw) : { country: undefined, number: '' };
  let country = split.country ?? q.country ?? '';
  if (PHONE_CODES[country] === undefined) country = '';

  let options = `<option value=""${country ? '' : ' selected'}>Country</option>`;
  for (const code of SORTED_PHONE_COUNTRIES) {
    options +=
      `<option value="${esc(code)}"${attr('selected', country === code)}>` +
      `${flagEmoji(code)} ${esc(countryName(code))} +${PHONE_CODES[code]}` +
      `</option>`;
  }

  return (
    `<div class="askdown-phone">` +
    `<span class="askdown-phone-country">` +
    `<select class="askdown-phone-select" id="${esc(countryId)}" name="${esc(`${name}.country`)}" autocomplete="tel-country-code" aria-label="Country"` +
    attr('aria-describedby', elementId(ctx, q.id, 'error')) +
    attr('aria-invalid', invalid ? 'true' : undefined) +
    `>${options}</select>` +
    // The compact label the runtime shows over the select; hidden until then.
    `<span class="askdown-phone-label" aria-hidden="true">` +
    `<span class="askdown-phone-flag">${country ? flagEmoji(country) : NO_COUNTRY_FLAG}</span>` +
    `<span class="askdown-phone-code">${country ? `+${PHONE_CODES[country]}` : ''}</span>` +
    `</span>` +
    `</span>` +
    `<input class="askdown-input askdown-phone-input" type="tel" id="${esc(id)}" name="${esc(name)}" autocomplete="tel-national" inputmode="tel"` +
    attr('required', q.required) +
    inputState(ctx, q) +
    attr('value', split.number || undefined) +
    attr('placeholder', q.placeholder) +
    `>` +
    `</div>`
  );
}

function questionHtml(ctx: Ctx, q: Question): string {
  let inner: string;
  switch (q.type) {
    case 'text':
    case 'paragraph':
    case 'email':
    case 'url':
    case 'number':
    case 'date':
    case 'time':
      inner = single(ctx, q, textLike(ctx, q));
      break;
    case 'radio':
      inner = grouped(ctx, q, choiceOptions(ctx, q), false);
      break;
    case 'checkbox':
      inner = grouped(ctx, q, choiceOptions(ctx, q), true);
      break;
    case 'select':
      inner = single(ctx, q, selectHtml(ctx, q));
      break;
    case 'scale':
      inner = grouped(ctx, q, scaleHtml(ctx, q), false);
      break;
    case 'rating':
      inner = grouped(ctx, q, ratingHtml(ctx, q), false);
      break;
    case 'ranking':
      inner = grouped(ctx, q, rankingHtml(ctx, q), true);
      break;
    case 'grid':
      inner = grouped(ctx, q, gridHtml(ctx, q), false);
      break;
    case 'checkbox-grid':
      inner = grouped(ctx, q, gridHtml(ctx, q), true);
      break;
    case 'file':
      inner = fileHtml(ctx, q);
      break;
    case 'address':
      inner = grouped(ctx, q, addressHtml(ctx, q), false);
      break;
    case 'phone':
      inner = single(ctx, q, phoneHtml(ctx, q));
      break;
  }
  const classes = ['askdown-question', `askdown-question--${q.type}`];
  if (hasError(ctx, q.id)) classes.push('askdown-question--invalid');
  return (
    `<div class="${classes.join(' ')}" data-question-id="${esc(q.id)}" data-type="${q.type}"` +
    attr('data-required', q.required) +
    `>${inner}</div>`
  );
}

function pageHtml(ctx: Ctx, page: Page, index: number): string {
  const titleId = elementId(ctx, 'page', index, 'title');
  let html =
    `<section class="askdown-page" data-page-id="${esc(page.id)}" data-page-index="${index}"` +
    attr('aria-labelledby', page.title ? titleId : undefined) +
    attr('aria-label', page.title ? undefined : `Page ${index + 1}`) +
    attr('data-next', page.next) +
    `>`;
  if (page.title) html += `<h2 class="askdown-page-title" id="${esc(titleId)}">${esc(page.title)}</h2>`;
  const headingOffset = page.title ? 2 : 1;
  for (const item of page.items) {
    if (isQuestion(item)) {
      html += questionHtml(ctx, item);
    } else {
      html += `<div class="askdown-content">${renderMarkdown(item.markdown, { headingOffset })}</div>`;
    }
  }
  return html + `</section>`;
}

function errorSummaryHtml(ctx: Ctx, form: Form): string {
  const labels = new Map<string, string>();
  for (const page of form.pages) for (const item of page.items) if (isQuestion(item)) labels.set(item.id, item.label);
  const entries = Object.entries(ctx.errors).filter(([id, msg]) => msg && labels.has(id));
  if (!entries.length) return '';
  let html =
    `<div class="askdown-error-summary" role="alert" tabindex="-1">` +
    `<p class="askdown-error-summary-title">Please fix the following ${entries.length === 1 ? 'problem' : `${entries.length} problems`}:</p><ul>`;
  for (const [id, msg] of entries) {
    html += `<li><a href="#${esc(elementId(ctx, id))}">${esc(labels.get(id)!)}</a>: ${esc(msg)}</li>`;
  }
  return html + `</ul></div>`;
}

/** Serializes the form model into a <script type="application/json"> body. */
export function definitionJson(form: Form): string {
  // "<" is escaped so that a label containing "</script>" cannot end the
  // script element. JSON.parse() reads \u003c back as "<".
  return JSON.stringify(form)
    .split('<')
    .join('\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Renders a complete <form> element (with an embedded JSON definition for the runtime). */
export function renderForm(form: Form, options: RenderOptions = {}): string {
  const ctx: Ctx = {
    prefix: options.idPrefix || 'askdown',
    values: options.values,
    errors: options.errors ?? {},
  };
  const submitLabel = form.settings?.submitLabel || 'Submit';

  let html =
    `<form class="askdown" data-askdown method="post" enctype="multipart/form-data" action="${esc(options.action ?? '')}"` +
    attr('data-preview', options.preview) +
    attr('data-id-prefix', ctx.prefix) +
    // Native validation can't follow jumps, so multi-page forms rely on the
    // server (and the runtime) instead.
    attr('novalidate', form.pages.length > 1) +
    `>`;

  if (form.title || form.description) {
    html += `<header class="askdown-header">`;
    if (form.title) html += `<h1 class="askdown-title">${esc(form.title)}</h1>`;
    if (form.description) html += `<div class="askdown-description">${renderMarkdown(form.description, { headingOffset: 1 })}</div>`;
    html += `</header>`;
  }

  html += errorSummaryHtml(ctx, form);
  html += `<div class="askdown-live askdown-sr-only" aria-live="polite" aria-atomic="true"></div>`;

  html += `<div class="askdown-pages">`;
  form.pages.forEach((page, i) => {
    html += pageHtml(ctx, page, i);
  });
  html += `</div>`;

  for (const [name, value] of Object.entries(options.hidden ?? {})) {
    html += `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
  }
  html +=
    `<div class="askdown-hp" hidden aria-hidden="true">` +
    `<label for="${esc(elementId(ctx, '_hp'))}">Leave this field empty</label>` +
    `<input type="text" id="${esc(elementId(ctx, '_hp'))}" name="_hp" tabindex="-1" autocomplete="off">` +
    `</div>`;

  html +=
    `<div class="askdown-actions">` +
    `<button type="submit" class="askdown-button askdown-button--primary askdown-submit">${esc(submitLabel)}</button>` +
    `</div>`;

  html += `<script type="application/json" class="askdown-definition">${definitionJson(form)}</script>`;
  return html + `</form>`;
}

/** Renders the post-submit confirmation block (settings.confirmation Markdown or a default). */
export function renderConfirmation(form: Form): string {
  const body = form.settings?.confirmation
    ? renderMarkdown(form.settings.confirmation, { headingOffset: 1 })
    : '<p>Your response has been recorded.</p>';
  return (
    `<div class="askdown askdown-confirmation" role="status">` +
    `<div class="askdown-confirmation-icon" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `</div>` +
    (form.title ? `<h1 class="askdown-title">${esc(form.title)}</h1>` : '') +
    `<div class="askdown-confirmation-body">${body}</div>` +
    `</div>`
  );
}
