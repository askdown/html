import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AddressQuestion, type Form, parse } from '@askdown/core';
import { describe, expect, it } from 'vitest';
import { addressPartsHtml, OTHER_VALUE, renderConfirmation, renderForm } from '../src/index.ts';

const EXAMPLES = join(import.meta.dirname, '../vendor/spec/examples');

function load(name: string): Form {
  const { form, diagnostics } = parse(readFileSync(join(EXAMPLES, name), 'utf8'));
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return form;
}

/** Extracts all name="..." attributes, in order. */
function fieldNames(html: string): string[] {
  return [...html.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]!);
}

/** The HTML of one question. */
function section(html: string, id: string): string {
  const start = html.indexOf(`data-question-id="${id}"`);
  const end = html.indexOf('<div class="askdown-question', start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

/** The field names of an address question, in document order. */
function addressNames(html: string, id: string): string[] {
  return fieldNames(section(html, id)).filter((n) => n.startsWith(`q.${id}.`));
}

describe('renderForm', () => {
  const allTypes = load('all-types.ask');
  const rsvp = load('rsvp.ask');
  const branching = load('branching.ask');

  it('renders the form shell', () => {
    const html = renderForm(rsvp, { action: '/f/rsvp' });
    expect(html.startsWith('<form class="askdown" data-askdown method="post" enctype="multipart/form-data" action="/f/rsvp"')).toBe(true);
    expect(html.endsWith('</form>')).toBe(true);
    expect(html).toContain('<h1 class="askdown-title">DevConf RSVP</h1>');
    expect(html).toContain('<div class="askdown-description"><p>Tell us whether you&#39;re coming, and what you&#39;d like to see.</p></div>');
    expect(html).toContain('<button type="submit" class="askdown-button askdown-button--primary askdown-submit">Send RSVP</button>');
    expect(html).toContain('<div class="askdown-content"><p>Intro text is <strong>plain Markdown</strong> and becomes a content block.</p></div>');
    // Honeypot
    expect(html).toContain('name="_hp" tabindex="-1" autocomplete="off"');
    expect(html).toMatch(/<div class="askdown-hp" hidden aria-hidden="true">/);
    // Multi-page forms rely on server validation
    expect(html).toContain(' novalidate>');
    // Live region for the runtime
    expect(html).toContain('aria-live="polite"');
  });

  it('renders pages with ids and titles', () => {
    const html = renderForm(rsvp);
    expect(html).toContain('<section class="askdown-page" data-page-id="page-1" data-page-index="0" aria-label="Page 1" data-next="submit">');
    expect(html).toContain('<section class="askdown-page" data-page-id="bye" data-page-index="1" aria-labelledby="askdown-page-1-title">');
    expect(html).toContain('<h2 class="askdown-page-title" id="askdown-page-1-title">Sorry to miss you</h2>');
    expect(renderForm(branching)).toContain('data-page-id="billing" data-page-index="1" aria-labelledby="askdown-page-1-title" data-next="submit"');
  });

  it('uses the default submit label and no novalidate on single-page forms', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('>Submit</button>');
    expect(html).not.toContain('novalidate');
  });

  it('renders text with constraints', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<label class="askdown-label" for="askdown-short">Short answer</label>');
    expect(html).toContain(
      '<input class="askdown-input" type="text" id="askdown-short" name="q.short" aria-describedby="askdown-short-error" placeholder="Your answer" maxlength="80" pattern="[A-Za-z ]+">',
    );
    expect(html).toContain('<p class="askdown-error" id="askdown-short-error" hidden></p>');
  });

  it('renders paragraph as a textarea', () => {
    expect(renderForm(allTypes)).toContain(
      '<textarea class="askdown-input askdown-textarea" id="askdown-long" name="q.long" aria-describedby="askdown-long-error" rows="4" minlength="10"></textarea>',
    );
  });

  it('renders email, url, number, date and time', () => {
    const html = renderForm(rsvp);
    expect(html).toContain('type="email" id="askdown-email" name="q.email" required aria-describedby="askdown-email-help askdown-email-error" autocomplete="email"');
    expect(html).toContain('<div class="askdown-help" id="askdown-email-help"><p>We&#39;ll only use this for event updates.</p></div>');
    const all = renderForm(allTypes);
    expect(all).toContain('type="url" id="askdown-website" name="q.website"');
    expect(all).toContain('placeholder="https://example.com"');
    expect(all).toContain('type="number" id="askdown-age" name="q.age" aria-describedby="askdown-age-error" inputmode="decimal" min="0" max="130" step="1"');
    expect(all).toContain('type="date" id="askdown-birthday" name="q.birthday" aria-describedby="askdown-birthday-error" min="1900-01-01"');
    expect(all).toContain('type="time" id="askdown-preferred-time" name="q.preferred-time"');
  });

  it('uses step="any" for numbers without a step', () => {
    const form = parse('? N\n[number]').form;
    expect(renderForm(form)).toContain('step="any"');
  });

  it('renders radio groups with defaults, other and shuffle', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<fieldset class="askdown-fieldset" aria-describedby="askdown-favorite-color-error"><legend class="askdown-label">Favorite color</legend>');
    expect(html).toContain('<div class="askdown-options" data-shuffle>');
    expect(html).toContain('<input class="askdown-choice" type="radio" id="askdown-favorite-color-o0" name="q.favorite-color" value="Red">');
    expect(html).toContain('<input class="askdown-choice" type="radio" id="askdown-favorite-color-o1" name="q.favorite-color" value="Green" checked>');
    expect(html).toContain('<label class="askdown-option-label" for="askdown-favorite-color-o1">Green</label>');
    expect(html).toContain(
      `<div class="askdown-option askdown-option--other"><input class="askdown-choice" type="radio" id="askdown-favorite-color-other" name="q.favorite-color" value="${OTHER_VALUE}">`,
    );
    expect(html).toContain('<input class="askdown-input askdown-other-input" type="text" name="q.favorite-color.other" aria-labelledby="askdown-favorite-color-other-label">');
  });

  it('marks required radios natively but not checkboxes', () => {
    const html = renderForm(rsvp);
    expect(html).toContain('name="q.will-you-attend" value="Yes" required>');
    expect(html).toContain('name="q.will-you-attend" value="No" required data-goto="bye"');
    const req = parse('? Pick *\n- [ ] A\n- [ ] B').form;
    const out = renderForm(req);
    expect(out).not.toMatch(/<input[^>]*type="checkbox"[^>]* required/);
    expect(out).toContain('<span class="askdown-sr-only"> (required)</span>');
  });

  it('renders checkbox groups', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<input class="askdown-choice" type="checkbox" id="askdown-toppings-o0" name="q.toppings" value="Cheese" checked>');
    expect(html).toContain('<input class="askdown-choice" type="checkbox" id="askdown-toppings-o1" name="q.toppings" value="Mushrooms">');
    const withOther = renderForm(rsvp);
    expect(withOther).toContain(`type="checkbox" id="askdown-which-days-other" name="q.which-days" value="${OTHER_VALUE}">`);
    expect(withOther).toContain('<label class="askdown-option-label" id="askdown-which-days-other-label" for="askdown-which-days-other">Other</label>');
  });

  it('renders select with a placeholder option', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<label class="askdown-label" for="askdown-country">Country</label>');
    expect(html).toContain('<select class="askdown-input askdown-select" id="askdown-country" name="q.country" aria-describedby="askdown-country-error"><option value="" selected>Choose…</option><option value="Netherlands">Netherlands</option>');
  });

  it('renders scale as a radio row with labels', () => {
    const html = renderForm(rsvp);
    expect(html).toContain('<legend class="askdown-label">How excited are you?</legend>');
    expect(html).toContain('<span class="askdown-scale-label askdown-scale-label--min">Meh</span>');
    expect(html).toContain('<span class="askdown-scale-label askdown-scale-label--max">Very</span>');
    for (let n = 1; n <= 5; n++) {
      expect(html).toContain(`<input type="radio" id="askdown-how-excited-are-you-v${n}" name="q.how-excited-are-you" value="${n}">`);
    }
    expect(html).not.toContain('name="q.how-excited-are-you" value="6"');
  });

  it('renders rating as a star radio group', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<legend class="askdown-label">Overall</legend>');
    expect(html).toContain('<input class="askdown-rating-input" type="radio" id="askdown-overall-v1" name="q.overall" value="1">');
    expect(html).toContain('<input class="askdown-rating-input" type="radio" id="askdown-overall-v10" name="q.overall" value="10">');
    expect(html).not.toContain('name="q.overall" value="11"');
    expect(html).toContain('<label class="askdown-rating-star" for="askdown-overall-v3" title="3 of 10"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">');
    expect(html).toContain('<span class="askdown-sr-only">3 of 10</span>');
  });

  it('renders rankings as a fieldset with a rank select per option, all unranked', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<div class="askdown-question askdown-question--ranking" data-question-id="rank-these-features" data-type="ranking">');
    expect(html).toContain('<fieldset class="askdown-fieldset" aria-describedby="askdown-rank-these-features-error"><legend class="askdown-label">Rank these features</legend>');
    expect(html).toContain('<div class="askdown-ranking">');
    expect(html).toContain('<div class="askdown-ranking-option" data-index="0" data-value="Dark mode"><label class="askdown-ranking-option-label" for="askdown-rank-these-features-r0">Dark mode</label>');
    expect(html).toContain(
      '<select class="askdown-input askdown-select askdown-ranking-select" id="askdown-rank-these-features-r0" name="q.rank-these-features.0" aria-label="Rank for Dark mode">' +
        '<option value="" selected>–</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>',
    );
    expect(fieldNames(section(html, 'rank-these-features'))).toEqual(['q.rank-these-features.0', 'q.rank-these-features.1', 'q.rank-these-features.2']);
    expect(html).toContain('aria-label="Rank for Export"');
    // The initial order is never an answer.
    expect(section(html, 'rank-these-features').match(/<option value="\d" selected>/g)).toBeNull();
    expect(html).not.toContain('name="q.rank-these-features.3"');
    // Required marks are described for screen readers, like checkboxes.
    const required = renderForm(parse('? Order *\n1. A\n2. B').form);
    expect(required).toContain('<legend class="askdown-label">Order<span class="askdown-required" aria-hidden="true">*</span><span class="askdown-sr-only"> (required)</span></legend>');
    expect(required).not.toMatch(/<select[^>]* required/);
  });

  it('marks a shuffled ranking for the runtime', () => {
    const html = renderForm(parse('? Order\n[ranking shuffle]\n1. A\n2. B').form);
    expect(html).toContain('<div class="askdown-ranking" data-shuffle>');
    expect(renderForm(allTypes)).not.toContain('<div class="askdown-ranking" data-shuffle>');
  });

  it('re-fills a ranking from the ordered labels', () => {
    const html = renderForm(allTypes, { values: { 'rank-these-features': ['Export', 'Dark mode'] } });
    const s = section(html, 'rank-these-features');
    expect(s).toContain('name="q.rank-these-features.0" aria-label="Rank for Dark mode"><option value="">–</option><option value="1">1</option><option value="2" selected>2</option>');
    expect(s).toContain('name="q.rank-these-features.1" aria-label="Rank for Offline sync"><option value="" selected>–</option>');
    expect(s).toContain('name="q.rank-these-features.2" aria-label="Rank for Export"><option value="">–</option><option value="1" selected>1</option>');
    // Unknown labels are ignored; a duplicate label keeps its first rank.
    const odd = section(renderForm(allTypes, { values: { 'rank-these-features': ['Nope', 'Export', 'Export'] } }), 'rank-these-features');
    expect(odd).toContain('name="q.rank-these-features.2" aria-label="Rank for Export"><option value="">–</option><option value="1">1</option><option value="2" selected>2</option>');
    expect(odd.match(/<option value="\d" selected>/g)).toHaveLength(1);
  });

  it('marks the rank selects invalid on error', () => {
    const html = renderForm(allTypes, { values: { 'rank-these-features': ['Export'] }, errors: { 'rank-these-features': 'Rank all of the options.' } });
    expect(html).toContain('name="q.rank-these-features.0" aria-label="Rank for Dark mode" aria-invalid="true">');
    expect(html).toContain('<p class="askdown-error" id="askdown-rank-these-features-error">Rank all of the options.</p>');
  });

  it('renders grids as tables with row-indexed names', () => {
    const html = renderForm(rsvp);
    expect(html).toContain(
      '<table class="askdown-grid"><thead><tr><td></td><th scope="col" data-value="Poor">Poor</th><th scope="col" data-value="OK">OK</th><th scope="col" data-value="Great">Great</th></tr></thead>',
    );
    expect(html).toContain(
      '<tr><th scope="row" data-value="Keynote">Keynote</th><td><label class="askdown-grid-cell" for="askdown-rate-the-sessions-r0c0" data-value="Poor"><input class="askdown-choice" type="radio" id="askdown-rate-the-sessions-r0c0" name="q.rate-the-sessions.0" value="Poor"><span class="askdown-sr-only">Keynote: Poor</span></label></td>',
    );
    expect(html).toContain('name="q.rate-the-sessions.1" value="Great"');
    const multi = renderForm(allTypes);
    expect(multi).toContain('<input class="askdown-choice" type="checkbox" id="askdown-availability-r1c1" name="q.availability.1" value="Afternoon">');
  });

  it('renders option values and shows labels', () => {
    const form = parse('? Coming?\n- ( ) Count me in {yes}\n- ( ) Not sure {maybe .muted}\n- ( ) Sorry, no {no}\n- (x) Ask me later {later .quiet .muted}').form;
    const html = renderForm(form);
    expect(html).toContain('<input class="askdown-choice" type="radio" id="askdown-coming-o0" name="q.coming" value="yes"><label class="askdown-option-label" for="askdown-coming-o0">Count me in</label>');
    expect(html).not.toContain('value="Count me in"');
    // Defaults are tracked by value.
    expect(html).toContain('name="q.coming" value="later" checked>');
    // Sentiment from the value, other flags as classes and data-flags.
    expect(html).toContain('<div class="askdown-option askdown-sentiment-positive" data-value="yes"><input');
    expect(html).toContain('<div class="askdown-option askdown-sentiment-neutral askdown-flag-muted" data-value="maybe" data-flags="muted"><input');
    expect(html).toContain('<div class="askdown-option askdown-sentiment-negative" data-value="no"><input');
    expect(html).toContain('<div class="askdown-option askdown-flag-quiet askdown-flag-muted" data-value="later" data-flags="quiet muted"><input');
    // Selects: values as option values, flags as classes; no data-value (the value attribute has it).
    const select = renderForm(parse('? Pick\n[select]\n- Great {yes}\n- Awful {no .muted}\n- Dunno').form);
    expect(select).toContain('<option value="yes" class="askdown-sentiment-positive">Great</option>');
    expect(select).toContain('<option value="no" class="askdown-sentiment-negative askdown-flag-muted" data-flags="muted">Awful</option>');
    expect(select).toContain('<option value="Dunno">Dunno</option>');
    // Checkbox and ranking options too.
    const multi = renderForm(parse('? Which\n- [ ] A {a .muted}\n- [x] B {b}').form);
    expect(multi).toContain('<div class="askdown-option askdown-flag-muted" data-value="a" data-flags="muted"><input class="askdown-choice" type="checkbox" id="askdown-which-o0" name="q.which" value="a">');
    expect(multi).toContain('value="b" checked>');
    const ranking = renderForm(parse('? Order\n1. First {one}\n2. Second {two .muted}').form);
    expect(ranking).toContain('<div class="askdown-ranking-option" data-index="0" data-value="one"><label class="askdown-ranking-option-label" for="askdown-order-r0">First</label>');
    expect(ranking).toContain('<div class="askdown-ranking-option askdown-flag-muted" data-index="1" data-value="two" data-flags="muted">');
  });

  it('colours options by sentiment flag, or by a yes/maybe/no value', () => {
    const flagged = renderForm(parse('? Q\n- ( ) Go {go .positive}\n- ( ) Hmm {hmm .neutral}\n- ( ) Stop {stop .negative}\n- ( ) Plain').form);
    expect(flagged).toContain('<div class="askdown-option askdown-sentiment-positive" data-value="go">');
    expect(flagged).toContain('<div class="askdown-option askdown-sentiment-neutral" data-value="hmm">');
    expect(flagged).toContain('<div class="askdown-option askdown-sentiment-negative" data-value="stop">');
    expect(flagged).toContain('<div class="askdown-option" data-value="Plain">');
    // A sentiment flag is not repeated as a generic flag class.
    expect(flagged).not.toContain('askdown-flag-positive');
    expect(flagged).not.toContain('data-flags');
    // A colour flag wins over the value.
    expect(renderForm(parse('? Q\n- ( ) X {no .positive}').form)).toContain('<div class="askdown-option askdown-sentiment-positive" data-value="no">');
    // Plain Yes/No labels colour by their (default) value, case-insensitively.
    const plain = renderForm(rsvp);
    expect(plain).toContain('<div class="askdown-option askdown-sentiment-positive" data-value="Yes"><input class="askdown-choice" type="radio" id="askdown-will-you-attend-o0" name="q.will-you-attend" value="Yes" required>');
    expect(plain).toContain('<div class="askdown-option askdown-sentiment-negative" data-value="No">');
    expect(plain).toContain('<div class="askdown-option" data-value="Day 1">');
    expect(renderForm(parse('? Q\n- ( ) MAYBE').form)).toContain('askdown-sentiment-neutral');
  });

  it('renders grid columns with values, sentiment and flags', () => {
    const html = section(renderForm(allTypes), 'how-do-you-feel-about-each-proposal');
    expect(html).toContain(
      '<thead><tr><td></td>' +
        '<th scope="col" class="askdown-sentiment-positive" data-value="yes">Love it</th>' +
        '<th scope="col" class="askdown-sentiment-neutral" data-value="maybe">Neutral</th>' +
        '<th scope="col" class="askdown-sentiment-negative" data-value="no">Against</th>' +
        '<th scope="col" class="askdown-flag-muted" data-value="na" data-flags="muted">N/A</th>' +
        '</tr></thead>',
    );
    expect(html).toContain('<th scope="row" data-value="Dark mode">Dark mode</th>');
    expect(html).toContain(
      '<td><label class="askdown-grid-cell askdown-sentiment-positive" for="askdown-how-do-you-feel-about-each-proposal-r0c0" data-value="yes"><input class="askdown-choice" type="radio" id="askdown-how-do-you-feel-about-each-proposal-r0c0" name="q.how-do-you-feel-about-each-proposal.0" value="yes"><span class="askdown-sr-only">Dark mode: Love it</span></label></td>',
    );
    expect(html).toContain('<label class="askdown-grid-cell askdown-flag-muted" for="askdown-how-do-you-feel-about-each-proposal-r1c3" data-value="na" data-flags="muted"><input class="askdown-choice" type="radio" id="askdown-how-do-you-feel-about-each-proposal-r1c3" name="q.how-do-you-feel-about-each-proposal.1" value="na">');
    expect(html).not.toContain('value="Love it"');
    // Rows never carry a sentiment, even when their value says yes.
    const rows = renderForm(parse('? G\n[grid]\n| | A | B |\n| Yes |\n| No {no} |').form);
    expect(rows).toContain('<th scope="row" data-value="Yes">Yes</th>');
    expect(rows).toContain('<th scope="row" data-value="no">No</th>');
    expect(rows).not.toContain('askdown-sentiment');
    // Columns labelled plainly Yes/Maybe/No colour automatically.
    const plain = renderForm(parse('? Can you make it?\n[grid]\n| | Yes | Maybe | No |\n| Monday |').form);
    expect(plain).toContain('<th scope="col" class="askdown-sentiment-positive" data-value="Yes">Yes</th><th scope="col" class="askdown-sentiment-neutral" data-value="Maybe">Maybe</th><th scope="col" class="askdown-sentiment-negative" data-value="No">No</th>');
    expect(plain).toContain('<label class="askdown-grid-cell askdown-sentiment-negative" for="askdown-can-you-make-it-r0c2" data-value="No">');
  });

  it('re-fills choices and grids by value', () => {
    const form = parse(
      '? Coming?\n- ( ) Count me in {yes}\n- ( ) Sorry, no {no}\n\n? Days\n- [ ] Monday {mon}\n- [ ] Tuesday {tue}\n\n? Size\n[select]\n- Small {s}\n- Large {l}\n\n? Order\n1. First {one}\n2. Second {two}\n\n? Feel\n[grid]\n| | Love it {yes} | Against {no} |\n| Dark mode {dark} |\n| API {api} |',
    ).form;
    const html = renderForm(form, { values: { coming: 'no', days: ['tue'], size: 'l', order: ['two', 'one'], feel: { dark: 'no', api: 'yes' } } });
    expect(html).toContain('name="q.coming" value="no" checked>');
    expect(html).not.toContain('name="q.coming" value="yes" checked');
    expect(html).toContain('name="q.days" value="tue" checked>');
    expect(html).not.toContain('value="mon" checked');
    expect(html).toContain('<option value="l" selected>Large</option>');
    expect(html).toContain('aria-label="Rank for First"><option value="">–</option><option value="1">1</option><option value="2" selected>2</option>');
    expect(html).toContain('aria-label="Rank for Second"><option value="">–</option><option value="1" selected>1</option>');
    expect(html).toContain('name="q.feel.0" value="no" checked>');
    expect(html).toContain('name="q.feel.1" value="yes" checked>');
    expect(html).not.toContain('name="q.feel.0" value="yes" checked');
    // Labels are not matched, only values.
    const byLabel = renderForm(form, { values: { coming: 'Sorry, no', feel: { 'Dark mode': 'Against' } } });
    expect(byLabel).not.toContain('checked');
  });

  it('renders file inputs with accept, multiple and hints', () => {
    const html = renderForm(allTypes);
    expect(html).toContain(
      '<input class="askdown-file" type="file" id="askdown-resume" name="q.resume" required accept=".pdf,.docx" multiple data-max-files="2" data-max-size="5242880" aria-describedby="askdown-resume-help askdown-resume-error">',
    );
    expect(html).toContain('<p class="askdown-hint">Up to 2 files · 5MB max each · .pdf, .docx</p>');
    const single = renderForm(branching);
    expect(single).toContain('name="q.screenshot" accept="image/*" data-max-files="1"');
    expect(single).not.toContain('name="q.screenshot" accept="image/*" multiple');
  });

  it('renders address questions as a fieldset with the country first and generic parts', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('<div class="askdown-question askdown-question--address" data-question-id="home-address" data-type="address">');
    expect(html).toContain('<legend class="askdown-label">Home address</legend>');
    expect(html).toContain('<label class="askdown-label" for="askdown-home-address-country">Country</label>');
    expect(html).toContain('name="q.home-address.country" autocomplete="country" aria-describedby="askdown-home-address-error"><option value="" selected>Choose…</option>');
    // The country select decides the other parts, so it comes first.
    expect(addressNames(html, 'home-address')).toEqual([
      'q.home-address.country',
      'q.home-address.street',
      'q.home-address.postalCode',
      'q.home-address.city',
      'q.home-address.region',
    ]);
    expect(html).toContain('<div class="askdown-address-parts" data-country="">');
    expect(html).toContain('name="q.home-address.street" autocomplete="street-address" aria-describedby="askdown-home-address-error" rows="2">');
    expect(html).toContain('name="q.home-address.postalCode" autocomplete="postal-code" aria-describedby="askdown-home-address-error">');
    expect(html).toContain('name="q.home-address.city" autocomplete="address-level2" aria-describedby="askdown-home-address-error">');
    expect(html).toContain('<input class="askdown-input" type="text" id="askdown-home-address-region" name="q.home-address.region" autocomplete="address-level1"');
    expect(html).toContain('<label class="askdown-label" for="askdown-home-address-region">Region</label>');
    expect(html).not.toContain('(optional)');
    // Postal code and city share a row.
    expect(html).toContain('<div class="askdown-address-row"><div class="askdown-address-field askdown-address-field--postal-code">');
  });

  it('omits the country select when the address country is fixed', () => {
    const html = renderForm(allTypes);
    expect(html).toContain('data-question-id="delivery-address"');
    expect(html).toContain('name="q.delivery-address.street"');
    expect(html).not.toContain('name="q.delivery-address.country"');
    const deliverySection = section(html, 'delivery-address');
    expect(deliverySection).not.toContain('autocomplete="country"');
  });

  it('renders the parts of a fixed country in its format (NL: postcode before city, no region)', () => {
    const html = renderForm(allTypes);
    const nl = section(html, 'delivery-address');
    expect(nl).toContain('<div class="askdown-address-parts" data-country="NL">');
    expect(addressNames(nl, 'delivery-address')).toEqual(['q.delivery-address.street', 'q.delivery-address.postalCode', 'q.delivery-address.city']);
    expect(nl).toContain('<label class="askdown-label" for="askdown-delivery-address-postalCode">Postcode</label>');
    expect(nl).not.toContain('address-level1');
  });

  it('hints at the form of a postal code', () => {
    const postalInput = (source: string) => {
      const html = renderForm(parse(source).form);
      const start = html.indexOf('name="q.address.postalCode"');
      return html.slice(start, html.indexOf('>', start));
    };
    const ca = postalInput('? Address\n[address country=CA]');
    expect(ca).toContain('placeholder="A1A 1A1"');
    expect(ca).toContain('autocapitalize="characters"');
    const us = postalInput('? Address\n[address country=US]');
    expect(us).toContain('placeholder="12345"');
    expect(us).toContain('inputmode="numeric"');
    // No rule, no hints.
    const fr = postalInput('? Address\n[address country=FR]');
    expect(fr).not.toContain('placeholder');
    expect(fr).not.toContain('inputmode');
  });

  it('renders a province select for Canada', () => {
    const form = parse('? Address *\n[address country=CA]').form;
    const html = renderForm(form);
    expect(addressNames(html, 'address')).toEqual(['q.address.street', 'q.address.city', 'q.address.region', 'q.address.postalCode']);
    expect(html).toContain('<label class="askdown-label" for="askdown-address-region">Province</label>');
    expect(html).toContain('<select class="askdown-input askdown-select" id="askdown-address-region" name="q.address.region" autocomplete="address-level1" required aria-describedby="askdown-address-error"><option value="" selected>Choose…</option>');
    const region = html.slice(html.indexOf('id="askdown-address-region"'), html.indexOf('</select>'));
    expect(region.match(/<option value="[A-Z]{2}"/g)).toHaveLength(13);
    expect(region).toContain('<option value="ON">Ontario</option>');
    // Every part of a required question is required in Canada.
    expect(html).toContain('name="q.address.street" autocomplete="street-address" required');
    expect(html).toContain('name="q.address.postalCode" autocomplete="postal-code" required');
    expect(html).toContain('name="q.address.city" autocomplete="address-level2" required');
  });

  it('only requires parts of a required question', () => {
    const optional = renderForm(parse('? Address\n[address country=CA]').form);
    expect(optional).not.toMatch(/ required/);
    // Spain writes the province but doesn't require it.
    const es = renderForm(parse('? Address *\n[address country=ES]').form);
    expect(es).toContain('name="q.address.postalCode" autocomplete="postal-code" required');
    expect(es).toContain('name="q.address.region" autocomplete="address-level1" aria-describedby');
  });

  it('follows the Japanese order: postal code, prefecture, city, street', () => {
    const html = renderForm(parse('? Address\n[address country=JP]').form);
    expect(addressNames(html, 'address')).toEqual(['q.address.postalCode', 'q.address.region', 'q.address.city', 'q.address.street']);
    expect(html).toContain('>Prefecture</label>');
    expect(html).toContain('<option value="13">Tokyo</option>');
    // Postal code and city aren't adjacent, so there's no row.
    expect(html).not.toContain('askdown-address-row');
  });

  it('picks the format of a prefilled country', () => {
    const html = renderForm(allTypes, {
      values: { 'home-address': { street: '1 Main St', city: 'Springfield', region: 'IL', postalCode: '62704', country: 'us' } },
    });
    expect(html).toContain('<option value="US" selected>United States</option>');
    expect(html).toContain('<div class="askdown-address-parts" data-country="US">');
    expect(html).toContain('>ZIP code</label>');
    expect(html).toContain('<option value="IL" selected>Illinois</option>');
    // An unknown country falls back to the generic parts.
    const unknown = renderForm(allTypes, { values: { 'home-address': { country: 'XX' } } });
    expect(unknown).toContain('<div class="askdown-address-parts" data-country="">');
  });

  it('renders phone as a country picker joined to a tel input', () => {
    const html = section(renderForm(allTypes), 'phone');
    expect(html).toContain('<label class="askdown-label" for="askdown-phone">Phone</label>');
    expect(html).toContain('<div class="askdown-phone"><span class="askdown-phone-country">');
    expect(html).toContain(
      '<select class="askdown-phone-select" id="askdown-phone-country" name="q.phone.country" autocomplete="tel-country-code" aria-label="Country" aria-describedby="askdown-phone-error">',
    );
    // A blank option first, then the countries by name with a flag and code; the author's default is selected.
    expect(html).toContain('<option value="">Country</option><option value="AF">🇦🇫 Afghanistan +93</option><option value="AX">🇦🇽 Åland Islands +358</option>');
    expect(html).toContain('<option value="NL" selected>🇳🇱 Netherlands +31</option>');
    expect(html).not.toContain('<option value="AQ"'); // no calling code
    // The compact label the runtime shows over the select.
    expect(html).toContain(
      '<span class="askdown-phone-label" aria-hidden="true"><span class="askdown-phone-flag">🇳🇱</span><span class="askdown-phone-code">+31</span></span>',
    );
    expect(html).toContain(
      '<input class="askdown-input askdown-phone-input" type="tel" id="askdown-phone" name="q.phone" autocomplete="tel-national" inputmode="tel" aria-describedby="askdown-phone-error" placeholder="06 12345678">',
    );
    expect(fieldNames(html)).toEqual(['q.phone.country', 'q.phone']);
  });

  it('renders phone without a default country', () => {
    const html = renderForm(parse('? Mobile *\n[phone]').form);
    expect(html).toContain('<option value="" selected>Country</option>');
    expect(html).not.toContain(' selected>🇳🇱');
    expect(html).toContain('<span class="askdown-phone-flag">🌐</span><span class="askdown-phone-code"></span>');
    expect(html).toContain('name="q.mobile" autocomplete="tel-national" inputmode="tel" required aria-describedby');
  });

  it('re-fills a phone by splitting the E.164 number into country and national part', () => {
    const nl = section(renderForm(allTypes, { values: { phone: '+31612345678' } }), 'phone');
    expect(nl).toContain('<option value="NL" selected>');
    expect(nl).toContain(' value="612345678"');
    // A number from another country than the default switches the picker.
    const de = section(renderForm(allTypes, { values: { phone: '+4930123456' } }), 'phone');
    expect(de).toContain('<option value="DE" selected>');
    expect(de).not.toContain('<option value="NL" selected>');
    expect(de).toContain('<span class="askdown-phone-flag">🇩🇪</span><span class="askdown-phone-code">+49</span>');
    expect(de).toContain(' value="30123456"');
    // Italy keeps its trunk zero.
    expect(section(renderForm(allTypes, { values: { phone: '+39061234567' } }), 'phone')).toContain(' value="061234567"');
    // Raw text kept after a failed conversion is shown as typed, with the default country.
    const raw = section(renderForm(allTypes, { values: { phone: 'abc' } }), 'phone');
    expect(raw).toContain('<option value="NL" selected>');
    expect(raw).toContain(' value="abc"');
    const spaced = section(renderForm(allTypes, { values: { phone: '+1 416 555 0100' } }), 'phone');
    expect(spaced).toContain('<option value="US" selected>');
    expect(spaced).toContain(' value="+1 416 555 0100"');
    // Values given but none for this question: the default country, no number.
    const empty = section(renderForm(allTypes, { values: {} }), 'phone');
    expect(empty).toContain('<option value="NL" selected>');
    expect(empty).not.toContain(' value="6');
  });

  it('marks both phone parts invalid on error', () => {
    const html = section(renderForm(allTypes, { values: { phone: 'abc' }, errors: { phone: 'Enter a valid phone number.' } }), 'phone');
    expect(html).toContain('aria-label="Country" aria-describedby="askdown-phone-error" aria-invalid="true"');
    expect(html).toContain('inputmode="tel" aria-describedby="askdown-phone-error" aria-invalid="true" value="abc"');
    expect(html).toContain('<p class="askdown-error" id="askdown-phone-error">Enter a valid phone number.</p>');
  });

  it('marks the address parts invalid on error', () => {
    const html = renderForm(allTypes, { values: {}, errors: { 'home-address': 'Enter the street address.' } });
    expect(html).toContain('autocomplete="country" aria-describedby="askdown-home-address-error" aria-invalid="true"');
    expect(html).toContain('name="q.home-address.street" autocomplete="street-address" aria-describedby="askdown-home-address-error" aria-invalid="true"');
    expect(html).toContain('<p class="askdown-error" id="askdown-home-address-error">Enter the street address.</p>');
  });

  it('adds hidden inputs and a preview flag', () => {
    const html = renderForm(allTypes, { hidden: { _csrf: 'tok"en' }, preview: true, idPrefix: 'p1' });
    expect(html).toContain('data-preview');
    expect(html).toContain('data-id-prefix="p1"');
    expect(html).toContain('<input type="hidden" name="_csrf" value="tok&quot;en">');
    // There's no built-in respondent email field; forms ask with an [email] question.
    expect(html).not.toContain('name="_email"');
  });

  it('embeds the definition for the runtime', () => {
    const html = renderForm(rsvp);
    const m = /<script type="application\/json" class="askdown-definition">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual(rsvp);
  });

  it('cannot break out of the definition script', () => {
    const form = parse('? Evil </script><script>alert(1)</script>\n___').form;
    const html = renderForm(form);
    const scripts = html.match(/<\/script>/g) ?? [];
    expect(scripts).toHaveLength(1);
    const m = /<script type="application\/json" class="askdown-definition">([\s\S]*?)<\/script>/.exec(html)!;
    expect(m[1]).not.toContain('<');
    expect(JSON.parse(m[1]!)).toEqual(form);
  });

  it('escapes labels, options, help, values and content', () => {
    const src = [
      '---',
      'title: <b>Title</b> & "quotes"',
      'description: <script>alert(1)</script>',
      '---',
      '? Name <script>x</script> * {#name}',
      '> Help <img src=x onerror=alert(1)>',
      '[text placeholder="\\"><script>"]',
      '',
      '? Pick',
      '- ( ) <i>italic</i>',
      '- ( ) Other "quoted": ___',
      '',
      '? Grid',
      '[grid]',
      '| | <th> |',
      '| <tr> | |',
      '',
      '<div onclick="x">content</div>',
    ].join('\n');
    const form = parse(src).form;
    const html = renderForm(form, { values: { name: '"><script>alert(2)</script>', pick: '<b>other</b>' }, errors: { name: '<b>bad</b>' } });
    expect(html).not.toMatch(/<script>|<b>|<i>|<img|<div onclick/);
    expect(html).toContain('<h1 class="askdown-title">&lt;b&gt;Title&lt;/b&gt; &amp; &quot;quotes&quot;</h1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Name &lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('placeholder="&quot;&gt;&lt;script&gt;"');
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"');
    expect(html).toContain('value="&lt;i&gt;italic&lt;/i&gt;"');
    expect(html).toContain('>&lt;i&gt;italic&lt;/i&gt;</label>');
    expect(html).toContain('Other &quot;quoted&quot;');
    expect(html).toContain('<th scope="col" data-value="&lt;th&gt;">&lt;th&gt;</th>');
    expect(html).toContain('<th scope="row" data-value="&lt;tr&gt;">&lt;tr&gt;</th>');
    expect(html).toContain('<div class="askdown-option" data-value="&lt;i&gt;italic&lt;/i&gt;">');
    expect(html).toContain('>&lt;b&gt;bad&lt;/b&gt;</p>');
    // Other text is re-filled and its radio checked
    expect(html).toContain('value="__other__" checked');
    expect(html).toContain('name="q.pick.other" aria-labelledby="askdown-pick-other-label" value="&lt;b&gt;other&lt;/b&gt;"');
  });

  it('re-fills values instead of defaults', () => {
    const values = {
      short: 'Hello',
      long: 'Line 1\nLine 2',
      website: 'https://x.io',
      age: 42,
      birthday: '2000-01-02',
      'preferred-time': '13:45',
      'favorite-color': 'Blue',
      toppings: ['Mushrooms', 'Olives'],
      country: 'Canada',
      overall: '7',
      'rank-these-features': ['Offline sync', 'Export', 'Dark mode'],
      availability: { Monday: ['Morning'], Tuesday: ['Morning', 'Afternoon'] },
      resume: [{ name: 'cv.pdf', size: 10, type: 'application/pdf' }],
    };
    const html = renderForm(allTypes, { values });
    expect(html).toContain('name="q.short" aria-describedby="askdown-short-error" value="Hello"');
    expect(html).toContain('minlength="10">Line 1\nLine 2</textarea>');
    expect(html).toContain('name="q.website" aria-describedby="askdown-website-error" inputmode="url" value="https://x.io"');
    expect(html).toContain('inputmode="decimal" value="42"');
    expect(html).toContain('value="2000-01-02"');
    expect(html).toContain('value="13:45"');
    // defaults are not applied
    expect(html).not.toContain('value="Green" checked');
    expect(html).toContain('value="Blue" checked');
    expect(html).not.toContain('value="Cheese" checked');
    expect(html).toContain('value="Mushrooms" checked');
    expect(html).toContain('value="Olives" checked');
    expect(html).toContain('<option value="" >Choose…</option>'.replace(' >', '>'));
    expect(html).toContain('<option value="Canada" selected>Canada</option>');
    expect(html).toContain('name="q.overall" value="7" checked');
    expect(html).toContain('name="q.rank-these-features.0" aria-label="Rank for Dark mode"><option value="">–</option><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option>');
    expect(html).toContain('name="q.rank-these-features.1" aria-label="Rank for Offline sync"><option value="">–</option><option value="1" selected>1</option>');
    expect(html).toContain('name="q.availability.0" value="Morning" checked');
    expect(html).not.toContain('name="q.availability.0" value="Afternoon" checked');
    expect(html).toContain('name="q.availability.1" value="Afternoon" checked');
    expect(html).toContain('Please choose your files again.');
  });

  it('re-fills grids and scales', () => {
    const html = renderForm(rsvp, { values: { 'rate-the-sessions': { Workshop: 'OK' }, 'how-excited-are-you': 4, 'which-days': ['Day 2', 'Maybe day 3'] } });
    expect(html).toContain('name="q.rate-the-sessions.1" value="OK" checked');
    expect(html).not.toContain('name="q.rate-the-sessions.0" value="OK" checked');
    expect(html).toContain('name="q.how-excited-are-you" value="4" checked');
    expect(html).toContain('name="q.which-days" value="Day 2" checked');
    expect(html).toContain('name="q.which-days" value="__other__" checked');
    expect(html).toContain('name="q.which-days.other" aria-labelledby="askdown-which-days-other-label" value="Maybe day 3"');
  });

  it('re-fills addresses, including the country select', () => {
    const html = renderForm(allTypes, {
      values: {
        'home-address': { street: '1 Main St', city: 'Springfield', region: 'IL', postalCode: '62704', country: 'US' },
        'delivery-address': { street: 'Damstraat 1', city: 'Amsterdam', postalCode: '1012 JS' },
      },
    });
    expect(html).toContain('name="q.home-address.street" autocomplete="street-address" aria-describedby="askdown-home-address-error" rows="2">1 Main St</textarea>');
    expect(html).toContain('name="q.home-address.postalCode" autocomplete="postal-code" aria-describedby="askdown-home-address-error" placeholder="12345" inputmode="numeric" value="62704"');
    expect(html).toContain('name="q.home-address.city" autocomplete="address-level2" aria-describedby="askdown-home-address-error" value="Springfield"');
    expect(html).toContain('<option value="IL" selected>Illinois</option>');
    expect(html).toContain('<option value="US" selected>United States</option>');
    expect(html).toContain('name="q.delivery-address.postalCode" autocomplete="postal-code" aria-describedby="askdown-delivery-address-error" placeholder="1234 AB" autocapitalize="characters" value="1012 JS"');
  });

  it('shows errors with aria-invalid and a summary', () => {
    const html = renderForm(rsvp, { values: {}, errors: { 'full-name': 'This question is required.', 'will-you-attend': 'Choose one of the options.' } });
    expect(html).toContain('<div class="askdown-error-summary" role="alert" tabindex="-1"><p class="askdown-error-summary-title">Please fix the following 2 problems:</p><ul><li><a href="#askdown-full-name">Full name</a>: This question is required.</li>');
    expect(html).toContain('<div class="askdown-question askdown-question--text askdown-question--invalid" data-question-id="full-name" data-type="text" data-required>');
    expect(html).toContain('name="q.full-name" required aria-describedby="askdown-full-name-error" aria-invalid="true"');
    expect(html).toContain('<p class="askdown-error" id="askdown-full-name-error">This question is required.</p>');
    expect(html).toContain('<fieldset class="askdown-fieldset" aria-describedby="askdown-will-you-attend-error" aria-invalid="true">');
    expect(html).toContain('value="Yes" required aria-invalid="true"');
    // errors for unknown ids are ignored in the summary
    const other = renderForm(rsvp, { errors: { nope: 'x' } });
    expect(other).not.toContain('askdown-error-summary');
  });

  it('only uses contract field names', () => {
    const questionIds = allTypes.pages.flatMap((p) => p.items.flatMap((i) => (i.type === 'content' ? [] : [i.id])));
    for (const name of fieldNames(renderForm(allTypes, { hidden: { _csrf: 'x' } }))) {
      if (name === '_hp' || name === '_csrf') continue;
      const m = /^q\.([^.]+)(?:\.(other|\d+|street|city|region|postalCode|country))?$/.exec(name);
      expect(m, name).not.toBeNull();
      expect(questionIds).toContain(m![1]);
    }
  });

  it('is deterministic and contains no undefined', () => {
    const a = renderForm(allTypes);
    expect(a).toBe(renderForm(allTypes));
    expect(a).not.toContain('undefined');
    expect(a).not.toContain('[object Object]');
    expect(renderForm(rsvp)).not.toContain('undefined');
    expect(renderForm(branching)).not.toContain('undefined');
  });
});

describe('renderConfirmation', () => {
  it('renders the confirmation Markdown', () => {
    const form = parse('---\ntitle: T\nconfirmation: |\n  Thanks, **see you**!\n\n  # Next steps\n---\n? Q\n___').form;
    const html = renderConfirmation(form);
    expect(html).toContain('<div class="askdown askdown-confirmation" role="status">');
    expect(html).toContain('<h1 class="askdown-title">T</h1>');
    expect(html).toContain('<p>Thanks, <strong>see you</strong>!</p>');
    expect(html).toContain('<h2>Next steps</h2>');
  });

  it('falls back to a default message', () => {
    expect(renderConfirmation({ askdown: '0.1', pages: [] })).toContain('<p>Your response has been recorded.</p>');
  });
});

describe('addressPartsHtml', () => {
  const q = parse('? Address *\n[address]').form.pages[0]!.items[0] as AddressQuestion;

  it('carries values over to the parts the new country has', () => {
    const values = { street: 'Keizersgracht 1', postalCode: '1015 AA', city: 'Amsterdam', region: 'Noord-Holland' };
    const nl = addressPartsHtml(q, 'nl', values);
    expect(nl).toContain('data-country="NL"');
    expect(nl).toContain('>Keizersgracht 1</textarea>');
    expect(nl).toContain('value="1015 AA"');
    expect(nl).toContain('value="Amsterdam"');
    expect(nl).not.toContain('Noord-Holland');
    expect(nl).not.toContain('name="q.address.region"');
    // Back to the generic format: the region field returns, empty.
    const generic = addressPartsHtml(q, '', { street: 'Keizersgracht 1', city: 'Amsterdam' });
    expect(generic).toContain('data-country=""');
    expect(generic).toContain('<input class="askdown-input" type="text" id="askdown-address-region" name="q.address.region" autocomplete="address-level1" aria-describedby="askdown-address-error">');
  });

  it('matches a typed region name or code against the list', () => {
    expect(addressPartsHtml(q, 'CA', { region: 'ontario' })).toContain('<option value="ON" selected>Ontario</option>');
    expect(addressPartsHtml(q, 'CA', { region: 'on' })).toContain('<option value="ON" selected>Ontario</option>');
    expect(addressPartsHtml(q, 'CA', { region: 'Nowhere' })).toContain('<option value="" selected>Choose…</option>');
  });

  it('uses the id prefix and invalid state', () => {
    const html = addressPartsHtml(q, 'GB', undefined, { idPrefix: 'p1', invalid: true });
    expect(html).toContain('id="p1-address-city" name="q.address.city" autocomplete="address-level2" required aria-describedby="p1-address-error" aria-invalid="true"');
    expect(html).toContain('>Town/City</label>');
    // GB: city before postcode, still paired in a row.
    expect(html).toContain('<div class="askdown-address-row"><div class="askdown-address-field askdown-address-field--city">');
  });
});
