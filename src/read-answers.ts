/**
 * Reads a submitted FormData back into raw answers, using the field naming
 * described in index.ts. Works with the standard FormData and File classes
 * (Cloudflare Workers, browsers and Node 22+).
 */
import { choiceValue, type FileRef, type Form, isQuestion, type Question, toE164 } from '@askdown/core';
import { OTHER_VALUE, type ReadResult } from './index.ts';

function strings(data: FormData, name: string): string[] {
  return data.getAll(name).filter((v): v is string => typeof v === 'string');
}

function string(data: FormData, name: string): string | undefined {
  const v = data.get(name);
  return typeof v === 'string' ? v : undefined;
}

/**
 * Duck-typed check for a File. `instanceof File` is unreliable across realms
 * (Node's undici File vs. the global), so we look at the shape instead.
 */
function isFile(v: unknown): v is File {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as File).name === 'string' &&
    typeof (v as File).size === 'number' &&
    typeof (v as File).arrayBuffer === 'function'
  );
}

function readQuestion(q: Question, data: FormData, out: ReadResult): void {
  const name = `q.${q.id}`;
  switch (q.type) {
    case 'checkbox': {
      let list = strings(data, name);
      if (list.includes(OTHER_VALUE)) {
        const other = (string(data, `${name}.other`) ?? '').trim();
        list = list.filter((v) => v !== OTHER_VALUE);
        if (other !== '') list.push(other);
      }
      if (list.length) out.answers[q.id] = list;
      return;
    }
    case 'radio': {
      const v = string(data, name);
      if (v === undefined) return;
      if (v === OTHER_VALUE) {
        const other = (string(data, `${name}.other`) ?? '').trim();
        if (other !== '') out.answers[q.id] = other;
        return;
      }
      if (v !== '') out.answers[q.id] = v;
      return;
    }
    case 'grid':
    case 'checkbox-grid': {
      // Rows are submitted by index and keyed by their value; the cells
      // already carry the column values (the inputs' value attributes).
      const value: Record<string, string | string[]> = {};
      q.rows.forEach((row, i) => {
        const cells = strings(data, `${name}.${i}`).filter((c) => c !== '');
        if (!cells.length) return;
        value[choiceValue(row)] = q.type === 'grid' ? cells[0]! : cells;
      });
      if (Object.keys(value).length) out.answers[q.id] = value;
      return;
    }
    case 'ranking': {
      // Each option submits its 1-based rank in q.<id>.<optionIndex>, "" when
      // unranked. The answer is the list of ranked option values, best first,
      // so a partial ranking comes out short and core reports "Rank all of
      // the options." Two options sharing a rank (only possible without the
      // runtime) is ambiguous: the later option is reported as a duplicate
      // of the earlier one, so core rejects it with "Rank each option once."
      // and a re-render shows the later option unranked.
      const ranked: { value: string; rank: number; index: number }[] = [];
      q.options.forEach((o, index) => {
        const rank = Number(string(data, `${name}.${index}`) || NaN);
        if (Number.isInteger(rank) && rank >= 1) ranked.push({ value: choiceValue(o), rank, index });
      });
      if (!ranked.length) return;
      ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
      const value: string[] = [];
      ranked.forEach((entry, i) => {
        const previous = ranked[i - 1];
        value.push(previous && previous.rank === entry.rank ? value[i - 1]! : entry.value);
      });
      out.answers[q.id] = value;
      return;
    }
    case 'address': {
      const value: Record<string, string> = {};
      for (const part of ['street', 'city', 'region', 'postalCode', 'country'] as const) {
        const v = string(data, `${name}.${part}`);
        if (v !== undefined && v !== '') value[part] = v;
      }
      if (Object.keys(value).length) out.answers[q.id] = value;
      return;
    }
    case 'phone': {
      // The number as typed plus the country picked, combined into E.164.
      // When that fails (letters, an unknown country code, no country for a
      // national number), the typed text is kept so core reports the error
      // instead of the answer silently disappearing.
      const number = (string(data, name) ?? '').trim();
      if (number === '') return;
      const country = string(data, `${name}.country`);
      out.answers[q.id] = toE164(number, country === undefined ? q.country : country || undefined) ?? number;
      return;
    }
    case 'file': {
      const files: File[] = [];
      for (const entry of data.getAll(name)) {
        if (!isFile(entry)) continue;
        // An empty file input submits a File with no name and size 0.
        if (entry.size === 0 && entry.name === '') continue;
        files.push(entry);
      }
      if (!files.length) return;
      out.files[q.id] = files;
      out.answers[q.id] = files.map((f): FileRef => ({ name: f.name, size: f.size, type: f.type ?? '' }));
      return;
    }
    default: {
      // text, paragraph, email, url, number, date, time, select, scale, rating
      const v = string(data, name);
      if (v !== undefined && v !== '') out.answers[q.id] = v;
    }
  }
}

/** Reads a submitted FormData (browser or Workers) into raw answers. */
export function readAnswers(form: Form, data: FormData): ReadResult {
  const out: ReadResult = { answers: {}, files: {}, spam: false };
  for (const page of form.pages) {
    for (const item of page.items) {
      if (isQuestion(item)) readQuestion(item, data, out);
    }
  }
  const hp = string(data, '_hp');
  out.spam = typeof hp === 'string' && hp.trim() !== '';
  return out;
}
