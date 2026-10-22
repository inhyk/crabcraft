// Starts the browser for the Playwright tools in tools/ and the browser tests in tests/. The
// executable is picked in this order:
//   1. $CRABCRAFT_CHROME, the path of a Chrome for Testing or Chromium executable;
//   2. Chrome for Testing in Puppeteer's cache ($PUPPETEER_CACHE_DIR or ~/.cache/puppeteer), the
//      newest version there;
//   3. Chrome for Testing kept by chrome-devtools-mcp (~/.cache/chrome-devtools-mcp);
//   4. Playwright's own Chromium (`pnpm exec playwright install chromium`), or, when this
//      Playwright's revision is not installed, the newest Chromium already in Playwright's cache.
// The Google Chrome people browse with is never started: on macOS a headless copy of it registers
// as a second instance of the same app, and the Dock icon and opened links then go to the copy,
// which has no windows.
// Every browser started here is closed when the script dies on an uncaught error, Ctrl-C, SIGTERM
// or SIGHUP.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

const CFT_APP = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
/** Where the executable sits inside one versioned cache folder. */
const BINARIES = [
  `chrome-mac-arm64/${CFT_APP}`,
  `chrome-mac-x64/${CFT_APP}`,
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-win64/chrome.exe',
  'chrome-win/chrome.exe',
];

/** The version at the end of a cache folder's name (mac_arm-152.0.7977.42, chromium-1243). */
const version = (name) => (name.match(/[\d.]+$/)?.[0] ?? '').split('.').map(Number);
const newestFirst = (a, b) => {
  const x = version(a);
  const y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
};

/** The executable in the newest folder of `dir` that has one, among the folders `keep` accepts. */
function newestIn(dir, keep = () => true) {
  let names;
  try {
    names = readdirSync(dir).filter(keep);
  } catch {
    return null;
  }
  for (const name of names.sort(newestFirst)) {
    for (const bin of BINARIES) {
      const file = join(dir, name, bin);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

function playwrightChromium() {
  const own = chromium.executablePath();
  if (existsSync(own)) return { name: 'Playwright Chromium', path: own, launch: { channel: 'chromium' } };
  const parts = own.split(sep);
  const at = parts.findIndex((p) => /^chromium-\d+$/.test(p));
  if (at <= 0) return null;
  const file = newestIn(parts.slice(0, at).join(sep), (n) => /^chromium-\d+$/.test(n));
  return file && { name: 'Playwright Chromium (another revision)', path: file, launch: { executablePath: file } };
}

/** The browser `launchBrowser` starts: `{ name, path, launch }`, `launch` going to chromium.launch. */
export function pickBrowser() {
  const env = process.env.CRABCRAFT_CHROME;
  if (env) {
    if (!existsSync(env)) throw new Error(`CRABCRAFT_CHROME is set to ${env}, which does not exist`);
    return { name: 'CRABCRAFT_CHROME', path: env, launch: { executablePath: env } };
  }
  const home = homedir();
  const cft =
    newestIn(join(process.env.PUPPETEER_CACHE_DIR ?? join(home, '.cache', 'puppeteer'), 'chrome')) ??
    [join(home, '.cache', 'chrome-devtools-mcp', CFT_APP)].find((f) => existsSync(f));
  if (cft) return { name: 'Chrome for Testing', path: cft, launch: { executablePath: cft } };
  const pw = playwrightChromium();
  if (pw) return pw;
  throw new Error(
    'no browser for the tools: run `pnpm exec playwright install chromium`, or set CRABCRAFT_CHROME to a Chrome for Testing or Chromium executable',
  );
}

const open = new Set();
let named = false;
let hooked = false;
let stopping = false;

/** Close every browser `launchBrowser` started that is still open. */
export const closeBrowsers = () => Promise.allSettled([...open].map((b) => b.close()));

function stop(code) {
  if (stopping) return;
  stopping = true;
  // Leave after 5 s even if a browser does not answer; Playwright kills what is left on exit.
  setTimeout(() => process.exit(code), 5000).unref();
  closeBrowsers().finally(() => process.exit(code));
}

function hookExit() {
  if (hooked) return;
  hooked = true;
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));
  process.once('SIGHUP', () => stop(129));
  // A throw or a rejected await at the top of a script lands here too.
  process.on('uncaughtException', (e) => {
    console.error(e);
    stop(1);
  });
}

/**
 * chromium.launch with the browser from pickBrowser: pass the tool's own options (headless, args).
 * A `channel` or `executablePath` in them is ignored.
 */
export async function launchBrowser(options = {}) {
  const pick = pickBrowser();
  if (!named) {
    named = true;
    console.error(`browser: ${pick.name} (${pick.path})`);
  }
  hookExit();
  const browser = await chromium.launch({
    ...options,
    channel: undefined,
    executablePath: undefined,
    ...pick.launch,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  open.add(browser);
  browser.on('disconnected', () => open.delete(browser));
  return browser;
}
