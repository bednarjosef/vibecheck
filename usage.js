// usage.js — session + weekly usage, read from Claude Code's local
// transcripts (~/.claude/projects/**/*.jsonl). Every assistant message there
// carries exact token counts, so usage is derivable fully offline — no
// account access, no endpoints, no auth. Sessions follow Anthropic's model:
// a 5-hour window that opens with the first message after the previous
// window lapsed, anchored to the top of the hour. The weekly reset moment is
// account-specific and not in the logs — Claude Code reports it through the
// statusline shim, and without that it's a rolling 7-day sum.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const HOUR_MS = 3600_000;
const SESSION_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const KEEP_MS = 8 * 24 * HOUR_MS; // a hair over the longest window we show

// Per-file tail state: byte offset of the next unread line, plus that file's
// hour-bucketed token totals — kept per file so a vanished or rewritten file
// can be dropped without corrupting the global sum.
const files = new Map(); // path -> { offset, buckets: Map(hourMs -> tokens) }
// Resumed/forked sessions replay earlier messages into a new transcript, so
// each API response must count once no matter how many files carry it.
const seen = new Set(); // `${message.id}:${requestId}`

let refreshing = null;

function listTranscripts() {
  const out = [];
  const cutoff = Date.now() - KEEP_MS;
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch (_) {
    return out; // no Claude Code on this machine — usage just stays hidden
  }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= cutoff) out.push({ path: p, size: st.size });
      } catch (_) {}
    }
  }
  return out;
}

function ingest(buf, state) {
  if (buf.length < 40 || !buf.includes('"usage"')) return;
  let obj;
  try {
    obj = JSON.parse(buf.toString('utf8'));
  } catch (_) {
    return;
  }
  const u = obj.message && obj.message.usage;
  const ts = Date.parse(obj.timestamp || '');
  if (!u || !Number.isFinite(ts)) return;
  // cache *re-reads* are excluded: they re-run the whole context on every
  // call, so they'd drown the number (98%+ of raw volume) while costing
  // almost nothing — input + output + freshly cached context is the honest
  // "work done" figure
  const tokens =
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0);
  if (!tokens) return; // synthetic/error entries
  const key = `${obj.message.id || obj.uuid}:${obj.requestId || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  const hour = ts - (ts % HOUR_MS);
  state.buckets.set(hour, (state.buckets.get(hour) || 0) + tokens);
}

// read only the bytes appended since last time; a partial line mid-write is
// left for the next pass (offset only ever advances past complete lines)
function tailFile(file) {
  let state = files.get(file.path);
  if (!state) {
    state = { offset: 0, buckets: new Map() };
    files.set(file.path, state);
  }
  if (file.size < state.offset) {
    state.offset = 0;
    state.buckets.clear();
  }
  if (file.size === state.offset) return Promise.resolve();
  return new Promise((resolve) => {
    const stream = fs.createReadStream(file.path, {
      start: state.offset,
      end: file.size - 1,
    });
    let pending = Buffer.alloc(0);
    stream.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let nl;
      while ((nl = pending.indexOf(0x0a)) !== -1) {
        ingest(pending.subarray(0, nl), state);
        state.offset += nl + 1;
        pending = pending.subarray(nl + 1);
      }
    });
    stream.on('close', resolve);
    stream.on('error', resolve);
  });
}

function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const current = listTranscripts();
    const live = new Set(current.map((f) => f.path));
    for (const p of files.keys()) if (!live.has(p)) files.delete(p);
    for (const f of current) await tailFile(f);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// week: null (rolling 7 days) or the account's real window, { since, resetAt }
function summary(week) {
  const hours = new Map();
  for (const f of files.values()) {
    for (const [h, t] of f.buckets) hours.set(h, (hours.get(h) || 0) + t);
  }
  if (!hours.size) return null;
  const now = Date.now();

  // replay 5h blocks over the history: first activity at-or-after the
  // previous block's end opens a new block at that hour
  let start = 0;
  let end = 0;
  for (const h of [...hours.keys()].sort((a, b) => a - b)) {
    if (h >= end) {
      start = h;
      end = start + SESSION_MS;
    }
  }
  let session = null;
  if (now < end) {
    let tokens = 0;
    for (const [h, t] of hours) if (h >= start) tokens += t;
    session = { tokens, resetAt: end };
  }

  // the account's real window when we know it, a rolling 7 days when we don't
  const dated = week && Number.isFinite(week.since) && Number.isFinite(week.resetAt);
  const since = dated ? week.since : now - WEEK_MS;
  let weekTokens = 0;
  for (const [h, t] of hours) if (h >= since) weekTokens += t;

  return { session, week: { tokens: weekTokens, resetAt: dated ? week.resetAt : null } };
}

module.exports = { refresh, summary };
