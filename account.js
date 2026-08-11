// account.js — the account's real usage, asked for directly.
//
// The status-line shim could only speak while a Claude Code session was on
// screen rendering its status row. Close the terminal and the figures aged in
// place; if a window rolled over in the meantime the pill had nothing true to
// say about the one that replaced it. This asks the account instead, on a
// timer, whether or not Claude Code is running anywhere.
//
// It's the same endpoint `/usage` reads, with the OAuth session Claude Code
// has already stored — no login of our own, no password, nothing new on disk.
// The token is read, sent to the API it belongs to, and never written
// anywhere. It is deliberately never *refreshed*: a refresh rotates the pair,
// and a rotation we kept to ourselves would log Claude Code out. So an expired
// token is simply a poll we skip, until Claude Code next renews it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const TIMEOUT_MS = 8_000;
// a token about to expire mid-flight is one we'd rather not spend the request on
const SKEW_MS = 30_000;

// macOS keeps the credentials in the Keychain rather than in a file, and
// reading them there raises a system prompt naming the app. That's the user's
// call to make once — but only once: a refusal must not re-ask on every poll,
// so the first failure of any kind stands for the rest of the run.
let keychainClosed = false;

function fromKeychain() {
  if (process.platform !== 'darwin' || keychainClosed) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          keychainClosed = true;
          return resolve(null);
        }
        resolve(stdout.trim() || null);
      }
    );
  });
}

async function readToken() {
  let text = null;
  try {
    text = fs.readFileSync(CREDENTIALS, 'utf8');
  } catch (_) {
    text = await fromKeychain();
  }
  if (!text) return null;
  let oauth;
  try {
    oauth = JSON.parse(text).claudeAiOauth;
  } catch (_) {
    return null;
  }
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
  // an API-key or expired session is a fallback, not an error worth reporting
  if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt - SKEW_MS <= Date.now()) return null;
  return oauth.accessToken;
}

// The reply carries far more than two windows — per-model weeklies, credit
// balances, promotional buckets. Only the two the pill draws are kept, and
// they're reshaped into exactly what the shim used to write, so that every
// reader downstream stays as it was and one file remains the whole story.
function toLimits(payload, now = Date.now()) {
  const win = (w) => {
    if (!w || typeof w.utilization !== 'number') return null;
    const at = Date.parse(w.resets_at || '');
    const out = { used_percentage: w.utilization };
    if (Number.isFinite(at)) out.resets_at = Math.round(at / 1000);
    return out;
  };
  const five_hour = win(payload && payload.five_hour);
  const seven_day = win(payload && payload.seven_day);
  if (!five_hour && !seven_day) return null; // nothing we know how to draw
  return {
    ...(five_hour ? { five_hour } : {}),
    ...(seven_day ? { seven_day } : {}),
    updated_at: now,
  };
}

// Resolves to the limits object, or null for every ordinary way this can come
// to nothing: no Claude Code, an API-key user, a logged-out or expired
// session, no network, a shape we don't recognise. None of them are worth
// interrupting anyone over — the pill has two fallbacks behind this one.
//
// The caller passes Electron's fetch, which goes through Chromium's network
// stack and so inherits the system's proxy settings; Node's own ignores them,
// and on a work machine that's the difference between figures and none. The
// default keeps this file runnable, and testable, without Electron.
async function fetchLimits({ fetch: send = globalThis.fetch } = {}) {
  const token = await readToken();
  if (!token) return null;
  let res;
  try {
    res = await send(ENDPOINT, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (_) {
    return null; // offline, DNS, timeout
  }
  if (!res.ok) return null; // 401 once the session really has gone
  try {
    return toLimits(await res.json());
  } catch (_) {
    return null;
  }
}

module.exports = { fetchLimits, toLimits, readToken };
