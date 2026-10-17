// Stand-in for Google's OAuth endpoints, for server tests and tools/qa-accounts.mjs. No real Google account involved.
// GET /auth checks the request and redirects straight back with a one-time code; extra query parameters sub, aud,
// iss and exp (or the returned `claims` object) pick the identity in that code. POST /token checks client, secret,
// redirect URI and PKCE verifier and returns an unsigned id_token.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// `name` is the host in the advertised URLs: 'localhost' makes the round trip cross-site for a page on 127.0.0.1.
export async function fakeGoogle({ clientId, clientSecret, name = '127.0.0.1', sub = 'fake-google-user' }) {
  const codes = new Map(), issued = [], claims = {};
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && url.pathname === '/auth') {
      const q = url.searchParams, redirectUri = q.get('redirect_uri');
      if (q.get('client_id') !== clientId || q.get('response_type') !== 'code' || q.get('scope') !== 'openid' || q.get('code_challenge_method') !== 'S256'
        || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') ?? '') || !q.get('state') || !redirectUri) return json(400, { error: 'invalid_request' });
      const code = '4/' + randomBytes(24).toString('base64url');
      const now = Math.floor(Date.now() / 1000), pick = k => q.get(k) ?? claims[k];
      codes.set(code, { redirectUri, challenge: q.get('code_challenge'), claims: {
        iss: pick('iss') ?? 'https://accounts.google.com', aud: pick('aud') ?? clientId, sub: pick('sub') ?? sub,
        exp: pick('exp') !== undefined ? Number(pick('exp')) : now + 3600, iat: now,
      } });
      issued.push(code);
      const back = new URL(redirectUri); back.searchParams.set('code', code); back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: back.href }); res.end(); return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = ''; req.setEncoding('utf8'); req.on('data', c => { body += c; });
      req.on('end', () => {
        const f = new URLSearchParams(body), grant = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        if (f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret) return json(401, { error: 'invalid_client' });
        if (f.get('grant_type') !== 'authorization_code' || !grant || f.get('redirect_uri') !== grant.redirectUri
          || createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) return json(400, { error: 'invalid_grant' });
        const idToken = `${b64url({ alg: 'RS256', kid: 'fake', typ: 'JWT' })}.${b64url(grant.claims)}.${b64url('unsigned')}`;
        const accessToken = 'ya29.' + randomBytes(24).toString('base64url');
        issued.push(idToken, accessToken);
        json(200, { access_token: accessToken, expires_in: 3599, scope: 'openid', token_type: 'Bearer', id_token: idToken });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://${name}:${server.address().port}`;
  return {
    authUrl: origin + '/auth', tokenUrl: origin + '/token',
    /** Every code, id_token and access token handed out, to check none of them reach a log. */
    issued,
    /** Claims (sub, aud, iss, exp) for the next codes when the caller cannot add them to the auth URL, as a browser cannot. */
    claims,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}
