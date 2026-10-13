# @askdown/html

Renders [Askdown](../../spec/askdown.md) forms to accessible HTML, reads
submissions back from `FormData`, and ships a small vanilla-JS runtime for
paging, branching and inline validation, plus a themeable stylesheet.

The renderer is isomorphic (no DOM or Node APIs), so it runs on Cloudflare
Workers, in Node, and in the browser (the builder preview uses it directly).

## Usage

```ts
import { parse, validateResponse } from '@askdown/core';
import { readAnswers, renderConfirmation, renderForm } from '@askdown/html';

const { form } = parse(source);

// GET: render the form
const html = renderForm(form, {
  action: '/f/my-form',
  hidden: { _csrf: token },
});

// POST: read and validate the submission
const read = readAnswers(form, await request.formData());
if (read.spam) return new Response('Thanks!'); // honeypot was filled in
const result = validateResponse(form, read.answers);
if (!result.valid) {
  const errors = Object.fromEntries(result.errors.map((e) => [e.id, e.message]));
  return renderForm(form, { action: '/f/my-form', values: read.answers, errors });
}
// result.answers is normalized; read.files holds the uploaded File objects
return renderConfirmation(form);
```

Include the stylesheet and the runtime on the page:

```html
<link rel="stylesheet" href="/askdown.css">        <!-- @askdown/html/styles.css -->
<script type="module" src="/askdown-runtime.js"></script>  <!-- @askdown/html/runtime, bundled -->
```

The runtime imports `askdown`, so bundle it (esbuild works out of the box):

```sh
esbuild node_modules/@askdown/html/src/runtime.js --bundle --format=esm --minify --outfile=public/askdown-runtime.js
```

## API

### `renderForm(form, options?) => string`

Returns a complete `<form class="askdown" data-askdown method="post" enctype="multipart/form-data">`.

| Option | Meaning |
|---|---|
| `action` | Form action URL. Defaults to `""`. |
| `values` | Raw answers (as `readAnswers` produces them) to re-fill after a failed submit. When given, option defaults are not applied. |
| `errors` | Error message per question id. Rendered inline and in a summary. |
| `hidden` | Extra hidden inputs, e.g. a CSRF token. |
| `preview` | Adds `data-preview`; the runtime never submits such a form. |
| `idPrefix` | Prefix for element ids (default `askdown`), so several forms can share a page. |

Without JavaScript every page is visible in sequence with one submit button;
the server follows jumps with `validateResponse`. Multi-page forms get
`novalidate`, because native validation can't know which pages were skipped.

Field names in the rendered form:

| Name | Content |
|---|---|
| `q.<id>` | The answer. Checkbox questions repeat the name. |
| `q.<id>.other` | Free text of the "other" option; the option itself has the value `OTHER_VALUE` (`__other__`). |
| `q.<id>.<rowIndex>` | Grid rows, 0-based. Each cell's value is the column's value. |
| `q.<id>.<optionIndex>` | Ranking: the 1-based rank of each option, `""` when unranked. |
| `q.<id>.<part>` | Address parts: `street`, `city`, `region`, `postalCode`, `country`. |
| `q.<id>.country` | Phone: the ISO country of the number in `q.<id>`. |
| `_hp` | Honeypot; must stay empty. |


### Choice classes and data attributes

Every option wrapper (`.askdown-option`, `.askdown-ranking-option`), grid cell
label (`.askdown-grid-cell`) and grid column header (`th[scope=col]`) will have a
`data-value="<value>"`; row headers (`th[scope=row]`) do too. Flags and
sentiment come through as:


| Hook | When |
|---|---|
| `askdown-sentiment-positive` / `-neutral` / `-negative` | A `positive`/`neutral`/`negative` flag, or (without one) a value of `yes`/`maybe`/`no`, case-insensitively. Options and grid *columns* only; rows never have a sentiment. |
| `askdown-flag-<flag>` | Each other flag, e.g. `askdown-flag-muted`. Only flags made of `[a-z0-9-]` become classes. |
| `data-flags="a b"` | The other flags, space-separated; absent when there are none. |


`<option>` elements of a select get the same classes and `data-flags` (their
`value` attribute already holds the value). `sentimentOf(choice)` is exported
for hosts that display responses.

The stylesheet colours sentiments green/amber/red (tokens `--askdown-positive`,
`--askdown-neutral`, `--askdown-negative`, with dark variants): a tinted ring
at rest, the full colour and a soft chip once chosen, and a tinted pill on the
column header. `askdown-flag-muted` lowers the emphasis of an option, column
or cell until it is chosen. Colour is never the only cue; the checked control
and the label text carry the answer.

### `renderConfirmation(form) => string`

The post-submit block: `settings.confirmation` as Markdown, or "Your response has been recorded."

### `readAnswers(form, formData) => ReadResult`

Maps the fields above back to raw answers keyed by question id, ready for
`validateResponse()`. Files become `{ name, size, type }` in `answers` and
`File` objects in `files`, and `spam` is true when the honeypot was filled in.

### Runtime (`@askdown/html/runtime`)

Auto-initializes every `form[data-askdown]` on `DOMContentLoaded`, unless
the form has `data-askdown-manual`. It switches the form to paged mode with
Back/Next navigation, a progress indicator, branching (using the core
`nextPage`), inline validation identical to the server (`checkAnswer`),
"other" inputs, client-side option shuffling and a live region for
announcements. On submit, inputs on skipped pages are disabled so they are
not sent.

```js
import { initForm } from '@askdown/html/runtime';

const controller = initForm(formEl, {
  // Optional: intercept the submission (the builder preview uses this).
  onSubmit(answers, { raw, form }) { /* ... */ },
});
controller.next();   // validate the page and advance
controller.back();
controller.goTo(2);
controller.destroy(); // back to the no-JS layout
```

### Styles (`@askdown/html/styles.css`)

Everything is scoped under `.askdown` and driven by custom properties.
Override them on `.askdown` or any ancestor:

```css
.askdown {
  --askdown-accent: #0f766e;
  --askdown-radius: 8px;
  --askdown-font: "Inter", sans-serif;
  /* yes / maybe / no */
  --askdown-positive: #027a48;
  --askdown-neutral: #b45309;
  --askdown-negative: #b42318;
}
```

Dark mode follows `prefers-color-scheme`; set `data-theme="light"` or
`data-theme="dark"` on the form or an ancestor to force a scheme.
