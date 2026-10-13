# Askdown 0.1

**Status:** Draft · **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · **JSON Schema:** [/schema/v0.1.json](/schema/v0.1.json)

Askdown is a plain-text language for writing forms. It looks like Markdown, reads well as a plain file, and renders sensibly on sites that show Markdown, such as GitHub. Every Askdown document maps to a JSON form model, described by a JSON Schema, so tools can work with either representation.

This document specifies both. The key words "MUST", "MUST NOT", "SHOULD" and "MAY" are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

```askdown
---
title: DevConf RSVP
submit: Send RSVP
---

? Full name *
___

? Will you attend? *
- ( ) Yes
- ( ) No -> #bye

-> submit

--- {#bye}

# Sorry to miss you

? Why not?
___
___
```

## 1. Documents

An Askdown document is UTF-8 text. Implementations MUST treat `\r\n` and `\r` as line endings equivalent to `\n`. The recommended file extension is `.ask`, and the recommended media type is `text/markdown`. Since Askdown documents are also Markdown, `.md` MAY be used where tools should render them as Markdown.

A document consists of optional [front matter](#2-front-matter) followed by a body. The body is a sequence of lines, which are grouped into:

- [**questions**](#3-questions), which start with a `?` line;
- [**page breaks**](#5-pages), which are lines of three or more dashes;
- [**page jumps**](#52-jumps), which are lines starting with `->`;
- **content**: every other line, which is Markdown.

Parsers MUST NOT fail on any input. Problems are reported as *diagnostics*, each with a severity (`error` or `warning`), a message, and a line and column. A document with error diagnostics is invalid, but parsers SHOULD still produce the best possible form, so editors can show a preview while the user types.

## 2. Front matter

If the first line of a document is exactly `---`, the lines up to the next `---` line are front matter. Front matter holds form settings as a small subset of YAML: one `key: value` per line.

```yaml
---
title: Customer survey
description: |
  A few questions about your experience.

  It takes about **two minutes**.
submit: Send
confirmation: Thanks for your feedback!
---
```

| Key | Type | JSON | Meaning |
|---|---|---|---|
| `title` | string | `title` | Form title |
| `description` | string | `description` | Markdown shown under the title |
| `submit` | string | `settings.submitLabel` | Label of the submit button |
| `confirmation` | string | `settings.confirmation` | Markdown shown after submitting |

Values are plain text up to the end of the line. A value MAY be double-quoted (with JSON string escapes) or single-quoted (with `''` for a quote). Text after ` #` in an unquoted value is a comment. `|` starts a block of indented lines that keeps line breaks; `>` joins them with spaces. Lines starting with `#` are comments.

Unknown keys produce a warning.

## 3. Questions

A question starts with a line beginning with `?` and a space, followed by the label:

```askdown
? What is your name? * {#name}
```

- A `*` at the end of the label makes the question **required**.
- An attribute block `{#id}` at the end of the line sets the question's **id**.

The question continues on the following lines, up to the first blank line, page break, or next question. Leading whitespace on these lines is ignored. Each line is one of:

| Line | Meaning |
|---|---|
| `> text` | Help text, shown below the label. Markdown. Consecutive lines are joined with line breaks. |
| `[type attributes]` | The [question type](#4-question-types) and its attributes. At most one per question. |
| `___` | A text answer. Three or more underscores. |
| `- ( ) label` | A single-choice option. |
| `- [ ] label` | A multiple-choice option. |
| `- label` | An option without a marker. |
| `1. label` | A ranking option. Any number followed by `.` or `)`. |
| `\| cell \| cell \|` | A table row, for grids. |

Any other line is an error. A line that looks like part of a question, but is separated from it by a blank line, SHOULD produce a warning.

### 3.1 Ids

Every question has an id. Answers are stored under this id, so it SHOULD stay the same once a form is in use.

Explicit ids match `[A-Za-z0-9][A-Za-z0-9_-]*`. A question without an explicit id gets one derived from its label:

1. Decompose the label (Unicode NFKD) and remove combining marks.
2. Lowercase it, and replace each run of characters other than `a`–`z` and `0`–`9` with `-`.
3. Remove leading and trailing dashes, and truncate to 40 characters (removing any trailing dash again).
4. If the result is empty, use `q`.
5. If the id is already taken, append `-2`, `-3`, and so on, until it is unique.

Explicit ids are reserved first, so a derived id never collides with an explicit id anywhere in the document. Derived ids are then assigned in document order. Duplicate explicit ids are an error.

Tools that publish a form SHOULD pin ids by writing an explicit `{#id}` on every question, so that later edits to a label don't change the id.

### 3.2 Attributes

A `[type ...]` line takes attributes separated by whitespace:

- `key=value`, where the value is either a bare word or double-quoted with `\` escapes: `placeholder="Your name"`.
- A bare flag: `shuffle`.
- A positional value, used by `scale` and `rating`: `1..5`, `"Low"`.

Attribute names are case-insensitive. Unknown attributes produce a warning.

### 3.3 Choice values and flags

Each individual choice — an [option](#42-choices) and a grid [row or column](#45-grids) — MAY carry a trailing attribute block `{…}` after its label:

```askdown
? Can you make it?
- ( ) Available {yes}
- ( ) Not sure {maybe .muted}
- ( ) Can't make it {no}
```

Inside the block:

- a bare word is the **value**;
- each `.word` is a **flag**.

The **value** is what a response stores. It defaults to the label, so authors can reword or translate a label without changing stored responses. Values within one question MUST be unique (two choices with the same effective value is an error); labels need not be. Ids (`#id`) are not allowed here.

**Flags** are lowercase hints a renderer MAY use, emitted as classes or data attributes. Implementations SHOULD recognise `positive`, `neutral` and `negative` as a green / amber / red accent, and SHOULD apply the same accent when a choice's value is `yes`, `maybe` or `no` (case-insensitive) and no colour flag is set. Colour MUST NOT be the only way an answer's meaning is conveyed. Other flags are free-form theme hooks.

## 4. Question types

The type is set explicitly with `[type]`. Without one, it is inferred from the answer lines:

1. options with `( )` markers, or without markers: `radio`
2. options with `[ ]` markers: `checkbox`
3. numbered options: `ranking`
4. a table: `grid`
5. two or more `___` lines: `paragraph`
6. otherwise: `text`

Mixing `( )`, `[ ]` and numbered options in one question is an error.

| Type | Answer | Attributes | JSON properties |
|---|---|---|---|
| `text` | Short text | `placeholder`, `minlength`, `maxlength`, `pattern` | `placeholder`, `minLength`, `maxLength`, `pattern` |
| `paragraph` | Long text | `placeholder`, `minlength`, `maxlength` | `placeholder`, `minLength`, `maxLength` |
| `email` | Email address | `placeholder` | `placeholder` |
| `url` | http(s) URL | `placeholder` | `placeholder` |
| `phone` | Phone number | `placeholder`, `country` | `placeholder`, `country` |
| `number` | Number | `placeholder`, `min`, `max`, `step` | `placeholder`, `min`, `max`, `step` |
| `date` | `YYYY-MM-DD` | `min`, `max` | `min`, `max` |
| `time` | `HH:MM` | `min`, `max` | `min`, `max` |
| `radio` | One option | `shuffle` | `options`, `other`, `shuffle` |
| `checkbox` | Several options | `shuffle`, `min`, `max` | `options`, `other`, `shuffle`, `minSelected`, `maxSelected` |
| `select` | One option, from a dropdown | `shuffle` | `options`, `shuffle` |
| `ranking` | Every option, in order | `shuffle` | `options`, `shuffle` |
| `scale` | Integer in a range | `a..b`, two quoted labels, `minlabel`, `maxlabel` | `min`, `max`, `minLabel`, `maxLabel` |
| `rating` | Integer from 1 to max | max (positional), `max` | `max` |
| `grid` | One column per row | — | `rows`, `columns` |
| `checkbox-grid` | Several columns per row | — | `rows`, `columns` |
| `file` | Uploaded files | `accept`, `maxsize`, `maxfiles` | `accept`, `maxSize`, `maxFiles` |
| `address` | Postal address | `country` | `country` |

`checkboxes`, `dropdown` and `textarea` are accepted as aliases for `checkbox`, `select` and `paragraph`.

### 4.1 Text

```askdown
? Name *
___

? Bio
___
___

? Postcode
[text placeholder="1234 AB" pattern="\d{4} ?[A-Z]{2}"]
```

`pattern` is a regular expression that the whole answer MUST match, with the same semantics as the HTML `pattern` attribute. `minlength` and `maxlength` count Unicode code points.

`___` lines are allowed after an explicit type and are ignored. This lets authors keep the visual hint: `[email]` followed by `___`.

### 4.2 Choices

```askdown
? Favorite color
- ( ) Red
- (x) Green
- ( ) Other: ___

? Toppings
[checkbox max=2]
- [x] Cheese
- [ ] Olives

? Country
[select]
- Netherlands
- Canada
```

- `(x)` or `[x]` marks an option as selected by default. A `radio` or `select` question SHOULD have at most one default.
- An option whose label ends with `___` is the **other** option: it adds a free-text answer. The text before the `___` (and an optional `:`) is its label, or `Other` if empty. There is at most one other option, and it is not allowed on `select`.
- Option **values** within a question MUST be unique. An option MAY set a value and flags with `{…}` — see [choice values and flags](#33-choice-values-and-flags).
- An option MAY end with a [jump](#52-jumps): `-> #page-id`. When combined with `{…}`, the jump comes last: `- ( ) No {no} -> #bye`.

### 4.3 Rankings

```askdown
? Rank these features, most important first
1. Dark mode
2. Offline sync
3. Export
```

A ranking asks the respondent to put all of its options in order. The numbers are only a visual hint: the options are presented in the order they are written (or shuffled, with `shuffle`), and the numbers themselves are ignored. Options without a number (`- label`) are also allowed after `[ranking]`.

A ranking needs at least two options. Options can't be selected by default, and can't have a jump or an **other** option.

The answer lists every option label exactly once, highest ranked first. A partial ranking is not a valid answer. An implementation MUST NOT treat the initial order as an answer unless the respondent has ranked the options.

### 4.4 Scale and rating

```askdown
? How likely are you to recommend us?
[scale 0..10 "Not likely" "Very likely"]

? Rate the food
[rating 5]
```

A scale defaults to `1..5` and has at most 11 steps. A rating defaults to 5, with a maximum between 2 and 10.

### 4.5 Grids

```askdown
? Which of these can you attend?
[grid]
| | Yes | Maybe | No |
| Keynote  |
| Workshop |
```

The first table row lists the columns, starting from its second cell. Every following row is a grid row, labelled by its first cell. Other cells and separator rows are ignored. Row and column **values** MUST be unique, and labels MUST be non-empty. For a required grid, every row must be answered.

A single-choice `[grid]` takes one column per row; `[checkbox-grid]` takes several. Each row and column is a [choice](#33-choice-values-and-flags): it MAY set a value and flags with `{…}`, so a column like `| Love it {yes} | Meh {maybe} | Nope {no} |` colours green/amber/red while its headings stay free to reword. Columns labelled plainly `Yes`/`Maybe`/`No` colour automatically, because their values default to those words.

### 4.6 Files

```askdown
? Resume *
[file accept=".pdf,.docx" maxsize=10MB maxfiles=2]
```

`accept` is a comma-separated list of extensions (`.pdf`) and media types (`image/*`, `application/pdf`), as in HTML. `maxsize` accepts `B`, `KB`, `MB` and `GB`, using binary multiples (1KB = 1024 bytes). In JSON, `maxSize` is in bytes. `maxFiles` defaults to 1.

### 4.7 Addresses

```askdown
? Shipping address *
[address country=NL]
```

An address has a street (which MAY span several lines), a city, a region (state or province), a postal code and a country. The street, city and country are required in an answer; the region and postal code are optional, because many countries don't use them.

`country` is an [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) code, case-insensitive in the text and uppercase in JSON. When it is set, the country is fixed: it isn't asked, and every answer has that country. Implementations SHOULD show country names rather than codes.

### 4.8 Phone numbers

```askdown
? Mobile number
[phone country=NL]
```

The answer is an [E.164](https://www.itu.int/rec/T-REC-E.164) string: `+`, the country calling code and the number, without spaces, such as `+31612345678`.

`country` is an ISO 3166-1 alpha-2 code (case-insensitive in the text, uppercase in JSON). It sets the default country for national numbers; unlike in `address`, the respondent can change it. Implementations SHOULD let respondents pick a country, and MAY show flags. A number typed with a leading `+` or `00` is international and ignores the country. Otherwise the country's calling code is prefixed, and a leading trunk `0` is dropped (`06 1234 5678` in NL is `+31612345678`), except in countries where it is part of the number, such as Italy.

## 5. Pages

A line of three or more dashes starts a new page (a *section*). A page break MAY carry an id:

```text
--- {#details}
```

A `#` heading at the start of a page (before anything else) is the page title. On the first page, a leading `#` heading is the form title instead, unless the front matter sets a title. To start a page with a level 1 heading that is not the title, escape it as `\#`.

A page break before any other body content doesn't create an empty first page. It sets the first page's id and jump instead.

Pages without an explicit id get an id derived from the title, the same way as question ids, or `page-N` (1-based) when there is no title.

Because `---` is a page break, Markdown content uses `***` for a horizontal rule.

### 5.1 Content

Lines that are not part of a question, a page break or a page jump are Markdown content. Consecutive content lines, including blank lines, form one content block. Inside fenced code blocks (```` ``` ```` or `~~~`), question, page-break and jump syntax isn't recognized. To start a content line with `?` followed by a space, escape it as `\?`; to write a line that would be a page jump, escape it as `\->`.

Implementations MUST render Markdown safely: raw HTML MUST be escaped or sanitized, and links MUST NOT use `javascript:` or other script-capable URL schemes. Implementations SHOULD support at least paragraphs, headings, lists, blockquotes, code, emphasis, links and images.

### 5.2 Jumps

A jump sends the respondent to another page. Its target is `#page-id`, or `submit` to end the form.

- An option of a `radio` or `select` question MAY have a jump. It applies when that option is chosen. Jumps on checkbox options are ignored with a warning.
- A page MAY have a page jump: a line containing only `->` and a target, outside any question. It applies after that page when no option jump applies. It is conventionally written at the end of the page:

  ```askdown
  ? Invoice number
  ___

  -> submit
  ```

  The page jump MAY instead be written on the page break that starts the page: `--- {#billing} -> submit`. A page has at most one page jump.

After a page, the next page is determined as follows:

1. The last `radio` or `select` question on the page whose chosen option has a jump decides.
2. Otherwise, the page's own jump applies.
3. Otherwise, the next page follows, or the form is submitted after the last page.

A jump to an unknown page is an error. Jumping to the same or an earlier page produces a warning. Implementations MUST stop when a page would be visited twice.

## 6. JSON form model

The JSON model is described by the [JSON Schema](/schema/v0.1.json). Here is the first example as JSON:

```json
{
  "$schema": "https://askdown.dev/schema/v0.1.json",
  "askdown": "0.1",
  "title": "DevConf RSVP",
  "settings": { "submitLabel": "Send RSVP" },
  "pages": [
    {
      "id": "page-1",
      "next": "submit",
      "items": [
        { "id": "full-name", "type": "text", "label": "Full name", "required": true },
        {
          "id": "will-you-attend",
          "type": "radio",
          "label": "Will you attend?",
          "required": true,
          "options": [{ "label": "Yes" }, { "label": "No", "goto": "bye" }]
        }
      ]
    },
    {
      "id": "bye",
      "title": "Sorry to miss you",
      "items": [{ "id": "why-not", "type": "paragraph", "label": "Why not?" }]
    }
  ]
}
```

- `askdown` is the spec version, `"0.1"`.
- A page's `items` are questions and content blocks (`{ "type": "content", "markdown": "…" }`).
- Optional properties are omitted rather than `null`. Boolean properties are omitted when `false`.
- Question ids and page ids are each unique within a form.

A conforming parser MUST produce the JSON model described here, and a conforming serializer MUST produce text that parses back to an equal model. The [examples](https://github.com/askdown/askdown/tree/main/spec/examples) directory contains pairs of `.ask` and `.json` files for conformance testing.

## 7. Responses

A response maps question ids to answers:

| Question type | Answer |
|---|---|
| `text`, `paragraph`, `email`, `url`, `date`, `time` | string |
| `radio`, `select` | string: the chosen option value, or the other text |
| `checkbox` | array of strings: chosen values in option order, then the other text |
| `ranking` | array of strings: every option value, highest ranked first |
| `number`, `scale`, `rating` | number |
| `grid` | object: row value → column value |
| `checkbox-grid` | object: row value → array of column values |
| `file` | array of [file objects](#71-files) |
| `phone` | string: an E.164 number, such as `+31612345678` |
| `address` | object with `street`, `city`, `country` and optionally `region` and `postalCode`; `country` is an uppercase ISO 3166-1 alpha-2 code |

A choice's value defaults to its label (see [§3.3](#33-choice-values-and-flags)), so for a form that sets no explicit values these are the labels verbatim.

```json
{
  "full-name": "Ada Lovelace",
  "will-you-attend": "Yes",
  "which-days": ["Day 1", "I'll decide later"],
  "rate-the-sessions": { "Keynote": "Great" }
}
```

When validating a response, implementations MUST:

1. Trim answers. An empty string, empty array or empty object is no answer.
2. Determine the pages the respondent visits, following [jumps](#52-jumps) with the given answers.
3. Only check questions on visited pages, and discard answers to questions on other pages.
4. Reject a missing answer to a required question, and answers that don't satisfy the question's constraints.

### 7.1 Files

In a response, each uploaded file is an object with these properties, all REQUIRED:

| Property | Type | Meaning |
|---|---|---|
| `name` | string | The original file name |
| `size` | integer | Size in bytes |
| `type` | string | Media type, or `""` if unknown |
| `uri` | string | A URI reference ([RFC 3986](https://www.rfc-editor.org/rfc/rfc3986)) to the file's contents |

The `uri` MAY be a `data:` URL ([RFC 2397](https://www.rfc-editor.org/rfc/rfc2397)) with the file inlined, or an absolute or relative URL where the implementation stored the file. A relative reference is resolved against a base URI chosen by the implementation, typically the URL the response was retrieved from. Retrieving the file MAY require authorization.

```json
{
  "resume": [
    { "name": "cv.pdf", "size": 48213, "type": "application/pdf", "uri": "/forms/f1/files/r1/resume/0-cv.pdf" }
  ],
  "photo": [
    { "name": "dot.png", "size": 68, "type": "image/png", "uri": "data:image/png;base64,iVBORw0KGgo..." }
  ]
}
```

How files are submitted, and which forms of submission an implementation accepts, is implementation-specific. The question's constraints (`accept`, `maxSize` and `maxFiles`) apply however a file arrives.

## Changelog

- **0.1** (2026-09): First draft.
