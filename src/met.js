// src/met.js
// Fetches weather forecast from MET.no Locationforecast API
// API docs: https://api.met.no/weatherapi/locationforecast/2.0/documentation

const HODLEKVE = {
  lat: 61.23,
  lon: 7.10,
  altitude: 870
};

// MET.no requires a descriptive User-Agent with contact info
const USER_AGENT = 'hodlekve-conditions/1.0 github.com/Sims84/hodlekve post@hodlekve.no';

let cache = {
  data: null,
  fetchedAt: null,
  expiresAt: null
};

async function fetchForecast() {
  const now = Date.now();

  // MET.no returns an Expires header — we respect it.
  // As a fallback, cache for 60 minutes.
  if (cache.data && cache.expiresAt && now < cache.expiresAt) {
    console.log('[MET] Serving from cache');
    return cache.data;
  }

  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HODLEKVE.lat}&lon=${HODLEKVE.lon}&altitude=${HODLEKVE.altitude}`;

  console.log('[MET] Fetching fresh forecast...');
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!res.ok) {
    throw new Error(`MET.no returned ${res.status}: ${res.statusText}`);
  }

  // Respect the Expires header MET.no sends
  const expires = res.headers.get('Expires');
  const expiresAt = expires ? new Date(expires).getTime() : now + 60 * 60 * 1000;

  const raw = await res.json();
  const parsed = parseForecast(raw);

  cache = { data: parsed, fetchedAt: now, expiresAt };
  console.log(`[MET] Cached until ${new Date(expiresAt).toISOString()}`);

  return parsed;
}

function parseForecast(raw) {
  const timeseries = raw.properties.timeseries;
  const now = new Date();

  // Current conditions = first entry
  const current = timeseries[0];
  const instant = current.data.instant.details;
  const next1h = current.data.next_1_hours;
  const next6h = current.data.next_6_hours;

  // Build 7-day daily summaries
  const dailyMap = {};

  for (const entry of timeseries) {
    const time = new Date(entry.time);
    const dateKey = time.toISOString().slice(0, 10); // "2025-01-16"

    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = {
        date: dateKey,
        temps: [],
        windSpeeds: [],
        precipitation: 0,
        snowPrecipitation: 0,
        cloudCoverages: [],
        symbols: []
      };
    }

    const d = dailyMap[dateKey];
    const details = entry.data.instant.details;

    d.temps.push(details.air_temperature);
    d.windSpeeds.push(details.wind_speed);
    d.cloudCoverages.push(details.cloud_area_fraction);

    // next_6_hours has precipitation totals — use those for daily sums
    if (entry.data.next_6_hours) {
      const p = entry.data.next_6_hours.details;
      d.precipitation += p.precipitation_amount || 0;

      // MET compact doesn't always have precipitation_category,
      // but if temp < 1°C we treat precip as snow
      if (details.air_temperature < 1.0) {
        d.snowPrecipitation += p.precipitation_amount || 0;
      }

      if (entry.data.next_6_hours.summary?.symbol_code) {
        d.symbols.push(entry.data.next_6_hours.summary.symbol_code);
      }
    }
  }

  // Summarise each day
  const days = Object.values(dailyMap).slice(0, 7).map(d => {
    const avgTemp = avg(d.temps);
    const maxWind = Math.max(...d.windSpeeds);
    const avgCloud = avg(d.cloudCoverages);
    const snowCm = Math.round(d.snowPrecipitation * 10) / 10; // mm → keep as mm, label as approx cm

    return {
      date: d.date,
      tempAvg: Math.round(avgTemp * 10) / 10,
      tempMin: Math.round(Math.min(...d.temps) * 10) / 10,
      tempMax: Math.round(Math.max(...d.temps) * 10) / 10,
      windMax: Math.round(maxWind * 10) / 10,
      cloudAvg: Math.round(avgCloud),
      precipTotal: Math.round(d.precipitation * 10) / 10,
      snowFall: snowCm,
      dominantSymbol: mostCommon(d.symbols),
      powderScore: calcDayPowderScore({ avgTemp, maxWind, snowFall: snowCm, avgCloud })
    };
  });

  return {
    fetchedAt: now.toISOString(),
    location: HODLEKVE,
    current: {
      temperature: instant.air_temperature,
      windSpeed: instant.wind_speed,
      windDirection: instant.wind_from_direction,
      cloudCover: instant.cloud_area_fraction,
      humidity: instant.relative_humidity,
      precipNext1h: next1h?.details?.precipitation_amount ?? 0,
      symbol: next1h?.summary?.symbol_code ?? next6h?.summary?.symbol_code ?? 'unknown'
    },
    days
  };
}

// --- Powder score for a single day (0–10) ---
function calcDayPowderScore({ avgTemp, maxWind, snowFall, avgCloud }) {
  let score = 5; // neutral baseline

  // Fresh snow is king
  if (snowFall >= 20) score += 3;
  else if (snowFall >= 10) score += 2;
  else if (snowFall >= 5)  score += 1;

  // Cold = dry snow
  if (avgTemp <= -8)       score += 2;
  else if (avgTemp <= -3)  score += 1;
  else if (avgTemp >= 2)   score -= 2; // wet/slushy

  // Wind ruins it
  if (maxWind >= 15)       score -= 3;
  else if (maxWind >= 10)  score -= 2;
  else if (maxWind >= 7)   score -= 1;

  // Visibility (cloud cover)
  if (avgCloud <= 20)      score += 1;  // sunny bluebird
  else if (avgCloud >= 90) score -= 1;  // whiteout

  return Math.min(10, Math.max(1, Math.round(score)));
}

// --- Helpers ---
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mostCommon(arr) {
  if (!arr.length) return 'unknown';
  const freq = {};
  let max = 0, result = arr[0];
  for (const v of arr) {
    freq[v] = (freq[v] || 0) + 1;
    if (freq[v] > max) { max = freq[v]; result = v; }
  }
  return result;
}

module.exports = { fetchForecast };
