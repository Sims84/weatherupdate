// src/openmeteo.js
// Fetches precipitation probability + snowfall detail from Open-Meteo
// Uses MET Norway model (best for Scandinavia, updated hourly)
// Free, no API key needed

const HODLEKVE = { lat: 61.23, lon: 7.10, altitude: 870 };

let cache = { data: null, fetchedAt: null };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchPrecipData() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    console.log('[OpenMeteo] Serving from cache');
    return cache.data;
  }

  console.log('[OpenMeteo] Fetching precipitation data...');

  const params = new URLSearchParams({
    latitude: HODLEKVE.lat,
    longitude: HODLEKVE.lon,
    hourly: 'precipitation_probability,precipitation,snowfall,rain,snow_depth,weather_code',
    daily: 'precipitation_probability_max,precipitation_sum,snowfall_sum,rain_sum',
    timezone: 'Europe/Oslo',
    forecast_days: 7
  });

  const url = `https://api.open-meteo.com/v1/metno?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no' }
  });

  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);

  const raw = await res.json();
  const parsed = parsePrecipData(raw);

  cache = { data: parsed, fetchedAt: now };
  console.log('[OpenMeteo] Fetched OK');
  return parsed;
}

function parsePrecipData(raw) {
  const hourly = raw.hourly;
  const daily  = raw.daily;

  // Build daily summaries
  const days = daily.time.map((date, i) => {
    const precipProb   = daily.precipitation_probability_max[i] ?? 0;
    const snowfallSum  = daily.snowfall_sum[i] ?? 0;
    const rainSum      = daily.rain_sum[i] ?? 0;
    const precipSum    = daily.precipitation_sum[i] ?? 0;

    // Is the precipitation mostly snow or rain?
    const precipType = snowfallSum > 0 && rainSum === 0 ? 'snow'
                     : snowfallSum > 0 && rainSum > 0   ? 'sleet'
                     : rainSum > 0                       ? 'rain'
                     : 'none';

    return {
      date,
      precipProbability: Math.round(precipProb),   // 0-100 %
      precipType,                                   // snow / rain / sleet / none
      snowfallCm: Math.round(snowfallSum * 10) / 10, // cm
      rainMm: Math.round(rainSum * 10) / 10,
      precipSummary: buildPrecipSummary(precipProb, precipType, snowfallSum, rainSum)
    };
  });

  // Also extract next 12 hours hourly for the "today" section
  const next12h = [];
  const nowHour = new Date().toISOString().slice(0, 13);
  for (let i = 0; i < hourly.time.length && next12h.length < 12; i++) {
    if (hourly.time[i] >= nowHour) {
      next12h.push({
        time: hourly.time[i],
        precipProbability: hourly.precipitation_probability[i] ?? 0,
        snowfall: hourly.snowfall[i] ?? 0,
        rain: hourly.rain[i] ?? 0,
        snowDepth: hourly.snow_depth[i] ?? null
      });
    }
  }

  // Current snow depth from most recent hourly reading
  const latestSnowDepth = hourly.snow_depth?.find(v => v !== null) ?? null;

  return {
    fetchedAt: new Date().toISOString(),
    days,
    next12h,
    snowDepthM: latestSnowDepth,
    snowDepthCm: latestSnowDepth !== null ? Math.round(latestSnowDepth * 100) : null
  };
}

function buildPrecipSummary(prob, type, snowCm, rainMm) {
  if (prob < 20) return 'Lite nedbør venta';
  const typeLabel = type === 'snow'  ? `${(snowCm*10).toFixed(0)}mm snø` :
                    type === 'sleet' ? 'sludd/snø' :
                    type === 'rain'  ? `${rainMm}mm regn` : 'nedbør';
  if (prob >= 70) return `${prob}% sjanse — ${typeLabel}`;
  if (prob >= 40) return `${prob}% sjanse for ${typeLabel}`;
  return `${prob}% sjanse for ${type === 'snow' ? 'snø' : 'nedbør'}`;
}

module.exports = { fetchPrecipData };
