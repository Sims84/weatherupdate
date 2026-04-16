// src/conditions.js
// Combines MET.no forecast + Open-Meteo precipitation + Regobs observations + webcam + AI brief

const { fetchForecast }    = require('./met');
const { fetchObservations } = require('./regobs');
const { getWebcamData }    = require('./webcam');
const { generateBrief }    = require('./brief');
const { fetchPrecipData }  = require('./openmeteo');

async function getConditions({ includeWebcam = false, includeBrief = false } = {}) {
  // All three data sources in parallel
  const [forecast, regobs, precip] = await Promise.all([
    fetchForecast(),
    fetchObservations(),
    fetchPrecipData().catch(err => { console.error('[conditions] precip failed:', err.message); return null; })
  ]);

  const today = forecast.days[0];
  const currentPowderScore = calcCurrentPowderScore(forecast.current, today);
  const windDesc = describeWind(forecast.current.windSpeed);
  const visibilityDesc = describeVisibility(forecast.current.cloudCover, forecast.current.symbol);
  const alert = buildAlert(regobs);

  // Merge precip data into forecast days
  const days = forecast.days.map((day, i) => {
    const pd = precip?.days?.[i];
    return {
      ...day,
      precipProbability: pd?.precipProbability ?? null,
      precipType:        pd?.precipType ?? null,
      precipSummary:     pd?.precipSummary ?? null,
      snowfallCm:        pd?.snowfallCm ?? null,
      rainMm:            pd?.rainMm ?? null
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    resort: {
      name: 'Hodlekve',
      fullName: 'Sogndal Skisenter Hodlekve',
      elevation: 870,
      location: 'Sogndal, Vestland'
    },
    powderScore: currentPowderScore,
    current: {
      temperature: forecast.current.temperature,
      windSpeed: forecast.current.windSpeed,
      windDirection: forecast.current.windDirection,
      windDesc,
      cloudCover: forecast.current.cloudCover,
      visibilityDesc,
      precipNext1h: forecast.current.precipNext1h,
      symbol: forecast.current.symbol,
      snowDepthCm: precip?.snowDepthCm ?? null
    },
    alert,
    forecast: { days },
    precip: {
      today: precip?.days?.[0] ?? null,
      next12h: precip?.next12h ?? []
    },
    regobs: {
      alertLevel: regobs.alertLevel,
      recentCount: regobs.observations.length,
      observations: regobs.observations.slice(0, 5)
    },
    sources: {
      weather: 'MET.no Locationforecast 2.0',
      precip: 'Open-Meteo / MET Norway',
      observations: 'Regobs / NVE Varsom',
      weatherFetchedAt: forecast.fetchedAt,
      precipFetchedAt: precip?.fetchedAt ?? null,
      regobsFetchedAt: regobs.fetchedAt
    }
  };

  let webcam = null;
  if (includeWebcam) {
    try { webcam = await getWebcamData(forecast.current); result.webcam = webcam; }
    catch (err) { result.webcam = { error: err.message }; }
  }

  if (includeBrief) {
    try { result.brief = await generateBrief({ forecast: { ...forecast, days }, regobs, webcam }); }
    catch (err) { result.brief = { error: err.message }; }
  }

  return result;
}

function calcCurrentPowderScore(current, today) {
  let score = 5;
  if (today.snowFall >= 20) score += 3;
  else if (today.snowFall >= 10) score += 2;
  else if (today.snowFall >= 5)  score += 1;
  if (current.temperature <= -8)      score += 2;
  else if (current.temperature <= -3) score += 1;
  else if (current.temperature >= 2)  score -= 2;
  if (current.windSpeed >= 15)        score -= 3;
  else if (current.windSpeed >= 10)   score -= 2;
  else if (current.windSpeed >= 7)    score -= 1;
  if (current.cloudCover <= 20)       score += 1;
  else if (current.cloudCover >= 90)  score -= 1;
  return Math.min(10, Math.max(1, Math.round(score)));
}

function describeWind(speed) {
  if (speed < 2)  return 'Stille';
  if (speed < 4)  return 'Flau vind';
  if (speed < 6)  return 'Svak bris';
  if (speed < 9)  return 'Lett bris';
  if (speed < 12) return 'Frisk bris';
  if (speed < 16) return 'Liten kuling';
  if (speed < 20) return 'Stiv kuling';
  return 'Sterk kuling';
}

function describeVisibility(cloudCover, symbol) {
  if (symbol && symbol.includes('fog')) return 'Tåke';
  if (cloudCover <= 20)  return 'God (solskinn)';
  if (cloudCover <= 50)  return 'God (lettskya)';
  if (cloudCover <= 80)  return 'Moderat (skya)';
  return 'Redusert (overskya)';
}

function buildAlert(regobs) {
  if (regobs.alertLevel === 'none') return null;
  const recent = regobs.observations.slice(0, 3);
  const hasAvalanche = recent.some(o => o.hasAvalanche);
  const hasDanger    = recent.some(o => o.hasDangerSigns);
  let level, title, text;
  if (hasAvalanche) {
    level = 'high'; title = 'Skredaktivitet observert i nærleiken';
    text = `${regobs.recentCount} observasjon(ar) siste 3 dagar. Sjekk varsom.no før topptur.`;
  } else if (hasDanger) {
    level = 'moderate'; title = 'Faretegn på snøskred observert';
    const signs = recent.filter(o => o.dangerSigns).map(o => o.dangerSigns).join(', ');
    text = signs ? `Observert: ${signs}. Ver forsiktig i bratt terreng.` : 'Sjekk varsom.no for meir info.';
  } else {
    level = 'low'; title = 'Snøobservasjonar i området';
    text = `${regobs.recentCount} feltobservasjon(ar) registrert siste 3 dagar via Regobs.`;
  }
  return { level, title, text };
}

module.exports = { getConditions };
