// Headless Chrome over the DevTools protocol, for the scripts that need a real browser
// (check-browser.mjs, make-icons.mjs). Needs Node 22+ (built-in WebSocket) and an installed
// Chrome, Edge or Chromium; set CHROME_PATH to choose one.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

export function findChrome() {
  const path = process.env.CHROME_PATH ?? (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p));
  if (!path) throw new Error('No Chrome, Edge or Chromium found. Set CHROME_PATH to one.');
  return path;
}

/** Start headless Chrome. `newPage()` opens a tab; `close()` ends Chrome and removes its profile. */
export async function launchChrome() {
  if (typeof WebSocket === 'undefined') throw new Error('This script needs Node 22 or newer (built-in WebSocket).');
  const profile = mkdtempSync(join(tmpdir(), 'bb-chrome-'));
  if (process.platform === 'win32') {
    // A new profile makes Chrome on Windows test whether the account's password is blank by logging
    // on with an empty one. Each test is a failed logon, and ten in ten minutes lock the account, so
    // hand Chrome the answer stamped now; it only retests if the password changes after that.
    const now = (BigInt(Date.now()) + 11644473600000n) * 1000n; // Chrome's clock: microseconds since 1601
    const localState = { password_manager: { os_password_blank: false, os_password_last_changed: String(now) } };
    writeFileSync(join(profile, 'Local State'), JSON.stringify(localState));
  }
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'];
  const proc = spawn(findChrome(), args, { stdio: 'ignore' });
  let port = '';
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    try {
      port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; // the port Chrome picked
    } catch {
      /* not written yet */
    }
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not open its DevTools port.');
  }
  const base = `http://127.0.0.1:${port}`;
  return {
    async newPage() {
      const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
      return Page.connect(target.webSocketDebuggerUrl);
    },
    async close() {
      proc.kill();
      await sleep(400);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Chrome still holds a file; the OS cleans tmp */
      }
    },
  };
}

/** One tab: send DevTools commands, listen to events, evaluate JavaScript. */
export class Page {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('could not connect to the tab'));
    });
    return new Page(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.data ?? ''})`));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  /** Value of a JS expression (promises are awaited); throws with the page's error message. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Load `url` and wait `settleMs` for the app to render. */
  async goto(url, settleMs = 1500) {
    await this.send('Page.navigate', { url });
    await sleep(settleMs);
  }

  close() {
    this.ws.close();
  }
}
