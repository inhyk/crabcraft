import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { CoreCharacterCodec, IdentityJson, CheckpointJson, GrantJson } from '../../src/sim/persistence.ts';
import { limit, localHost, originAllowed, resolveAccountSession } from '../node/accounts.ts';
import { CharacterStore, CharacterStoreError, type Character } from './character-store.ts';

export interface CharacterHttpPolicy { maxCharactersPerAccount?: number }
export interface CharacterHandlerOptions {
  pool: Pool;
  characters: CharacterStore<IdentityJson, CheckpointJson, GrantJson>;
  codec: CoreCharacterCodec;
  origins: readonly string[];
  clientIp(req: IncomingMessage): string;
  /** Explicit deployment policy. Missing/invalid limit disables both endpoints; there is no slot default. */
  policy: CharacterHttpPolicy | undefined;
}
export type CharacterSummary = { characterId: string; identity: IdentityJson; updatedAt: number };
const summary = (character: Character<IdentityJson, CheckpointJson>): CharacterSummary => ({ characterId: character.characterId, identity: character.identity, updatedAt: character.updatedAt });
const ROUTE = '/api/account/world-characters';
const BODY_BYTES = 4096;
function readAppearance(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks: Buffer[] = [];
    const fail = () => { if (!done) { done = true; reject(new Error('request')); } };
    if (req.aborted) { fail(); return; }
    if (Number(req.headers['content-length']) > BODY_BYTES) { fail(); req.resume(); return; }
    req.on('data', (chunk: Buffer) => { if (done) return; size += chunk.length; if (size > BODY_BYTES) fail(); else chunks.push(chunk); });
    req.on('error', fail); req.on('aborted', fail);
    req.on('end', () => {
      if (done) return;
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'appearance') ||
            !value.appearance || typeof value.appearance !== 'object' || Array.isArray(value.appearance)) throw new Error('identity');
        done = true; resolve(value.appearance);
      } catch { fail(); }
    });
  });
}

/** Mount before the general account route. Does not open /world or accept any client progression. */
export function createCharacterHandler(options: CharacterHandlerOptions) {
  const { pool, characters, codec, origins, clientIp, policy } = options;
  const maxCharacters = policy?.maxCharactersPerAccount;
  const enabled = Number.isSafeInteger(maxCharacters) && maxCharacters! > 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
    const respond = (status: number, body: unknown) => { if (!res.headersSent && !res.destroyed) { res.writeHead(status, headers); res.end(JSON.stringify(body)); } };
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { respond(400, { error: 'request' }); return; }
    if (url.pathname !== ROUTE) { respond(404, { error: 'route' }); return; }
    if (!enabled) { respond(503, { error: 'disabled' }); return; }
    const origin = req.headers.origin, host = req.headers.host;
    const target = host ? (localHost(host) ? 'http://' : 'https://') + host.toLowerCase() : null;
    const site = req.headers['sec-fetch-site'];
    const explicitOrigin = !!origin && origin === target && originAllowed(origin, origins, host);
    // Browsers omit Origin on same-origin GET; Fetch Metadata still proves its origin without a referrer dependency.
    const sameOriginGet = req.method === 'GET' && !origin && site === 'same-origin' && !!target && originAllowed(target, origins, host);
    if (req.headers['x-crabcraft-account'] !== '1' || (!explicitOrigin && !sameOriginGet) || (site !== undefined && site !== 'same-origin')) { respond(403, { error: 'origin' }); return; }
    if (req.method !== 'GET' && req.method !== 'POST') { respond(405, { error: 'method' }); return; }
    if (req.method === 'GET' && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'])) { req.resume(); respond(400, { error: 'request' }); return; }
    const query = url.searchParams;
    if ([...query.keys()].some(key => !['after', 'limit'].includes(key) || query.getAll(key).length !== 1) || (req.method === 'POST' && query.size)) { respond(400, { error: 'query' }); return; }
    const after = query.get('after') ?? undefined, rawLimit = query.get('limit'), pageSize = rawLimit === null ? 20 : Number(rawLimit);
    if ((after !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(after)) ||
        (rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit)) || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) { respond(400, { error: 'query' }); return; }
    try {
      const ipKey = createHash('sha256').update(clientIp(req)).digest('hex');
      if (!await limit(pool, 'world-characters:ip:' + ipKey, 100, 900)) { respond(429, { error: 'rate' }); return; }
      const session = await resolveAccountSession(pool, req);
      if (!session) { respond(401, { error: 'session' }); return; }
      if (!await limit(pool, 'world-characters:account:' + session.accountId, 20, 60)) { respond(429, { error: 'rate' }); return; }
      if (req.method === 'GET') {
        const rows = await characters.listOwned(session.accountId, { after, limit: pageSize });
        // Probe at most one owned row to produce an exact cursor without exposing a checkpoint.
        const last = rows.at(-1), more = last ? await characters.listOwned(session.accountId, { after: last.characterId, limit: 1 }) : [];
        respond(200, { characters: rows.map(summary), nextAfter: more.length ? last!.characterId : null }); return;
      }
      let appearance: unknown;
      try { appearance = await readAppearance(req); }
      catch { headers.Connection = 'close'; respond(400, { error: 'identity' }); return; }
      let identity: IdentityJson;
      try {
        const selected = appearance as Record<string, unknown>;
        identity = codec.validateIdentity({ schema: 'world-identity-v1', classId: selected.classId, archetype: selected.race, appearance: selected });
      } catch { respond(400, { error: 'identity' }); return; }
      const created = await characters.createBounded(session.accountId, identity, maxCharacters!);
      respond(201, { character: summary(created) });
    } catch (e) {
      if (e instanceof CharacterStoreError && e.code === 'character_limit') { respond(409, { error: 'character_limit' }); return; }
      // Only a validated DB error code is loggable; no cookies, appearance/name, checkpoint or SQL message.
      const code = (e as { code?: string }).code;
      console.error(`world characters: database (${code && /^[A-Z0-9]{5}$/.test(code) ? code : 'error'})`);
      respond(503, { error: 'unavailable' });
    }
  };
}
