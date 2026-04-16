// src/radar.js
// Fetches MET Norway precipitation-type radar image and analyses it with Claude Vision
// Returns Nynorsk text: precip over Hodlekve, cloud gaps, movement direction, go/wait advice
// Image cached 15 min; analysis cached 15 min (keyed to same cycle)

const RADAR_URL = 'https://api.met.no/weatherapi/radar/2.0?area=norway&type=preciptype&content=image';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

let analysisCache = { data: null, fetchedAt: null };
let imageCache    = { buffer: null, fetchedAt: null };

// ── Fetch + analyse (cached 15 min) ─────────────────────────────────────────
async function fetchRadarAnalysis() {
  const now = Date.now();
  if (analysisCache.data && now - analysisCache.fetchedAt < CACHE_TTL_MS) {
    console.log('[Radar] Serving analysis from cache');
    return analysisCache.data;
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { analysisText: 'Ingen API-nøkkel er sett opp for radaranalyse.', error: 'No API key', generatedAt: new Date().toISOString() };
  }

  console.log('[Radar] Fetching radar image from MET Norway...');
  const imageRes = await fetch(RADAR_URL, {
    headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
  });
  if (!imageRes.ok) throw new Error(`MET radar returned ${imageRes.status}`);

  const rawBuffer = await imageRes.arrayBuffer();
  const base64 = Buffer.from(rawBuffer).toString('base64');

  // Also populate the image cache so /api/radar/image doesn't need a second fetch
  imageCache = { buffer: Buffer.from(rawBuffer), fetchedAt: now };

  console.log('[Radar] Sending image to Claude Vision...');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 }
          },
          {
            type: 'text',
            text: `Dette er eit nedbørsradarbilde frå Noreg frå MET Noreg (nedbørstype-radar).
Fargekode: grønt = regn, blått = snø, lilla/fiolett = sludd, svart/mørkt = klart.
Sogndal og Hodlekve skisenter ligg i Vestland, omtrent midtvegs mellom Bergen og Ålesund, innerst i Sognefjorden (indre delar av Vestland).

Skriv ei kort analyse på NYNORSK (3–4 setningar). Ta med desse fire punkta:
1. Kva nedbør er det over Hodlekve/Sogndal-området akkurat no (type og intensitet)?
2. Finst det skybrot, lysglimt eller klåre vindauge i nærleiken?
3. Kva retning og fart beveger nedbøren seg?
4. Éi direkte råd: bør ein dra til Hodlekve no, eller løner det seg å vente?`
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const analysisText = data.content[0]?.text?.trim() ?? 'Kunne ikkje analysere radarbiletet.';

  const result = {
    analysisText,
    generatedAt: new Date().toISOString(),
    model: 'claude-opus-4-5'
  };

  analysisCache = { data: result, fetchedAt: now };
  console.log('[Radar] Analysis done');
  return result;
}

// ── Image proxy (cached 15 min, shares cycle with analysis) ──────────────────
async function fetchRadarImage() {
  const now = Date.now();
  if (imageCache.buffer && now - imageCache.fetchedAt < CACHE_TTL_MS) {
    console.log('[Radar] Serving image from cache');
    return imageCache;
  }

  console.log('[Radar] Fetching fresh radar image...');
  const res = await fetch(RADAR_URL, {
    headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
  });
  if (!res.ok) throw new Error(`MET radar returned ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  imageCache = { buffer, fetchedAt: now };
  return imageCache;
}

module.exports = { fetchRadarAnalysis, fetchRadarImage };
