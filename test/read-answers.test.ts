import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Form, parse, validateResponse } from '@askdown/core';
import { describe, expect, it } from 'vitest';
import { OTHER_VALUE, readAnswers, renderForm } from '../src/index.ts';

const EXAMPLES = join(import.meta.dirname, '../vendor/spec/examples');

function load(name: string): Form {
  return parse(readFileSync(join(EXAMPLES, name), 'utf8')).form;
}

/** Builds a FormData the way a browser would submit the rendered form. */
function formData(entries: [string, string | File][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

/** The HTML of one question. */
function section(html: string, id: string): string {
  const start = html.indexOf(`data-question-id="${id}"`);
  const end = html.indexOf('<div class="askdown-question', start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

/** Every field name the rendered form would submit (including empty text fields). */
function renderedNames(form: Form): Set<string> {
  return new Set([...renderForm(form).matchAll(/ name="([^"]+)"/g)].map((m) => m[1]!));
}

describe('readAnswers', () => {
  const allTypes = load('all-types.ask');
  const rsvp = load('rsvp.ask');

  it('round-trips every question type through validateResponse', () => {
    const pdf = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
    const docx = new File(['PK'], 'letter.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const data = formData([
      ['q.short', 'Hello there'],
      ['q.long', 'This is long enough.'],
      ['q.website', 'https://example.com'],
      ['q.phone.country', 'NL'],
      ['q.phone', '06 1234 5678'],
      ['q.age', '42'],
      ['q.birthday', '1990-12-24'],
      ['q.preferred-time', '09:30'],
      ['q.favorite-color', OTHER_VALUE],
      ['q.favorite-color.other', ' Teal '],
      ['q.toppings', 'Olives'],
      ['q.toppings', 'Cheese'],
      ['q.country', 'Canada'],
      ['q.overall', '8'],
      ['q.rank-these-features.0', '3'],
      ['q.rank-these-features.1', '1'],
      ['q.rank-these-features.2', '2'],
      ['q.availability.0', 'Morning'],
      ['q.availability.1', 'Morning'],
      ['q.availability.1', 'Afternoon'],
      ['q.home-address.street', '1 Main St'],
      ['q.home-address.city', 'Springfield'],
      ['q.home-address.region', 'IL'],
      ['q.home-address.postalCode', '62704'],
      ['q.home-address.country', 'US'],
      ['q.delivery-address.street', 'Damstraat 1'],
      ['q.delivery-address.city', 'Amsterdam'],
      ['q.delivery-address.postalCode', '1012 JS'],
      ['q.resume', pdf],
      ['q.resume', docx],
      ['_hp', ''],
    ]);
    const names = renderedNames(allTypes);
    for (const key of data.keys()) expect(names, key).toContain(key);

    const read = readAnswers(allTypes, data);
    expect(read.spam).toBe(false);
    expect(read.answers).toEqual({
      short: 'Hello there',
      long: 'This is long enough.',
      website: 'https://example.com',
      phone: '+31612345678',
      age: '42',
      birthday: '1990-12-24',
      'preferred-time': '09:30',
      'favorite-color': 'Teal',
      toppings: ['Olives', 'Cheese'],
      country: 'Canada',
      overall: '8',
      'rank-these-features': ['Offline sync', 'Export', 'Dark mode'],
      availability: { Monday: ['Morning'], Tuesday: ['Morning', 'Afternoon'] },
      'home-address': { street: '1 Main St', city: 'Springfield', region: 'IL', postalCode: '62704', country: 'US' },
      'delivery-address': { street: 'Damstraat 1', city: 'Amsterdam', postalCode: '1012 JS' },
      resume: [
        { name: 'cv.pdf', size: 8, type: 'application/pdf' },
        { name: 'letter.docx', size: 2, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
    });
    expect(read.files).toEqual({ resume: [pdf, docx] });

    const result = validateResponse(allTypes, read.answers);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.answers).toEqual({
      short: 'Hello there',
      long: 'This is long enough.',
      website: 'https://example.com',
      phone: '+31612345678',
      age: 42,
      birthday: '1990-12-24',
      'preferred-time': '09:30',
      'favorite-color': 'Teal',
      toppings: ['Cheese', 'Olives'],
      country: 'Canada',
      overall: 8,
      'rank-these-features': ['Offline sync', 'Export', 'Dark mode'],
      availability: { Monday: ['Morning'], Tuesday: ['Morning', 'Afternoon'] },
      'home-address': { street: '1 Main St', city: 'Springfield', region: 'IL', postalCode: '62704', country: 'US' },
      'delivery-address': { street: 'Damstraat 1', city: 'Amsterdam', postalCode: '1012 JS', country: 'NL' },
      resume: [
        { name: 'cv.pdf', size: 8, type: 'application/pdf' },
        { name: 'letter.docx', size: 2, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
    });
  });

  it('handles radio grids, scales, checkbox other and page jumps', () => {
    const data = formData([
      ['q.full-name', 'Ada'],
      ['q.email', 'ada@example.com'],
      ['q.will-you-attend', 'Yes'],
      ['q.which-days', 'Day 1'],
      ['q.which-days', OTHER_VALUE],
      ['q.which-days.other', "I'll decide later"],
      ['q.t-shirt-size', 'M'],
      ['q.how-excited-are-you', '5'],
      ['q.rate-the-sessions.0', 'Great'],
      ['q.rate-the-sessions.1', ''],
      ['q.anything-else', ''],
      ['q.why-not', 'Answered on the second page'],
    ]);
    const read = readAnswers(rsvp, data);
    expect(read.answers).toEqual({
      'full-name': 'Ada',
      email: 'ada@example.com',
      'will-you-attend': 'Yes',
      'which-days': ['Day 1', "I'll decide later"],
      't-shirt-size': 'M',
      'how-excited-are-you': '5',
      'rate-the-sessions': { Keynote: 'Great' },
      'why-not': 'Answered on the second page',
    });
    const result = validateResponse(rsvp, read.answers);
    expect(result.valid).toBe(true);
    // "Yes" ends the form after the first page, so the second page's answer is dropped.
    expect(result.pages).toEqual([0]);
    expect(result.answers['why-not']).toBeUndefined();
    expect(result.answers['which-days']).toEqual(['Day 1', "I'll decide later"]);
    expect(result.answers['how-excited-are-you']).toBe(5);
  });

  it('drops answers from pages skipped by a jump', () => {
    const branching = load('branching.ask');
    const data = formData([
      ['q.what-do-you-need-help-with', 'Billing'],
      ['q.invoice-number', 'INV-42'],
      ['q.what-happened', 'stale answer on a skipped page'],
    ]);
    const read = readAnswers(branching, data);
    expect(read.answers['what-happened']).toBe('stale answer on a skipped page');
    const result = validateResponse(branching, read.answers);
    expect(result.valid).toBe(true);
    expect(result.pages).toEqual([0, 1]);
    expect(result.answers).toEqual({ 'what-do-you-need-help-with': 'Billing', 'invoice-number': 'INV-42' });
    // Skipping the required question on the bug page is fine; landing on it is not.
    const bug = readAnswers(branching, formData([['q.what-do-you-need-help-with', 'A bug']]));
    expect(validateResponse(branching, bug.answers).errors).toEqual([{ id: 'what-happened', message: 'This question is required.' }]);
  });

  it('drops an unchecked other and empty other text', () => {
    expect(readAnswers(rsvp, formData([['q.which-days.other', 'typed but not checked']])).answers['which-days']).toBeUndefined();
    expect(readAnswers(rsvp, formData([['q.which-days', OTHER_VALUE], ['q.which-days.other', '  ']])).answers['which-days']).toBeUndefined();
    expect(readAnswers(allTypes, formData([['q.favorite-color', OTHER_VALUE], ['q.favorite-color.other', '']])).answers['favorite-color']).toBeUndefined();
    expect(readAnswers(allTypes, formData([['q.favorite-color', 'Red'], ['q.favorite-color.other', 'ignored']])).answers['favorite-color']).toBe('Red');
  });

  it('skips empty file inputs and re-fills after validation errors', () => {
    const empty = new File([], '', { type: 'application/octet-stream' });
    const read = readAnswers(allTypes, formData([['q.resume', empty]]));
    expect(read.answers['resume']).toBeUndefined();
    expect(read.files).toEqual({});
    const result = validateResponse(allTypes, read.answers);
    expect(result.errors).toContainEqual({ id: 'resume', message: 'This question is required.' });

    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    const tooBig = readAnswers(allTypes, formData([['q.resume', big]]));
    expect(validateResponse(allTypes, tooBig.answers).errors).toContainEqual({ id: 'resume', message: '"big.pdf" is larger than 5MB.' });

    // The raw answers can be fed straight back into renderForm
    const html = renderForm(allTypes, { values: tooBig.answers, errors: { resume: 'too big' } });
    expect(html).toContain('Please choose your files again.');
    expect(html).toContain('<p class="askdown-error" id="askdown-resume-error">too big</p>');
  });

  it('ignores non-file values for file questions and unknown fields', () => {
    const read = readAnswers(allTypes, formData([['q.resume', 'not a file'], ['q.unknown', 'x'], ['unrelated', 'y']]));
    expect(read.answers).toEqual({});
  });

  it('detects the honeypot', () => {
    expect(readAnswers(rsvp, formData([['_hp', 'http://spam']])).spam).toBe(true);
    expect(readAnswers(rsvp, formData([['_hp', '  ']])).spam).toBe(false);
    expect(readAnswers(rsvp, formData([])).spam).toBe(false);
  });

  it('round-trips values of options and grid cells, keyed by row value', () => {
    const form = parse(
      [
        '? Coming? *',
        '- ( ) Count me in {yes}',
        '- ( ) Sorry, no {no}',
        '- ( ) Something else: ___',
        '',
        '? Days',
        '- [ ] Monday {mon}',
        '- [ ] Tuesday {tue}',
        '',
        '? Size',
        '[select]',
        '- Small {s}',
        '- Large {l}',
        '',
        '? Order',
        '1. First {one}',
        '2. Second {two}',
        '',
        '? Feel',
        '[grid]',
        '| | Love it {yes} | Neutral {maybe} | Against {no} | N/A {na .muted} |',
        '| Dark mode {dark} |',
        '| Public API {api} |',
        '',
        '? Slots',
        '[checkbox-grid]',
        '| | Morning {am} | Afternoon {pm} |',
        '| Monday {mon} |',
        '| Tuesday {tue} |',
      ].join('\n'),
    ).form;
    // What a browser submits from the rendered form: the value attributes.
    const html = renderForm(form);
    expect(html).toContain('name="q.feel.0" value="yes"');
    expect(html).toContain('name="q.slots.1" value="pm"');
    const data = formData([
      ['q.coming', 'no'],
      ['q.days', 'mon'],
      ['q.days', 'tue'],
      ['q.size', 'l'],
      ['q.order.0', '2'],
      ['q.order.1', '1'],
      ['q.feel.0', 'no'],
      ['q.feel.1', 'na'],
      ['q.slots.0', 'am'],
      ['q.slots.1', 'am'],
      ['q.slots.1', 'pm'],
    ]);
    const read = readAnswers(form, data);
    expect(read.answers).toEqual({
      coming: 'no',
      days: ['mon', 'tue'],
      size: 'l',
      order: ['two', 'one'],
      feel: { dark: 'no', api: 'na' },
      slots: { mon: ['am'], tue: ['am', 'pm'] },
    });
    const result = validateResponse(form, read.answers);
    expect(result.errors).toEqual([]);
    expect(result.answers).toEqual(read.answers);
    // Labels are not valid answers any more.
    const byLabel = validateResponse(form, { coming: 'Sorry, no', feel: { 'Dark mode': 'Against' } });
    expect(byLabel.errors.map((e) => e.id)).toEqual(['feel']);
    expect(byLabel.answers['coming']).toBe('Sorry, no'); // taken as the "other" text
    // The raw answers re-fill the form by value.
    const refilled = renderForm(form, { values: read.answers });
    expect(refilled).toContain('name="q.coming" value="no" checked required>');
    expect(refilled).toContain('name="q.feel.1" value="na" checked>');
    expect(refilled).toContain('name="q.slots.1" value="pm" checked>');
  });

  it('reads the all-types grid with flagged columns into values', () => {
    const read = readAnswers(allTypes, formData([['q.how-do-you-feel-about-each-proposal.0', 'yes'], ['q.how-do-you-feel-about-each-proposal.1', 'na']]));
    expect(read.answers['how-do-you-feel-about-each-proposal']).toEqual({ 'Dark mode': 'yes', 'Public API': 'na' });
    expect(validateResponse(allTypes, read.answers).errors).not.toContainEqual(expect.objectContaining({ id: 'how-do-you-feel-about-each-proposal' }));
    // A label where a value is expected is rejected by core.
    const label = readAnswers(allTypes, formData([['q.how-do-you-feel-about-each-proposal.0', 'Love it']]));
    expect(validateResponse(allTypes, label.answers).errors).toContainEqual(expect.objectContaining({ id: 'how-do-you-feel-about-each-proposal' }));
  });

  it('keeps grid answers keyed by row label in row order', () => {
    const read = readAnswers(rsvp, formData([['q.rate-the-sessions.1', 'OK'], ['q.rate-the-sessions.0', 'Poor']]));
    expect(Object.keys(read.answers['rate-the-sessions'] as object)).toEqual(['Keynote', 'Workshop']);
    expect(read.answers['rate-the-sessions']).toEqual({ Keynote: 'Poor', Workshop: 'OK' });
    // out-of-range row indexes are ignored
    expect(readAnswers(rsvp, formData([['q.rate-the-sessions.7', 'OK']])).answers['rate-the-sessions']).toBeUndefined();
  });

  it('reads a full ranking into ordered labels, whatever the field order', () => {
    const read = readAnswers(
      allTypes,
      formData([
        ['q.rank-these-features.2', '1'],
        ['q.rank-these-features.0', '2'],
        ['q.rank-these-features.1', '3'],
      ]),
    );
    expect(read.answers['rank-these-features']).toEqual(['Export', 'Dark mode', 'Offline sync']);
    expect(validateResponse(allTypes, { 'rank-these-features': read.answers['rank-these-features'] }).errors).not.toContainEqual(
      expect.objectContaining({ id: 'rank-these-features' }),
    );
    // Only the relative order matters, so gaps are fine.
    const gaps = readAnswers(allTypes, formData([['q.rank-these-features.0', '3'], ['q.rank-these-features.1', '9'], ['q.rank-these-features.2', '1']]));
    expect(gaps.answers['rank-these-features']).toEqual(['Export', 'Dark mode', 'Offline sync']);
  });

  it('reads a partial ranking as a short list, which core rejects', () => {
    const read = readAnswers(allTypes, formData([['q.rank-these-features.0', ''], ['q.rank-these-features.1', '1'], ['q.rank-these-features.2', '']]));
    expect(read.answers['rank-these-features']).toEqual(['Offline sync']);
    expect(validateResponse(allTypes, read.answers).errors).toContainEqual({ id: 'rank-these-features', message: 'Rank all of the options.' });
    // Re-rendering the raw answer restores the partial ranking.
    const html = renderForm(allTypes, { values: read.answers });
    expect(html).toContain('name="q.rank-these-features.1" aria-label="Rank for Offline sync"><option value="">–</option><option value="1" selected>1</option>');
  });

  it('omits the ranking when nothing is ranked or the ranks are garbage', () => {
    expect(readAnswers(allTypes, formData([['q.rank-these-features.0', ''], ['q.rank-these-features.1', ''], ['q.rank-these-features.2', '']])).answers['rank-these-features']).toBeUndefined();
    expect(readAnswers(allTypes, formData([])).answers['rank-these-features']).toBeUndefined();
    expect(readAnswers(allTypes, formData([['q.rank-these-features.0', 'first'], ['q.rank-these-features.1', '0'], ['q.rank-these-features.2', '1.5']])).answers['rank-these-features']).toBeUndefined();
    // Out-of-range option indexes are ignored.
    expect(readAnswers(allTypes, formData([['q.rank-these-features.7', '1']])).answers['rank-these-features']).toBeUndefined();
  });

  it('reports tied ranks as a duplicate, which core rejects', () => {
    const read = readAnswers(allTypes, formData([['q.rank-these-features.0', '2'], ['q.rank-these-features.1', '1'], ['q.rank-these-features.2', '2']]));
    // Export shares rank 2 with the earlier Dark mode, so it comes out as Dark mode again.
    expect(read.answers['rank-these-features']).toEqual(['Offline sync', 'Dark mode', 'Dark mode']);
    expect(validateResponse(allTypes, read.answers).errors).toContainEqual({ id: 'rank-these-features', message: 'Rank each option once.' });
    // Re-rendered, the losing option shows as unranked.
    const html = section(renderForm(allTypes, { values: read.answers }), 'rank-these-features');
    expect(html).toContain('aria-label="Rank for Offline sync"><option value="">–</option><option value="1" selected>1</option>');
    expect(html).toContain('aria-label="Rank for Dark mode"><option value="">–</option><option value="1">1</option><option value="2" selected>2</option>');
    expect(html).toContain('aria-label="Rank for Export"><option value="" selected>–</option>');
  });

  it('combines a phone number and its country into E.164', () => {
    const read = (number: string, country?: string) =>
      readAnswers(allTypes, formData(country === undefined ? [['q.phone', number]] : [['q.phone.country', country], ['q.phone', number]]))
        .answers['phone'];
    expect(read('06 1234 5678', 'NL')).toBe('+31612345678');
    expect(read('(030) 123-4567', 'DE')).toBe('+49301234567');
    expect(read('06 1234 5678', 'it')).toBe('+390612345678');
    // International numbers ignore the picked country.
    expect(read('+1 416 555 0100', 'NL')).toBe('+14165550100');
    expect(read('0049 30 1234567', 'NL')).toBe('+49301234567');
    // No country field at all (an API client): the question's default.
    expect(read('06 1234 5678')).toBe('+31612345678');
    // Blank number: no answer.
    expect(read('', 'NL')).toBeUndefined();
    expect(read('   ', 'NL')).toBeUndefined();
    expect(readAnswers(allTypes, formData([['q.phone.country', 'NL']])).answers['phone']).toBeUndefined();
  });

  it('keeps the typed phone text when it cannot become E.164, so validation reports it', () => {
    const cases: [string, string][] = [
      ['abc', 'NL'],
      ['06 1234 5678', ''], // national number, no country picked
      ['+999 123', 'NL'], // unknown calling code
      ['12', 'NL'], // too short
    ];
    for (const [number, country] of cases) {
      const read = readAnswers(allTypes, formData([['q.phone.country', country], ['q.phone', number]]));
      expect(read.answers['phone'], number).toBe(number);
      const result = validateResponse(allTypes, read.answers);
      expect(result.errors.map((e) => e.id), number).toContain('phone');
    }
  });

  it('collects address parts into an object and drops empty parts', () => {
    const read = readAnswers(
      allTypes,
      formData([
        ['q.home-address.street', '1 Main St'],
        ['q.home-address.city', 'Springfield'],
        ['q.home-address.region', ''],
        ['q.home-address.postalCode', ''],
        ['q.home-address.country', 'US'],
      ]),
    );
    expect(read.answers['home-address']).toEqual({ street: '1 Main St', city: 'Springfield', country: 'US' });
  });

  it('omits the address answer entirely when every part is empty', () => {
    const read = readAnswers(
      allTypes,
      formData([
        ['q.home-address.street', ''],
        ['q.home-address.city', ''],
        ['q.home-address.region', ''],
        ['q.home-address.postalCode', ''],
        ['q.home-address.country', ''],
      ]),
    );
    expect(read.answers['home-address']).toBeUndefined();
    expect(readAnswers(allTypes, formData([])).answers['home-address']).toBeUndefined();
  });
});
