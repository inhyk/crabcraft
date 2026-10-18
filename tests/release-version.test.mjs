import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, releases } from '../tools/release-version.mjs';

test('the first release is 1.0.0', () => {
  assert.deepEqual(nextVersion(undefined, null, '2026-10-19'), [1, 0, 0]);
});

test('the first release of a day bumps minor, later ones that day bump patch', () => {
  assert.deepEqual(nextVersion([1, 0, 0], '2026-10-18', '2026-10-19'), [1, 1, 0]);
  assert.deepEqual(nextVersion([1, 1, 0], '2026-10-19', '2026-10-19'), [1, 1, 1]);
  assert.deepEqual(nextVersion([1, 1, 4], '2026-10-19', '2026-10-20'), [1, 2, 0]);
});

test('releases sorts v<semver> tags by version and ignores other tags', () => {
  const list = ['v1.2.0', 'v1.10.0', 'v1.9.3', 'snapshot', 'v2.0', 'v1.10.1'].join('\n');
  assert.deepEqual(releases(list).map(r => r.tag), ['v1.10.1', 'v1.10.0', 'v1.9.3', 'v1.2.0']);
  assert.deepEqual(releases(''), []);
});
