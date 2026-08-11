// account.js under test: the reshaping and the token rules. Nothing here
// touches the network or the real ~/.claude — toReadLimits is a pure function
// of a payload, and readToken reads a file whose home is a temp directory.
//
// The payload fixtures are trimmed copies of a real reply: the endpoint
// returns a dozen buckets we don't draw (per-model weeklies, credit balances,
// promotional windows), and the ones that matter arrive as `utilization`
// plus an ISO `resets_at` — not the `used_percentage` and unix seconds the
// rest of the app reads. That translation is the part worth pinning down.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOUR = 3600_000;

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecheck-account-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete require.cache[require.resolve('../account')];
  return {
    account: require('../account'),
    credentials: (obj) =>
      fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify(obj)),
  };
}

const reply = (over = {}) => ({
  five_hour: { utilization: 25, resets_at: '2026-08-11T20:10:00.879482+00:00' },
  seven_day: { utilization: 28, resets_at: '2026-08-15T20:00:00.879500+00:00' },
  seven_day_opus: null,
  extra_usage: { is_enabled: false },
  limits: [{ kind: 'session', percent: 25 }],
  ...over,
});

test('the two windows the pill draws come out in the shape it already reads', () => {
  const { toLimits } = sandbox().account;
  const out = toLimits(reply(), 1_700_000_000_000);
  assert.deepEqual(out, {
    five_hour: { used_percentage: 25, resets_at: 1786479001 },
    seven_day: { used_percentage: 28, resets_at: 1786824001 },
    updated_at: 1_700_000_000_000,
  });
  // the seconds land on the moment the account named, to within the rounding
  // (it states these to the microsecond, and nothing downstream reads finer
  // than the 5-minute grid the tallies sit on)
  for (const [w, iso] of [
    [out.five_hour, '2026-08-11T20:10:00.879482+00:00'],
    [out.seven_day, '2026-08-15T20:00:00.879500+00:00'],
  ]) {
    assert.ok(Math.abs(w.resets_at * 1000 - Date.parse(iso)) <= 1000);
  }
});

test('a window the account has no figure for is left out, not zeroed', () => {
  const { toLimits } = sandbox().account;
  const out = toLimits(reply({ five_hour: null }));
  assert.equal('five_hour' in out, false);
  assert.equal(out.seven_day.used_percentage, 28);
});

test('a percentage with no reset moment is still a percentage', () => {
  const { toLimits } = sandbox().account;
  const out = toLimits(reply({ five_hour: { utilization: 3, resets_at: null } }));
  assert.deepEqual(out.five_hour, { used_percentage: 3 });
});

test('a reply with nothing recognisable in it is nothing at all', () => {
  const { toLimits } = sandbox().account;
  assert.equal(toLimits({ seven_day_opus: null, spend: {} }), null);
  assert.equal(toLimits(null), null);
  assert.equal(toLimits({ five_hour: { utilization: 'lots' } }), null);
});

test('0% is a figure like any other — it survives the reshaping', () => {
  const { toLimits } = sandbox().account;
  assert.equal(toLimits(reply({ five_hour: { utilization: 0, resets_at: null } })).five_hour.used_percentage, 0);
});

test('the token is read from the session Claude Code already has', async () => {
  const s = sandbox();
  s.credentials({ claudeAiOauth: { accessToken: 'tok-live', expiresAt: Date.now() + HOUR } });
  assert.equal(await s.account.readToken(), 'tok-live');
});

test('an expired session is skipped rather than refreshed', async () => {
  const s = sandbox();
  // refreshing would rotate the pair and log Claude Code out — the poll waits
  // instead, for Claude Code to renew it in its own time
  s.credentials({ claudeAiOauth: { accessToken: 'tok-stale', expiresAt: Date.now() - 60_000 } });
  assert.equal(await s.account.readToken(), null);
});

test('no session, no file and an API-key user all come to the same nothing', async () => {
  const s = sandbox();
  assert.equal(await s.account.readToken(), null); // no file at all
  s.credentials({ mcpOAuth: {} }); // signed in elsewhere, not to Claude
  assert.equal(await s.account.readToken(), null);
  s.credentials({ claudeAiOauth: { accessToken: '' } });
  assert.equal(await s.account.readToken(), null);
  fs.writeFileSync(path.join(process.env.HOME, '.claude', '.credentials.json'), 'not json');
  assert.equal(await s.account.readToken(), null);
});

test('a session with no stated expiry is taken at its word', async () => {
  const s = sandbox();
  s.credentials({ claudeAiOauth: { accessToken: 'tok-forever' } });
  assert.equal(await s.account.readToken(), 'tok-forever');
});
