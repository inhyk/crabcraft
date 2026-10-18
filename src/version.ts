// Which build is this? .github/workflows/deploy.yml sets these at build time: VITE_APP_VERSION from
// package.json, VITE_DEPLOY_ENV (dev or prod) and VITE_GIT_SHA. A local `pnpm dev` or `pnpm build`
// has none of them and shows "local". Only the browser build carries them: server-dist/ must stay
// byte-identical across browser-only deploys so deploy/vm/activate.sh keeps the server running.
const env: 'dev' | 'prod' | 'local' =
  import.meta.env.VITE_DEPLOY_ENV === 'prod' ? 'prod' : import.meta.env.VITE_DEPLOY_ENV === 'dev' ? 'dev' : 'local';
const version = /^\d+\.\d+\.\d+$/.test(import.meta.env.VITE_APP_VERSION ?? '') ? import.meta.env.VITE_APP_VERSION as string : '';
const sha = /^[0-9a-f]{7,40}$/.test(import.meta.env.VITE_GIT_SHA ?? '') ? (import.meta.env.VITE_GIT_SHA as string).slice(0, 7) : '';

export const buildInfo = { env, version, sha } as const;

/** prod "v1.0.0", dev "DEV v1.0.0 · 9c06f54", local build "local". */
export function versionLabel(): string {
  if (env === 'local' || !version) return 'local';
  return env === 'prod' ? `v${version}` : `DEV v${version}${sha ? ` · ${sha}` : ''}`;
}
