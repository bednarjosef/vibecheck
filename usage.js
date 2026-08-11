// usage.js — session + weekly usage, read from Claude Code's local
// transcripts (~/.claude/projects/**/*.jsonl). Every assistant message there
// carries exact token counts, so usage is derivable fully offline — no
// account access, no endpoints, no auth. Neither window's real start is in
// the logs, though: Claude Code reports both through the statusline shim, and
// they're used whenever we have them. Without the shim the week is a rolling
// 7 days and the session is replayed from the transcripts — a 5-hour block
// that opens with the first message after the previous one lapsed.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const HOUR_MS = 3600_000;
// Tallies are bucketed at 5 minutes, because that's the resolution a window
// edge can land on — the real reset moments Claude Code reports are always on
// a 5-minute mark, never the top of the hour. Bucketing by the hour meant a
// window boundary could only be honoured to within 60 minutes of the truth.
const BUCKET_MS = 5 * 60_000;
const SESSION_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const KEEP_MS = 8 * 24 * HOUR_MS; // a hair over the longest window we show

// Per-file tail state: byte offset of the next unread line, plus that file's
// bucketed token totals — kept per file so a vanished or rewritten file
// can be dropped without corrupting the global sum.
const files = new Map(); // path -> { offset, buckets: Map(bucketMs -> tokens) }
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
  const bucket = ts - (ts % BUCKET_MS);
  state.buckets.set(bucket, (state.buckets.get(bucket) || 0) + tokens);
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

// Each window is either the account's real one, { since, resetAt }, or null —
// then the week falls back to a rolling 7 days and the session to a replay.
const dated = (w) => !!w && Number.isFinite(w.since) && Number.isFinite(w.resetAt);

function summary(week, session) {
  const marks = new Map();
  for (const f of files.values()) {
    for (const [b, t] of f.buckets) marks.set(b, (marks.get(b) || 0) + t);
  }
  if (!marks.size) return null;
  const now = Date.now();
  const since = (from) => {
    let tokens = 0;
    for (const [b, t] of marks) if (b >= from) tokens += t;
    return tokens;
  };

  // The real 5h window is the one Claude Code reports. Replaying it from the
  // transcripts can only ever guess where it opened, and the guess compounds:
  // every block is anchored to the one before it, so being early by a few
  // minutes once means being early by that much for the rest of the day —
  // until a block rolls over ahead of the real one and the tally appears to
  // reset mid-session.
  let block = null;
  if (dated(session)) {
    block = { tokens: since(session.since), resetAt: session.resetAt };
  } else {
    let start = 0;
    let end = 0;
    for (const b of [...marks.keys()].sort((x, y) => x - y)) {
      if (b >= end) {
        start = b;
        end = start + SESSION_MS;
      }
    }
    if (now < end) block = { tokens: since(start), resetAt: end };
  }

  const realWeek = dated(week);
  return {
    session: block,
    week: {
      tokens: since(realWeek ? week.since : now - WEEK_MS),
      resetAt: realWeek ? week.resetAt : null,
    },
  };
}

// tokens read well at three digits max: 812 → 45K → 1.2M → 38M. The pill
// carries its own copy of this (an inline page can't require), so the two
// have to be changed together — the tray and the card can't disagree about
// a number they're both showing.
function fmtTokens(n) {
  if (n >= 1e9) return (n >= 1e10 ? Math.round(n / 1e9) : parseFloat((n / 1e9).toFixed(1))) + 'B';
  if (n >= 1e6) return (n >= 1e7 ? Math.round(n / 1e6) : parseFloat((n / 1e6).toFixed(1))) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

// Both windows on one line, for the tray: the same choice the pill makes,
// window by window — the real percentage where Claude Code is reporting one,
// this machine's token count where it isn't. It takes the object the pill is
// sent, so the two can't drift, and it lives here so it can be read without
// starting an app.
function summaryLine(data) {
  if (!data) return '';
  const limits = data.limits || {};
  const label = (limit, local) => {
    if (limit && typeof limit.pct === 'number') return limit.pct + '%';
    if (local && typeof local.tokens === 'number') return fmtTokens(local.tokens);
    return null;
  };
  const session = label(limits.session, data.session);
  const week = label(limits.week, data.week);
  return [session && `Session ${session}`, week && `Week ${week}`]
    .filter(Boolean)
    .join(' · ');
}

module.exports = { refresh, summary, fmtTokens, summaryLine };
