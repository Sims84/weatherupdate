// test.js — run this on your VPS to verify everything works
// Usage: node test.js

const BASE = 'http://localhost:3030';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('\nHodlekve API Test Suite');
  console.log('=======================\n');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓  ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗  ${t.name}`);
      console.log(`     ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`API returned ok:false — ${json.error}`);
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('Health check', async () => {
  const res = await fetch(`${BASE}/health`);
  const j = await res.json();
  assert(j.ok, 'Health not ok');
  assert(typeof j.uptime === 'number', 'No uptime');
});

test('MET.no forecast returns data', async () => {
  const data = await get('/api/forecast');
  assert(data.current, 'No current conditions');
  assert(typeof data.current.temperature === 'number', 'No temperature');
  assert(typeof data.current.windSpeed === 'number', 'No wind speed');
  assert(Array.isArray(data.days), 'No days array');
  assert(data.days.length >= 7, `Expected 7 days, got ${data.days.length}`);
  console.log(`     Temp: ${data.current.temperature}°C, Wind: ${data.current.windSpeed}m/s, Cloud: ${data.current.cloudCover}%`);
});

test('MET.no forecast has powder scores', async () => {
  const data = await get('/api/forecast');
  for (const day of data.days.slice(0, 3)) {
    assert(typeof day.powderScore === 'number', `No powder score for ${day.date}`);
    assert(day.powderScore >= 1 && day.powderScore <= 10, `Score out of range: ${day.powderScore}`);
  }
  const scores = data.days.slice(0, 7).map(d => `${d.date.slice(5)}: ${d.powderScore}/10`);
  console.log(`     ${scores.join(' | ')}`);
});

test('Regobs observations endpoint responds', async () => {
  const data = await get('/api/observations');
  assert(typeof data.alertLevel === 'string', 'No alertLevel');
  assert(['none','low','moderate','high'].includes(data.alertLevel), `Bad alertLevel: ${data.alertLevel}`);
  assert(Array.isArray(data.observations), 'No observations array');
  console.log(`     Alert: ${data.alertLevel}, Observations: ${data.observations.length}`);
});

test('Main conditions endpoint', async () => {
  const data = await get('/api/conditions');
  assert(typeof data.powderScore === 'number', 'No powderScore');
  assert(data.current, 'No current');
  assert(data.resort, 'No resort info');
  assert(data.forecast?.days?.length >= 7, 'No forecast days');
  console.log(`     Powder score: ${data.powderScore}/10, Wind: ${data.current.windDesc}`);
});

test('Webcam URLs are reachable (neuman1)', async () => {
  const res = await fetch(`${BASE}/api/webcam/image/neuman1`);
  assert(res.ok, `Image proxy returned ${res.status}`);
  const ct = res.headers.get('content-type');
  assert(ct?.includes('image'), `Expected image, got ${ct}`);
  const buf = await res.arrayBuffer();
  assert(buf.byteLength > 5000, `Image too small (${buf.byteLength} bytes) — might be error page`);
  console.log(`     Got ${Math.round(buf.byteLength / 1024)}KB JPEG from cdn.norwaylive.tv`);
});

test('Webcam image proxy — invalid key returns 404', async () => {
  const res = await fetch(`${BASE}/api/webcam/image/nonexistent`);
  assert(res.status === 404, `Expected 404, got ${res.status}`);
});

test('AI brief (requires ANTHROPIC_API_KEY)', async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('     Skipped — no ANTHROPIC_API_KEY in environment');
    return;
  }
  const data = await get('/api/conditions?brief=1');
  assert(data.brief, 'No brief in response');
  assert(data.brief.briefs?.now, 'No "now" brief');
  assert(data.brief.briefs?.verdict, 'No verdict');
  console.log(`     Verdict: "${data.brief.briefs.verdict}"`);
});

test('Caching — second MET call is faster', async () => {
  const t1 = Date.now();
  await get('/api/forecast');
  const first = Date.now() - t1;

  const t2 = Date.now();
  await get('/api/forecast');
  const second = Date.now() - t2;

  assert(second < first * 0.5, `Cache not working — first: ${first}ms, second: ${second}ms`);
  console.log(`     First call: ${first}ms, cached: ${second}ms`);
});

run();
