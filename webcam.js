// src/webcam.js
// Fetches webcam snapshots from cdn.norwaylive.tv (updates every 7 min)
// Sends images to Claude Vision API for AI-generated condition captions
// Also handles the snow depth measurement camera

const fs = require('fs');
const path = require('path');

// All known cameras for Hodlekve
// UUID sourced from cdn.norwaylive.tv embed on sogndalskisenter.no
const RESORT_UUID = '6637b019-aeab-4a45-b671-f1f9bae39d09';
const CDN_BASE = `https://cdn.norwaylive.tv/snapshots/${RESORT_UUID}`;

const CAMERAS = {
  // Rindabotn / Holentrekket area (main mountain)
  rindabotn1: {
    name: 'Rindabotn – utsnitt 1',
    url: `${CDN_BASE}/kam1utsnitt1.jpg`,
    location: 'Rindabotn'
  },
  rindabotn2: {
    name: 'Rindabotn – utsnitt 2',
    url: `${CDN_BASE}/kam1utsnitt2.jpg`,
    location: 'Rindabotn'
  },
  rindabotn3: {
    name: 'Rindabotn – utsnitt 3',
    url: `${CDN_BASE}/kam1utsnitt3.jpg`,
    location: 'Rindabotn'
  },
  // Neumantrekket
  neuman1: {
    name: 'Neumantrekket – utsnitt 1',
    url: `${CDN_BASE}/kam2utsnitt1.jpg`,
    location: 'Neumantrekket'
  },
  neuman2: {
    name: 'Neumantrekket – utsnitt 2',
    url: `${CDN_BASE}/kam2utsnitt2.jpg`,
    location: 'Neumantrekket'
  },
  neuman3: {
    name: 'Neumantrekket – utsnitt 3',
    url: `${CDN_BASE}/kam2utsnitt3.jpg`,
    location: 'Neumantrekket'
  },
  // Kalvavatni (top area)
  kalvavatni1: {
    name: 'Kalvavatni – utsnitt 1',
    url: `${CDN_BASE}/kam3utsnitt1.jpg`,
    location: 'Kalvavatni'
  },
  kalvavatni2: {
    name: 'Kalvavatni – utsnitt 2',
    url: `${CDN_BASE}/kam3utsnitt2.jpg`,
    location: 'Kalvavatni'
  },
  kalvavatni3: {
    name: 'Kalvavatni – utsnitt 3',
    url: `${CDN_BASE}/kam3utsnitt3.jpg`,
    location: 'Kalvavatni'
  }
};

// Snow measurement camera (Axis IP cam - returns MJPEG stream,
// we grab one frame by fetching and reading the first JPEG boundary)
const SNOW_CAMERA_URL = 'https://langrenn.harjo.net/axis-cgi/jpg/image.cgi';

// Cache: store last successful fetch per camera
const imageCache = {};
const CACHE_TTL_MS = 7 * 60 * 1000; // 7 minutes (matches their refresh rate)

// ── Fetch a single camera image as base64 ────────────────────────────────────
async function fetchCameraImage(cameraKey) {
  const cam = CAMERAS[cameraKey];
  if (!cam) throw new Error(`Unknown camera: ${cameraKey}`);

  const now = Date.now();
  const cached = imageCache[cameraKey];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  console.log(`[Webcam] Fetching ${cam.name}...`);
  const res = await fetch(cam.url, {
    headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
  });

  if (!res.ok) {
    throw new Error(`Camera ${cameraKey} returned ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const result = {
    cameraKey,
    name: cam.name,
    location: cam.location,
    url: cam.url,
    base64,
    contentType,
    fetchedAt: now,
    fetchedAtISO: new Date(now).toISOString()
  };

  imageCache[cameraKey] = result;
  return result;
}

// ── Fetch snow measurement camera ────────────────────────────────────────────
async function fetchSnowCamera() {
  const now = Date.now();
  const cached = imageCache['snow'];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  console.log('[Webcam] Fetching snow measurement camera...');
  const res = await fetch(SNOW_CAMERA_URL, {
    headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
  });

  if (!res.ok) {
    throw new Error(`Snow camera returned ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const result = {
    cameraKey: 'snow',
    name: 'Snømålingskamera – Rindabotn',
    location: 'Rindabotn heishus',
    base64,
    contentType: 'image/jpeg',
    fetchedAt: now,
    fetchedAtISO: new Date(now).toISOString()
  };

  imageCache['snow'] = result;
  return result;
}

// ── Analyse image with Claude Vision API ─────────────────────────────────────
async function analyseImage(imageData, context = {}) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { caption: null, error: 'No ANTHROPIC_API_KEY set' };
  }

  const isSnowCamera = imageData.cameraKey === 'snow';

  const prompt = isSnowCamera
    ? `This is a snow depth measurement camera at a Norwegian ski resort (Hodlekve, Sogndal). 
       Look at the snow stake/pole visible in the image and estimate the snow depth in centimeters.
       Also describe any other visible conditions (ice, fresh powder, crust etc.).
       Reply in Norwegian (Nynorsk). Be concise — 1-2 sentences max.
       Format: "Snødjupne: ~Xcm. [kort skildring]"`
    : `This is a webcam at Hodlekve ski resort in Sogndal, Norway (camera: ${imageData.name}).
       Current weather context: ${JSON.stringify(context)}.
       Briefly describe what you see in 1-2 sentences in Norwegian (Nynorsk):
       - Snow conditions (powder/ice/slush/crust?)
       - Visibility and sky conditions
       - How busy it looks (people/queue at lift?)
       - Any notable observations for a skier/snowboarder
       Be factual and concise. No greetings or preamble.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageData.contentType,
                data: imageData.base64
              }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API ${response.status}: ${err}`);
    }

    const data = await response.json();
    const caption = data.content[0]?.text?.trim() ?? null;
    return { caption, analysedAt: new Date().toISOString() };

  } catch (err) {
    console.error('[Webcam] Vision analysis failed:', err.message);
    return { caption: null, error: err.message };
  }
}

// ── Main: fetch + analyse the key cameras ────────────────────────────────────
// We don't analyse all 9 cameras every refresh — that's wasteful.
// We fetch: neuman1 (main slope view) + snow camera
async function getWebcamData(weatherContext = {}) {
  const results = {};

  // Primary camera — Neumantrekket utsnitt 1 (confirmed working URL)
  try {
    const img = await fetchCameraImage('neuman1');
    const analysis = await analyseImage(img, weatherContext);
    results.primary = {
      ...img,
      base64: undefined, // don't send base64 to frontend, save bandwidth
      analysis
    };
  } catch (err) {
    console.error('[Webcam] Primary camera failed:', err.message);
    results.primary = { error: err.message };
  }

  // Snow depth camera
  try {
    const img = await fetchSnowCamera();
    const analysis = await analyseImage(img, {});
    results.snow = {
      ...img,
      base64: undefined,
      analysis
    };
  } catch (err) {
    console.error('[Webcam] Snow camera failed:', err.message);
    results.snow = { error: err.message };
  }

  return {
    fetchedAt: new Date().toISOString(),
    cameras: results,
    allUrls: Object.fromEntries(
      Object.entries(CAMERAS).map(([k, v]) => [k, v.url])
    )
  };
}

module.exports = { getWebcamData, fetchCameraImage, analyseImage, CAMERAS };
