// server.js — Hodlekve Conditions API

const express = require('express');
const { getConditions } = require('./src/conditions');
const { fetchForecast } = require('./src/met');
const { fetchObservations } = require('./src/regobs');
const { getWebcamData, CAMERAS } = require('./src/webcam');
const { fetchRadarAnalysis, fetchRadarImage } = require('./src/radar');

const app = express();
const PORT = process.env.PORT || 3030;

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────

// Main endpoint — everything in one call
// ?webcam=1  → include webcam + AI image captions
// ?brief=1   → include AI Norwegian brief (cached 1h)
// ?full=1    → both webcam + brief
app.get('/api/conditions', async (req, res) => {
  try {
    const full = req.query.full === '1';
    const includeWebcam = full || req.query.webcam === '1';
    const includeBrief  = full || req.query.brief  === '1';
    const data = await getConditions({ includeWebcam, includeBrief });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[/api/conditions]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Forecast only
app.get('/api/forecast', async (req, res) => {
  try {
    const data = await fetchForecast();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Regobs observations only
app.get('/api/observations', async (req, res) => {
  try {
    const data = await fetchObservations();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Webcam analysis
app.get('/api/webcam', async (req, res) => {
  try {
    const forecast = await fetchForecast();
    const ctx = {
      temperature: forecast.current.temperature,
      windSpeed: forecast.current.windSpeed,
      cloudCover: forecast.current.cloudCover
    };
    const data = await getWebcamData(ctx);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Image proxy — frontend fetches camera images through this
// GET /api/webcam/image/neuman1
app.get('/api/webcam/image/:cameraKey', async (req, res) => {
  const cam = CAMERAS[req.params.cameraKey];
  if (!cam) return res.status(404).json({ ok: false, error: 'Unknown camera' });
  try {
    const upstream = await fetch(cam.url, {
      headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
    });
    if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
    res.setHeader('Cache-Control', 'public, max-age=420');
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Radar analysis — AI Nynorsk text from Claude Vision (cached 15 min)
app.get('/api/radar', async (req, res) => {
  try {
    const data = await fetchRadarAnalysis();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[/api/radar]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Radar image proxy — live PNG from MET Norway (cached 15 min)
app.get('/api/radar/image', async (req, res) => {
  try {
    const { buffer } = await fetchRadarImage();
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nHodlekve Conditions API`);
  console.log(`http://localhost:${PORT}\n`);
  console.log('Endpoints:');
  console.log('  GET /api/conditions        base data');
  console.log('  GET /api/conditions?full=1 + webcam + AI brief');
  console.log('  GET /api/forecast          7-day MET.no');
  console.log('  GET /api/observations      Regobs');
  console.log('  GET /api/webcam            webcam + vision');
  console.log('  GET /api/webcam/image/:key raw JPEG proxy');
  console.log('  GET /api/radar          radar AI analysis (Nynorsk)');
  console.log('  GET /api/radar/image    live radar PNG from MET');
  console.log('  GET /health\n');

  getConditions()
    .then(() => console.log('Cache warm. Ready.\n'))
    .catch(err => console.error('Warm failed:', err.message));
});
