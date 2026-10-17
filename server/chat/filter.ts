// Chat filter: masks profanity, phone numbers, links (addresses, emails) and messenger IDs with '*'.
// Ported from inhyk/inhyuk-world services/net/src/filter.js (origin/main 0ea3655, 2026-10-05), whose server
// runs every chat line through it before anyone else sees it; tests in filter.test.mjs come from its filter.test.js.
import { BAD_WORDS, ALLOWED } from './badwords.ts';

export const CHAT_MAX = 200;
export type Kind = 'profanity' | 'phone' | 'link' | 'contact';
type Range = [number, number];

// Invisible characters used to split a word are removed before anything else.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f\u00ad\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u3164\ufeff\uffa0]/g;
const INVISIBLE_ONE = new RegExp(INVISIBLE.source);
const LETTER = /\p{L}/u;
const SPACE = /\s/;
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const KOREAN_DIGITS: Record<string, number> = { 공: 1, 영: 1, 일: 1, 이: 1, 삼: 1, 사: 1, 오: 1, 육: 1, 륙: 1, 칠: 1, 팔: 1, 구: 1 };
// "공일공에 일이삼사에": '에' between digit groups still reads as one number.
const PHONE_SEPARATOR = /[\s\-.·_/()~ㅡ—,+에]/;
// O, I and l next to a digit count as digits ("O1O-I234-5678").
const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1' };
// Full stops that NFKC leaves alone (。 ｡ ︒ ﹒).
const DOT_LIKE = /[\u3002\uff61\ufe12\ufe52]/g;

const TLD = '(?:com|net|org|kr|co|io|me|gg|ly|xyz|app|dev|tv|be|link|site|online|shop|info|biz|to|im|us|so|ai|jp|cn|cc|ws|fm|page|club|live|store)';
const DOT = '(?:\\s*(?:\\.|닷|dot|\\(dot\\)|\\[dot\\])\\s*)';
const PATTERNS: [Kind, RegExp][] = [
  ['link', /(?:https?:\/\/|www\.)[^\s]+/giu],
  ['link', new RegExp(`[a-z0-9._%+-]+\\s*(?:@|골뱅이|\\(at\\)|\\[at\\])\\s*[a-z0-9-]+(?:${DOT}[a-z0-9-]+)*`, 'giu')],
  ['link', new RegExp(`(?<![a-z0-9])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:${DOT}[a-z0-9-]+)*${DOT}${TLD}(?![a-z0-9])(?:/[^\\s]*)?`, 'giu')],
  ['link', /[a-z0-9-]{2,}\s*(?:닷컴|닷넷|닷케이알|점컴|쩜컴)/giu],
  ['contact', /(?<![a-z0-9_])@[a-z0-9_.]{3,}/giu],
  ['contact', /[a-z0-9_.]{2,}#\d{4}(?!\d)/giu],
  ['contact', /(?:카톡|카카오톡?|카카오|kakao(?:talk)?|katalk|k-?talk|디코|디스코드|discord|인스타(?:그램)?|insta(?:gram)?|라인|텔레(?:그램)?|telegram|오픈\s*(?:채팅|톡|카톡)|오카|페북|페이스북|facebook|스냅챗|snapchat|틱톡|tiktok|트위터|twitter|아이디|아디|(?<![a-z])id|계정|친추)\s*(?:아이디|아디|id|계정|주소|친추|닉네임|닉|nick(?:name)?)?(?:\s*[:：=]\s*|\s*(?:은|는|이|가|로|으로)?\s+|\s*(?:은|는|이|가|로|으로)\s*)([a-z0-9_.-]{3,})/giu],
  // An ID written straight after a Korean messenger name ("카톡아이디abc123"). English words (id, idea) written together are not IDs.
  ['contact', /(?:카톡|카카오톡?|카카오|디코|디스코드|인스타(?:그램)?|라인|텔레(?:그램)?|오카|페북|페이스북|스냅챗|틱톡|트위터|아이디|아디|계정|친추)(?:아이디|아디|닉네임|닉|계정|주소)?[a-z0-9_.-]{3,}/giu],
];

type Letter = { c: string; at: number; seg: number };
function toSkeleton(text: string) {
  // Letters only (spaces, digits and symbols skipped), each with its position in the text and its word number.
  const letters: Letter[] = [];
  let seg = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SPACE.test(ch)) { seg++; continue; }
    if (!LETTER.test(ch)) continue;
    // NFKC would turn Hangul jamo (ㅅ, ㅂ) into other letters, so they stay; full-width Latin (ｆｕｃｋ) is folded.
    const plain = HANGUL.test(ch) ? ch : ch.normalize('NFKC').toLowerCase();
    for (const c of plain) letters.push({ c, at: i, seg });
  }
  return { letters, text: letters.map(l => l.c).join('') };
}

function occurrences(haystack: string, needle: string) {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

function profanityRanges(text: string) {
  const { letters, text: skeleton } = toSkeleton(text);
  const safe: Range[] = [];
  for (const word of ALLOWED) for (const at of occurrences(skeleton, word)) safe.push([at, at + word.length]);
  const ranges: Range[] = [];
  for (const word of BAD_WORDS) {
    for (const a of occurrences(skeleton, word)) {
      const b = a + word.length;
      if (safe.some(([s, e]) => s <= a && b <= e)) continue;
      const first = letters[a].seg, last = letters[b - 1].seg;
      // Across two words ("다시 발로") it counts only when whole word pieces fall inside the bad word ("시 발" does).
      if (first !== last && ((a > 0 && letters[a - 1].seg === first) || (b < letters.length && letters[b].seg === last))) continue;
      ranges.push([letters[a].at, letters[b - 1].at + 1]);
    }
  }
  return ranges;
}

// Eight or more digits are a phone number; seven only when split into groups ("123-4567"). With `min`, that many or more.
function phoneRanges(text: string, min = 0) {
  // Number syllables inside ordinary words ("이야", "사람") are not digits. Words made only of number
  // syllables and the separator "에" are kept; positions do not move.
  text = text.replace(/[가-힣]+/g, word => /^[공영일이삼사오육륙칠팔구에]+$/.test(word)
    ? word : word.replace(/[공영일이삼사오육륙칠팔구]+/g, digits => digits.length >= 3 ? digits : '\0'.repeat(digits.length)));
  const ranges: Range[] = [];
  const isDigit = (ch: string) => /[0-9]/.test(ch) || !!KOREAN_DIGITS[ch];
  let i = 0;
  while (i < text.length) {
    if (!isDigit(text[i]) && !(text[i] === '+' && isDigit(text[i + 1] ?? ''))) { i++; continue; }
    const start = i;
    let digits = 0, last = i, gap = 0, groups = 1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (isDigit(ch)) { if (gap && digits) groups++; digits++; last = i; gap = 0; continue; }
      if (PHONE_SEPARATOR.test(ch) && gap < 3) { gap++; continue; }
      break;
    }
    if (min ? digits >= min : digits >= 8 || (digits === 7 && groups >= 2)) ranges.push([start, last + 1]);
    i = last + 1;
  }
  return ranges;
}

type Copy = { text: string; map: number[] };
// A copy to search: each character NFKC-folded (full-width ｅｘａｍｐｌｅ．ｃｏｍ, ｈｔｔｐｓ), full-stop look-alikes as '.',
// invisible characters dropped. map[k] is the index in the original text of the copy's k-th character, to mask the original.
function detectionCopy(text: string): Copy {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (INVISIBLE_ONE.test(ch)) continue;
    const plain = (HANGUL.test(ch) ? ch : ch.normalize('NFKC')).replace(DOT_LIKE, '.');
    for (let k = 0; k < plain.length; k++) { out += plain[k]; map.push(i); }
  }
  return { text: out, map };
}

// For phone numbers: O, I and l next to a digit become digits (same length).
function phoneCopy(text: string) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const swap = DIGIT_LOOKALIKE[text[i]];
    out += swap && (/[0-9]/.test(text[i - 1] ?? '') || /[0-9]/.test(text[i + 1] ?? '')) ? swap : text[i];
  }
  return out;
}

// For links: joins letters spelled out one by one ("n a v e r . c o m"). A space goes only between Latin letters,
// digits or '.', when the word before or after it is one character long.
function collapseSpaced({ text, map }: Copy): Copy {
  let out = '';
  const outMap: number[] = [];
  const wordLength = (from: number, step: number) => { let n = 0; for (let k = from; k >= 0 && k < text.length && !SPACE.test(text[k]); k += step) n++; return n; };
  for (let i = 0; i < text.length; i++) {
    if (SPACE.test(text[i])) {
      let end = i;
      while (end < text.length && SPACE.test(text[end])) end++;
      const ascii = (ch: string | undefined) => /[a-z0-9./:]/i.test(ch ?? '');
      if (i > 0 && end < text.length && ascii(text[i - 1]) && ascii(text[end]) && (wordLength(i - 1, -1) === 1 || wordLength(end, 1) === 1)) { i = end - 1; continue; }
    }
    out += text[i];
    outMap.push(map[i]);
  }
  return { text: out, map: outMap };
}

const back = (map: number[], a: number, b: number): Range => [map[a], map[b - 1] + 1];

// What to mask (positions in the original text) and of which kinds.
function detect(text: string) {
  const kinds = new Set<Kind>(), ranges: Range[] = [];
  const add = (kind: Kind, list: Range[]) => { if (list.length) { kinds.add(kind); ranges.push(...list); } };
  add('profanity', profanityRanges(text));
  const copy = detectionCopy(text);
  add('phone', phoneRanges(phoneCopy(copy.text)).map(([a, b]) => back(copy.map, a, b)));
  const spaced = collapseSpaced(copy);
  for (const [kind, re] of PATTERNS) {
    const list: Range[] = [];
    for (const m of copy.text.matchAll(re)) list.push(back(copy.map, m.index!, m.index! + m[0].length));
    if (kind === 'link') for (const m of spaced.text.matchAll(re)) list.push(back(spaced.map, m.index!, m.index! + m[0].length));
    add(kind, list);
  }
  return { ranges, kinds: [...kinds] };
}

function mask(text: string, ranges: Range[]) {
  if (!ranges.length) return text;
  const hide = new Uint8Array(text.length);
  for (const [a, b] of ranges) hide.fill(1, a, b);
  let out = '';
  for (let i = 0; i < text.length; i++) out += hide[i] && !SPACE.test(text[i]) ? '*' : text[i];
  return out;
}

/** Filters a chat line: trimmed, cut to `max` characters, with everything found masked. */
export function filterText(input: unknown, { max = CHAT_MAX } = {}): { text: string; kinds: Kind[] } {
  let text = String(input ?? '').normalize('NFC').replace(INVISIBLE, '').replace(/\s*[\r\n\t]+\s*/g, ' ').trim();
  if ([...text].length > max) text = [...text].slice(0, max).join('');
  const { ranges, kinds } = detect(text);
  return { text: mask(text, ranges), kinds };
}

/** For strings inside game data: spaces, length and invisible characters stay; only what is found becomes '*'. */
export function maskText(input: unknown) {
  let text = String(input ?? '');
  if (text.length < 2) return text;
  const nfc = text.normalize('NFC');
  if (nfc !== text) text = nfc;
  const { ranges } = detect(text);
  return mask(text, ranges);
}

/**
 * Stops a phone number sent over several lines ("010" / "1234" / "5678"). `previous`: the sender's lines from
 * the last 30 s. When digits running from an earlier line into this one reach nine, the part in this line is
 * masked; lines already sent are left as they were.
 */
export function maskSplitPhone(previous: readonly string[], current: string) {
  if (!previous.length || !current) return current;
  const joined = [...previous, current].join(' ');
  const offset = joined.length - current.length;
  const copy = detectionCopy(joined);
  const ranges = phoneRanges(phoneCopy(copy.text), 9)
    .map(([a, b]) => back(copy.map, a, b))
    .filter(([a, b]) => a < offset && b > offset)
    .map(([, b]): Range => [0, b - offset]);
  return mask(current, ranges);
}

export function hasProfanity(text: unknown) {
  return profanityRanges(String(text ?? '').normalize('NFC').replace(INVISIBLE, '')).length > 0;
}

/** What strangers see instead of a character name with a bad word or contact details in it. */
export const NEUTRAL_NAME = '게 모험가';
/** A name with profanity, contact details or a long run of digits (as the hub's nickname rule) is not shown. */
export const nameAllowed = (name: string) => !hasProfanity(name) && !filterText(name).kinds.length && (name.match(/[0-9]/g)?.length ?? 0) < 7;
