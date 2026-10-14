const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.resolve(relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const requireLocal = (id) => id === 'server-only' ? {} : mocks[id] ?? (id.startsWith('@/') ? load(`${id.slice(2)}.ts`, mocks) : require(id));
  vm.runInNewContext(code, { exports, require: requireLocal, Date, Intl, URL, Response, Request, console, process, setTimeout, clearTimeout, AbortController, fetch });
  return exports;
}

async function main() {
  const status = load('lib/matchStatus.ts');
  const today = '2026-10-14';
  const match = { id: 'one', name: 'India vs Australia', teams: ['India', 'Australia'], score: [], date: today };
  assert.equal(status.sportsDate(new Date('2026-10-13T20:00:00Z')), today, 'IST date rollover');
  assert.equal(status.cricketPhase({ ...match, date: '2026-07-26', matchStarted: true }, today), 'unknown');
  assert.equal(status.cricketPhase({ ...match, matchStarted: true }, today), 'live');
  assert.equal(status.cricketPhase({ ...match, matchStarted: true, status: 'India won the toss and chose to bat' }, today), 'live');
  assert.equal(status.cricketPhase({ ...match, matchStarted: true, matchEnded: true }, today), 'completed');
  assert.equal(status.cricketPhase({ ...match, date: '2026-10-15' }, today), 'upcoming');
  assert.equal(status.cricketPhase({ ...match, date: '2026-10-15', matchEnded: true }, today), 'unknown');
  assert.equal(status.cricketPhase({ ...match, date: '2026-10-11', matchType: 'test', matchStarted: true }, today), 'live');
  assert.equal(status.cricketPhase({ ...match, status: 'Postponed' }, today), 'unknown');
  assert.equal(status.footballPhase({ ...match, homeScore: '0', awayScore: '0' }, today), 'unknown');
  assert.equal(status.footballPhase({ ...match, homeScore: '1', awayScore: '0', status: '1H' }, today), 'live');
  assert.equal(status.footballPhase({ ...match, homeScore: '1', awayScore: '0', status: 'FT' }, today), 'completed');
  assert.equal(status.footballPhase({ ...match, date: '2026-07-26', status: 'HT' }, today), 'unknown');
  const all = [
    { ...match, id: 'july', date: '2026-07-26', matchEnded: true },
    { ...match, id: 'live', matchStarted: true },
    { ...match, id: 'next', date: '2026-10-15' },
    { ...match, id: 'done', matchEnded: true }
  ];
  assert.equal(status.selectCricketMatches(all, 'live cricket', today).map(m => m.id).join(), 'live');
  assert.equal(status.selectCricketMatches(all, 'upcoming matches', today).map(m => m.id).join(), 'next');
  assert.equal(status.selectCricketMatches(all, 'recent results', today).map(m => m.id).join(), 'done');
  assert.equal(status.selectCricketMatches(all, 'results on 2026-07-26', today).map(m => m.id).join(), 'july');
  const snapshots = load('lib/verifiedSportsSnapshots.ts');
  for (const question of ['India recent form', 'India next cricket match', 'India latest score', 'football matches today', 'India vs Zimbabwe live', 'Virat Kohli recent performance']) {
    assert.equal(snapshots.getVerifiedSportsSnapshot(question), null, question);
  }
  assert.match(snapshots.getVerifiedSportsSnapshot('Who won the 2011 Cricket World Cup final?'), /2011/);
  let state = { ...match, date: status.sportsDate(), matchStarted: false };
  const route = load('app/api/matches/route.ts', {
    '@/lib/cricketData': { getMatchWindow: async () => ({ matches: [state], partial: false }) },
    '@/lib/theSportsDb': { getFootballMatchesByDate: async () => [] }
  });
  for (const expected of ['upcoming', 'live', 'completed']) {
    state.matchStarted = expected !== 'upcoming';
    state.matchEnded = expected === 'completed';
    const response = await route.GET(new Request('http://localhost/api/matches?sport=cricket'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).matches[0].phase, expected, 'match lifecycle');
  }
  const failed = load('app/api/matches/route.ts', { '@/lib/cricketData': { getMatchWindow: async () => { throw new Error('offline'); } } });
  assert.equal((await failed.GET(new Request('http://localhost/api/matches'))).status, 503);
  assert.equal((await route.GET(new Request('http://localhost/api/matches?sport=invalid'))).status, 400);
  console.log('Passed: date rollover, stale-data rejection, live/upcoming/completed filtering, historical lookup, feed transitions and outage handling.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
