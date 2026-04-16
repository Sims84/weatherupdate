// src/regobs.js
// Fetches crowdsourced snow & avalanche observations from Regobs (NVE/Varsom)
// API docs: https://api.nve.no/doc/regobs/

// Bounding box around Sogndal / Hodlekve area (~50km radius)
const SOGNDAL_BBOX = {
  nwLat: 61.60,
  nwLon:  6.50,
  seLat: 60.90,
  seLon:  7.80
};

const REGOBS_API = 'https://api.nve.no/hydrology/regobs/v4';

// Hazard types we care about
const HAZARD_SNOW = 10;

// Competence levels (higher = more trustworthy observer)
// 0=unknown, 100=level1, 110=level2, 115=level3, 120=level4, 130=level5
const MIN_COMPETENCE = 0;

let cache = {
  data: null,
  fetchedAt: null
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchObservations() {
  const now = Date.now();

  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    console.log('[Regobs] Serving from cache');
    return cache.data;
  }

  console.log('[Regobs] Fetching observations...');

  const params = new URLSearchParams({
    LangKey: 1,        // 1 = Norwegian
    daysBack: 3,
    offset: 0,
    records: 20,
    orderBy: 'DtChangeTime'
  });

  // Add hazard filter
  params.append('selectedregistrations', 'AvalancheObs');
  params.append('selectedregistrations', 'DangerObs');
  params.append('selectedregistrations', 'WeatherObs');
  params.append('selectedregistrations', 'SnowSurfaceObs');

  const searchBody = {
    LangKey: 1,
    daysBack: 3,
    FromDate: null,
    ToDate: null,
    SelectedGeoHazards: [HAZARD_SNOW],
    SelectedRegistrationTypes: null,
    ObserverCompetence: null,
    Extent: {
      BottomRight: { Latitude: SOGNDAL_BBOX.seLat, Longitude: SOGNDAL_BBOX.seLon },
      TopLeft:     { Latitude: SOGNDAL_BBOX.nwLat, Longitude: SOGNDAL_BBOX.nwLon }
    },
    NumberOfRecords: 20,
    Offset: 0,
    OrderBy: 'DtChangeTime'
  };

  let raw;
  try {
    const res = await fetch(`${REGOBS_API}/Observations/Search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'hodlekve-conditions/1.0 post@hodlekve.no'
      },
      body: JSON.stringify(searchBody)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Regobs API ${res.status}: ${text}`);
    }

    raw = await res.json();
  } catch (err) {
    console.error('[Regobs] Fetch failed:', err.message);
    // Return empty rather than crash the whole conditions endpoint
    return { observations: [], fetchedAt: new Date().toISOString(), error: err.message };
  }

  const parsed = parseObservations(raw);
  cache = { data: parsed, fetchedAt: now };
  console.log(`[Regobs] Got ${parsed.observations.length} observations`);

  return parsed;
}

function parseObservations(raw) {
  const results = Array.isArray(raw) ? raw : (raw.Results || raw.results || []);

  const observations = results.map(obs => {
    const reg = obs.Registrations || [];

    // Pull out the most relevant registration details
    const avalanche = reg.find(r => r.RegistrationName === 'AvalancheObs');
    const danger    = reg.find(r => r.RegistrationName === 'DangerObs');
    const weather   = reg.find(r => r.RegistrationName === 'WeatherObs');
    const surface   = reg.find(r => r.RegistrationName === 'SnowSurfaceObs');

    return {
      id: obs.RegId,
      time: obs.DtObsTime,
      changedAt: obs.DtChangeTime,
      location: {
        name: obs.ObsLocation?.LocationName ?? null,
        lat: obs.ObsLocation?.Latitude ?? null,
        lon: obs.ObsLocation?.Longitude ?? null,
        altitude: obs.ObsLocation?.Height ?? null
      },
      observer: {
        nickname: obs.Observer?.NickName ?? 'Anonym',
        competence: obs.Observer?.CompetenceLevelName ?? null
      },
      hasAvalanche: !!avalanche,
      hasDangerSigns: !!danger,
      dangerSigns: danger?.FullObject?.DangerSignName ?? null,
      snowSurface: surface?.FullObject?.SnowSurfaceName ?? null,
      weatherSummary: weather?.FullObject?.PrecipitationName ?? null,
      comment: obs.GeneralObservation?.ObsComment ?? null,
      url: `https://regobs.no/registration/${obs.RegId}`
    };
  }).filter(o => o.location.lat !== null);

  // Derive a simple alert level for the dashboard
  const alertLevel = deriveAlertLevel(observations);

  return {
    fetchedAt: new Date().toISOString(),
    alertLevel,   // 'none' | 'low' | 'moderate' | 'high'
    observations
  };
}

function deriveAlertLevel(obs) {
  if (obs.some(o => o.hasAvalanche)) return 'high';
  if (obs.some(o => o.hasDangerSigns)) return 'moderate';
  if (obs.length > 0) return 'low';
  return 'none';
}

module.exports = { fetchObservations };
