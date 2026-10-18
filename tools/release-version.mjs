#!/usr/bin/env node
// Release versions (AGENTS.md "버전과 릴리스"). The version is package.json "version"; main deploys
// tag it v<version>. The first release of a day (KST) bumps minor, later releases that day bump
// patch, major only when dad says so. The first version is 1.0.0.
//
//   node tools/release-version.mjs --next    print the next version
//   node tools/release-version.mjs --bump    write the next version into package.json
//   node tools/release-version.mjs --check   fail when package.json is not above the last tag
//                                            (CI: .github/workflows/release-version.yml)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = new URL('../package.json', import.meta.url);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const parse = v => { const m = SEMVER.exec(v); return m ? m.slice(1).map(Number) : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const kstDay = date => new Date(date.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** Released versions from v<semver> tags, newest first, with the tagged commit's date. */
export function releases(list = git('tag', '-l', 'v*')) {
  return list.split('\n').map(t => t.trim()).filter(t => parse(t.slice(1)))
    .map(tag => ({ tag, version: parse(tag.slice(1)) }))
    .sort((a, b) => cmp(b.version, a.version));
}

/** The version the next release should carry. */
export function nextVersion(latest, latestDay, today) {
  if (!latest) return [1, 0, 0];
  return latestDay === today ? [latest[0], latest[1], latest[2] + 1] : [latest[0], latest[1] + 1, 0];
}

function main(mode) {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const current = parse(pkg.version);
  if (!current) throw new Error(`package.json version "${pkg.version}" is not X.Y.Z`);
  const [last] = releases();
  const lastDay = last ? kstDay(new Date(git('log', '-1', '--format=%cI', `${last.tag}^{commit}`))) : null;
  const today = kstDay(new Date());
  const next = nextVersion(last?.version, lastDay, today);
  const show = v => v.join('.');
  if (mode === '--next') { console.log(show(next)); return; }
  if (mode === '--bump') {
    if (cmp(current, next) >= 0) { console.log(`package.json is already ${pkg.version} (next by the rule: ${show(next)})`); return; }
    const text = readFileSync(PKG, 'utf8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${show(next)}$2`);
    writeFileSync(PKG, text);
    console.log(`package.json ${pkg.version} -> ${show(next)}`);
    return;
  }
  if (mode === '--check') {
    const hint = `Run node tools/release-version.mjs --bump on dev (next by the rule: ${show(next)}) and merge it before this release.`;
    if (last && cmp(current, last.version) <= 0) {
      console.error(`::error::package.json is ${pkg.version} but ${last.tag} is already released. ${hint}`);
      process.exit(1);
    }
    if (cmp(current, next) !== 0) console.log(`::warning::package.json is ${pkg.version}; the rule suggests ${show(next)} (last ${last?.tag ?? 'none'} on ${lastDay ?? '-'}, today ${today} KST).`);
    console.log(`release version ${pkg.version} ok (last ${last?.tag ?? 'none'})`);
    return;
  }
  console.error('usage: node tools/release-version.mjs --next | --bump | --check');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]);
