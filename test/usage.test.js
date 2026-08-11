// usage.js under test: the token math, the dedup, the tailing and the two
// window shapes — the parts that can be wrong without ever looking wrong.
//
// Nothing here touches the real ~/.claude. usage.js resolves the transcript
// directory once, at require time, out of os.homedir() — which is $HOME on
// POSIX and %USERPROFILE% on Windows. So each test points those at a fresh
// temp directory and re-requires the module, which also hands it a clean
// copy of the per-file tail state and the dedup set.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BUCKET = 5 * MIN;

// where a moment lands in the 5-minute grid the tallies are kept on
const bucket = (t) => t - (t % BUCKET);

// one assistant turn as Claude Code writes it: a timestamp, the id pair a
// replayed message keeps across files, and the usage block being counted
const line = (o) =>
  JSON.stringify({
    type: 'assistant',
    uuid: o.uuid || 'uuid-' + (o.id || '1'),
    requestId: 'req' in o ? o.req : 'req-1',
    timestamp: new Date(o.at).toISOString(),
    message: {
      id: o.id || 'msg-1',
      usage: {
        input_tokens: o.in || 0,
        output_tokens: o.out || 0,
        cache_creation_input_tokens: o.create || 0,
        cache_read_input_tokens: o.read || 0,
      },
    },
  }) + '\n';

function sandbox({ projects = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecheck-test-'));
  const dir = path.join(home, '.claude', 'projects', '-home-someone-repo');
  if (projects) fs.mkdirSync(dir, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete require.cache[require.resolve('../usage')];
  return {
    usage: require('../usage'),
    dir,
    write: (name, entries) => fs.writeFileSync(path.join(dir, name), entries.join('')),
    append: (name, text) => fs.appendFileSync(path.join(dir, name), text),
    age: (name, ms) => {
      const t = (Date.now() - ms) / 1000;
      fs.utimesSync(path.join(dir, name), t, t);
    },
  };
}

// the rolling fallbacks, which is what summary() uses with no real windows
const rolling = (usage) => usage.summary(null, null);

test('counts input, output and freshly cached context — never cache reads', async () => {
  const s = sandbox();
  s.write('a.jsonl', [
    line({ at: Date.now() - 10 * MIN, in: 100, out: 20, create: 5, read: 999_999 }),
  ]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 125);
});

test('a message replayed into a second transcript is counted once', async () => {
  const s = sandbox();
  const at = Date.now() - 10 * MIN;
  const entry = line({ at, id: 'msg-7', req: 'req-9', out: 40 });
  s.write('original.jsonl', [entry]);
  s.write('resumed.jsonl', [entry, line({ at, id: 'msg-8', req: 'req-10', out: 2 })]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 42);
});

test('junk lines, entries without usage and empty tallies are all skipped', async () => {
  const s = sandbox();
  s.write('a.jsonl', [
    'not json at all\n',
    '{"message":{"usage":{"output_tokens":5}},"timestamp":"nonsense"}\n', // unparseable date
    '{"broken json with a "usage" in it\n',
    JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: {} }) + '\n',
    line({ at: Date.now() - MIN, id: 'zero', out: 0 }), // synthetic/error turn
    line({ at: Date.now() - MIN, id: 'real', out: 33 }),
  ]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 33);
});

test('with no real week, the week is a rolling seven days', async () => {
  const s = sandbox();
  s.write('a.jsonl', [
    line({ at: Date.now() - 8 * DAY, id: 'old', out: 1000 }),
    line({ at: Date.now() - HOUR, id: 'new', out: 10 }),
  ]);
  await s.usage.refresh();
  const sum = rolling(s.usage);
  assert.equal(sum.week.tokens, 10);
  assert.equal(sum.week.resetAt, null); // nothing to count down to
});

test("the account's real week counts from its own start and keeps its reset", async () => {
  const s = sandbox();
  const resetAt = Date.now() + 5 * DAY;
  s.write('a.jsonl', [
    line({ at: Date.now() - 3 * HOUR, id: 'before', out: 100 }),
    line({ at: Date.now() - HOUR, id: 'after', out: 7 }),
  ]);
  await s.usage.refresh();
  const sum = s.usage.summary({ since: Date.now() - 2 * HOUR, resetAt }, null);
  assert.equal(sum.week.tokens, 7);
  assert.equal(sum.week.resetAt, resetAt);
});

test('without a reported session, the 5-hour block is replayed from the transcripts', async () => {
  const s = sandbox();
  const at = Date.now() - HOUR;
  s.write('a.jsonl', [
    line({ at: at - 9 * HOUR, id: 'lapsed', out: 500 }), // a block that closed long ago
    line({ at, id: 'open', out: 12 }),
  ]);
  await s.usage.refresh();
  const sum = rolling(s.usage);
  assert.equal(sum.session.tokens, 12);
  assert.equal(sum.session.resetAt, bucket(at) + 5 * HOUR);
});

test('a block that has already lapsed leaves no session at all', async () => {
  const s = sandbox();
  s.write('a.jsonl', [line({ at: Date.now() - 6 * HOUR, out: 90 })]);
  await s.usage.refresh();
  const sum = rolling(s.usage);
  assert.equal(sum.session, null);
  assert.equal(sum.week.tokens, 90); // still this week's work
});

test('a window Claude Code reported as closed floors the replay', async () => {
  const s = sandbox();
  const closed = Date.now() - 2 * HOUR; // the reported window ended here
  const opened = closed + 20 * MIN; // first message of the one that replaced it
  s.write('a.jsonl', [
    line({ at: closed - 30 * MIN, id: 'theirs', out: 900 }), // the closed window's work
    line({ at: opened, id: 'ours', out: 40 }),
  ]);
  await s.usage.refresh();
  const sum = s.usage.summary(null, { after: closed });
  // left to itself the replay would keep the earlier block open for another
  // three hours and hand it all 940
  assert.equal(sum.session.tokens, 40);
  assert.equal(sum.session.resetAt, bucket(opened) + 5 * HOUR);
});

test('nothing since a window closed is no session, not a session of nothing', async () => {
  const s = sandbox();
  const closed = Date.now() - HOUR;
  s.write('a.jsonl', [line({ at: closed - 20 * MIN, out: 700 })]);
  await s.usage.refresh();
  const sum = s.usage.summary(null, { after: closed });
  assert.equal(sum.session, null);
  assert.equal(sum.week.tokens, 700); // still this week's work
});

test("the session Claude Code reports beats the replay's guess at it", async () => {
  const s = sandbox();
  const resetAt = Date.now() + 4 * HOUR;
  s.write('a.jsonl', [
    line({ at: Date.now() - 3 * HOUR, id: 'earlier', out: 50 }),
    line({ at: Date.now() - 40 * MIN, id: 'inside', out: 5 }),
  ]);
  await s.usage.refresh();
  const sum = s.usage.summary(null, { since: Date.now() - HOUR, resetAt });
  assert.equal(sum.session.tokens, 5);
  assert.equal(sum.session.resetAt, resetAt);
});

test('a growing transcript is tailed, not re-read', async () => {
  const s = sandbox();
  s.write('a.jsonl', [line({ at: Date.now() - 20 * MIN, id: 'first', out: 10 })]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 10);

  s.append('a.jsonl', line({ at: Date.now() - 10 * MIN, id: 'second', out: 5 }));
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 15); // 10 counted once, not twice
});

test('a line still being written waits for the rest of itself', async () => {
  const s = sandbox();
  const entry = line({ at: Date.now() - MIN, out: 21 });
  s.append('a.jsonl', entry.slice(0, entry.length - 6)); // caught mid-write
  await s.usage.refresh();
  assert.equal(rolling(s.usage), null); // nothing complete to report yet

  s.append('a.jsonl', entry.slice(entry.length - 6));
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 21);
});

test('a transcript that shrank is read again from the top', async () => {
  const s = sandbox();
  s.write('a.jsonl', [
    line({ at: Date.now() - 30 * MIN, id: 'one', out: 100 }),
    line({ at: Date.now() - 25 * MIN, id: 'two', out: 100 }),
  ]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 200);

  s.write('a.jsonl', [line({ at: Date.now() - 5 * MIN, id: 'rewritten', out: 3 })]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 3); // that file's old totals went with it
});

test('a vanished transcript takes its totals with it', async () => {
  const s = sandbox();
  s.write('a.jsonl', [line({ at: Date.now() - 30 * MIN, id: 'a', out: 100 })]);
  s.write('b.jsonl', [line({ at: Date.now() - 30 * MIN, id: 'b', out: 5 })]);
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 105);

  fs.rmSync(path.join(s.dir, 'a.jsonl'));
  await s.usage.refresh();
  assert.equal(rolling(s.usage).week.tokens, 5);
});

test('transcripts older than the longest window are never opened', async () => {
  const s = sandbox();
  s.write('ancient.jsonl', [line({ at: Date.now() - MIN, out: 400 })]);
  s.age('ancient.jsonl', 9 * DAY);
  await s.usage.refresh();
  assert.equal(rolling(s.usage), null);
});

test('no Claude Code on the machine is not an error', async () => {
  const s = sandbox({ projects: false });
  await s.usage.refresh();
  assert.equal(rolling(s.usage), null);
});

test('concurrent refreshes share one scan', async () => {
  const s = sandbox();
  s.write('a.jsonl', [line({ at: Date.now() - MIN, out: 60 })]);
  await Promise.all([s.usage.refresh(), s.usage.refresh(), s.usage.refresh()]);
  assert.equal(rolling(s.usage).week.tokens, 60);
});

test('the tray line reads the percentages when there are any', () => {
  const { summaryLine } = sandbox().usage;
  assert.equal(
    summaryLine({
      session: { tokens: 1_400_000, resetAt: 1 },
      week: { tokens: 27_000_000, resetAt: 2 },
      limits: { session: { pct: 4 }, week: { pct: 20 } },
    }),
    'Session 4% · Week 20%'
  );
});

test("the tray line falls back to this machine's tokens, window by window", () => {
  const { summaryLine } = sandbox().usage;
  // the 5-hour window Claude Code reported has closed, so its percentage is
  // no longer anybody's — the session says tokens while the week says a figure
  assert.equal(
    summaryLine({
      session: { tokens: 1_400_000, resetAt: 1 },
      week: { tokens: 27_000_000, resetAt: 2 },
      limits: { session: null, week: { pct: 20 } },
    }),
    'Session 1.4M · Week 20%'
  );
  assert.equal(
    summaryLine({ session: null, week: { tokens: 812, resetAt: null }, limits: null }),
    'Week 812'
  );
});

test('the tray line says nothing when there is nothing to say', () => {
  const { summaryLine } = sandbox().usage;
  assert.equal(summaryLine(null), '');
  assert.equal(summaryLine({ session: null, week: null, limits: {} }), '');
});

test('token counts stay three digits wide', () => {
  const { fmtTokens } = sandbox().usage;
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(812), '812');
  assert.equal(fmtTokens(45_000), '45K');
  assert.equal(fmtTokens(999), '999');
  assert.equal(fmtTokens(1_200_000), '1.2M');
  assert.equal(fmtTokens(12_500_000), '13M');
  assert.equal(fmtTokens(3_400_000_000), '3.4B');
});
