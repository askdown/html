/**
 * @askdown/html — server-side (isomorphic) rendering of Askdown forms.
 *
 * INTERFACE CONTRACT (implemented in render.ts / read-answers.ts):
 *
 * Field naming in the rendered <form>:
 *   q.<id>              value(s) of a question (checkbox: repeated name)
 *   q.<id>.other        free text of the "other" option; the radio/checkbox
 *                       itself uses the value OTHER_VALUE
 *   q.<id>.<rowIndex>   grid rows (0-based index into question.rows)
 *   q.<id>.<optionIndex> ranking: the 1-based rank of each option (0-based
 *                       index into question.options), "" when unranked
 *   q.<id>.<part>       address parts: street, city, region, postalCode,
 *                       country
 *   q.<id>.country      phone: the ISO country of the number in q.<id>;
 *                       readAnswers combines the two into an E.164 string
 *   _hp                 honeypot text input, must stay empty
 */
import type { Answers, Form } from '@askdown/core';

export const OTHER_VALUE = '__other__';

export interface RenderOptions {
  /** Form action URL. Defaults to "" (same URL). */
  action?: string;
  /** Previously submitted values, to re-fill the form after a failed submit. */
  values?: Record<string, unknown>;
  /** Error message per question id. */
  errors?: Record<string, string>;
  /** Extra hidden inputs, e.g. a CSRF token. */
  hidden?: Record<string, string>;
  /** Builder preview: never actually submits. */
  preview?: boolean;
  /** Prefix for element ids, so several forms can live on one page. */
  idPrefix?: string;
}

export interface ReadResult {
  /** Raw answers keyed by question id, ready for validateResponse(). Files become FileRef objects. */
  answers: Record<string, unknown>;
  /** Uploaded File objects per file question id. */
  files: Record<string, File[]>;
  /** True when the honeypot was filled in (likely a bot). */
  spam: boolean;
}

export { renderForm, renderConfirmation, addressPartsHtml, sentimentOf, type AddressPartsOptions } from './render.ts';
export { readAnswers } from './read-answers.ts';
export type { Answers, Form };
