// src/conditions.js
// Combines MET.no forecast + Regobs observations into one conditions object

const { fetchForecast } = require('./met');
const { fetchObservations } = require('./regobs');

async function getConditions() {
  // Fetch both in parallel — no reason to wait for one before the other
  const [forecast, regobs] = await Promise.all([
    fetchForecast(),
    fetchObservations()
  ]);

  const today = forecast.days[0];

  // Current powder score uses live conditions
  const currentPowderScore = calcCurrentPowderScore(forecast.current, today);

  // Wind description
  const windDesc = describeWind(forecast.current.windSpeed);

  // Visibility description (derived from cloud cover + symbol)
  const visibilityDesc = describeVisibility(forecast.current.cloudCover, forecast.current.symbol);

  // Regobs alert for display
  const alert = buildAlert(regobs);

  return {
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
      symbol: forecast.current.symbol
    },
    alert,
    forecast: {
      days: forecast.days
    },
    regobs: {
      alertLevel: regobs.alertLevel,
      recentCount: regobs.observations.length,
      observations: regobs.observations.slice(0, 5) // top 5 most recent
    },
    sources: {
      weather: 'MET.no Locationforecast 2.0',
      observations: 'Regobs / NVE Varsom',
      weatherFetchedAt: forecast.fetchedAt,
      regobsFetchedAt: regobs.fetchedAt
    }
  };
}

// Current powder score uses live data (not just daily summary)
function calcCurrentPowderScore(current, today) {
  let score = 5;

  // Fresh snow today
  if (today.snowFall >= 20) score += 3;
  else if (today.snowFall >= 10) score += 2;
  else if (today.snowFall >= 5)  score += 1;

  // Temperature
  if (current.temperature <= -8)      score += 2;
  else if (current.temperature <= -3) score += 1;
  else if (current.temperature >= 2)  score -= 2;

  // Wind
  if (current.windSpeed >= 15)        score -= 3;
  else if (current.windSpeed >= 10)   score -= 2;
  else if (current.windSpeed >= 7)    score -= 1;

  // Visibility
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
  const hasDanger = recent.some(o => o.hasDangerSigns);

  let level, title, text;

  if (hasAvalanche) {
    level = 'high';
    title = 'Skredaktivitet observert i nærleiken';
    text = `${regobs.recentCount} observasjon(ar) siste 3 dagar. Sjekk varsom.no før topptur.`;
  } else if (hasDanger) {
    level = 'moderate';
    title = 'Faretegn på snøskred observert';
    const signs = recent.filter(o => o.dangerSigns).map(o => o.dangerSigns).join(', ');
    text = signs ? `Observert: ${signs}. Ver forsiktig i bratt terreng.` : 'Sjekk varsom.no for meir info.';
  } else {
    level = 'low';
    title = 'Snøobservasjonar i området';
    text = `${regobs.recentCount} feltobservasjon(ar) registrert siste 3 dagar via Regobs.`;
  }

  return { level, title, text };
}

module.exports = { getConditions };
