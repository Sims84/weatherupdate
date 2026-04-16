// src/brief.js
// Generates a Norwegian-language AI brief by synthesizing:
//   - MET.no current conditions + 7-day forecast
//   - Regobs snow/avalanche observations
//   - Webcam AI captions
// Calls Claude API once per hour max (cached)

let cache = {
  data: null,
  fetchedAt: null
};

const CACHE_TTL_MS = 60 * 60 * 1000; // regenerate max once per hour

async function generateBrief({ forecast, regobs, webcam }) {
  const now = Date.now();

  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    console.log('[Brief] Serving from cache');
    return cache.data;
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { briefs: fallbackBriefs(forecast), error: 'No API key', generatedAt: new Date().toISOString() };
  }

  console.log('[Brief] Generating AI brief...');

  const prompt = buildPrompt({ forecast, regobs, webcam });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 600,
        system: `Du er ein lokal ekspert på forholda på Hodlekve skisenter i Sogndal.
Du skriv korte, ærlige og presise skildringar av skiforholda på nynorsk.
Du skriv alltid på nynorsk — aldri bokmål.
Du brukar ikkje emoji. Du er direkte og informativ, som ein erfaren ven som kjenner fjellet godt.
Svar KUN med JSON — ingen forklaring utanfor JSON-blokka.`,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err}`);
    }

    const data = await res.json();
    const raw = data.content[0]?.text?.trim() ?? '{}';

    // Strip markdown fences if present
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);

    const result = {
      briefs: parsed,
      generatedAt: new Date().toISOString(),
      model: 'claude-opus-4-5'
    };

    cache = { data: result, fetchedAt: now };
    console.log('[Brief] Generated successfully');
    return result;

  } catch (err) {
    console.error('[Brief] Generation failed:', err.message);
    // Fall back to rule-based brief so the page never shows nothing
    return {
      briefs: fallbackBriefs(forecast),
      generatedAt: new Date().toISOString(),
      error: err.message
    };
  }
}

function buildPrompt({ forecast, regobs, webcam }) {
  const c = forecast.current;
  const today = forecast.days[0];
  const tomorrow = forecast.days[1];
  const weekend = forecast.days.slice(2, 7);

  const regobsSummary = regobs.observations.slice(0, 3).map(o =>
    `- ${o.observer.nickname} (${o.time?.slice(0, 10)}): ${o.snowSurface ?? ''} ${o.dangerSigns ?? ''} ${o.comment ?? ''}`.trim()
  ).join('\n') || 'Ingen registrerte observasjonar siste 3 dagar.';

  const webcamCaption = webcam?.cameras?.primary?.analysis?.caption ?? 'Webkamera ikkje tilgjengeleg.';
  const snowCaption   = webcam?.cameras?.snow?.analysis?.caption ?? null;

  return `
Her er alle tilgjengelege data for Hodlekve skisenter akkurat no:

## NOVERANDE VÊRFORHOLD
- Temperatur: ${c.temperature}°C
- Vind: ${c.windSpeed} m/s frå ${c.windDirection}°
- Skydekke: ${c.cloudCover}%
- Nedbør neste time: ${c.precipNext1h} mm
- Vêrsymbol: ${c.symbol}

## DAGENS PROGNOSE (${today.date})
- Snøfall i dag: ${today.snowFall} mm
- Temperatur snitt/min/maks: ${today.tempAvg}°C / ${today.tempMin}°C / ${today.tempMax}°C
- Maks vind: ${today.windMax} m/s
- Pudderpoeng: ${today.powderScore}/10

## MORGONDAGENS PROGNOSE (${tomorrow?.date ?? 'N/A'})
- Snøfall: ${tomorrow?.snowFall ?? '?'} mm
- Temperatur snitt: ${tomorrow?.tempAvg ?? '?'}°C
- Pudderpoeng: ${tomorrow?.powderScore ?? '?'}/10

## VEKA FRAMOVER
${weekend.map(d => `- ${d.date}: ${d.snowFall}mm snø, ${d.tempAvg}°C, vind ${d.windMax}m/s → poeng ${d.powderScore}/10`).join('\n')}

## WEBKAMERA-ANALYSE (AI)
${webcamCaption}
${snowCaption ? `Snødybde: ${snowCaption}` : ''}

## REGOBS FELTOBSERVASJONAR (siste 3 dagar, nær Sogndal)
Faregrad: ${regobs.alertLevel}
${regobsSummary}

---

Skriv tre korte tekstbolkar på nynorsk basert på desse dataa.
Svar KUN med dette JSON-formatet (ingen tekst utanfor):

{
  "now": "1-2 setningar om forholda akkurat no. Kva er det beste med dagen i dag? Kva må ein passe seg for?",
  "today": "2-3 setningar om korleis dagen utviklar seg time for time. Bruk konkrete detaljar frå prognosen.",
  "week": "2-3 setningar om dei neste dagane. Peik ut den beste dagen og åtvar om dårlege dagar.",
  "verdict": "Éi setning — ein klar konklusjon: bør ein dra i dag eller vente?"
}
`.trim();
}

// Rule-based fallback if API call fails
function fallbackBriefs(forecast) {
  const c = forecast.current;
  const today = forecast.days[0];
  const score = today.powderScore;

  const scoreText = score >= 8 ? 'Framifrå pudderforhold' :
                    score >= 6 ? 'Gode tilhøve' :
                    score >= 4 ? 'Akseptable tilhøve' :
                                 'Krevjande tilhøve';

  const windWarn = c.windSpeed >= 10 ? ` Merk deg sterk vind (${c.windSpeed} m/s).` : '';
  const tempNote = c.temperature >= 0 ? ' Varmt for årstida — pass på slaps i låglandet.' : '';

  return {
    now: `${scoreText} på Hodlekve. Temperatur ${c.temperature}°C, vind ${c.windSpeed} m/s.${windWarn}${tempNote}`,
    today: `Snøfall i dag: ${today.snowFall}mm. Maks vind: ${today.windMax} m/s. Pudderpoeng: ${today.powderScore}/10.`,
    week: `Sjå 7-dagarsvarsel for detaljar om kommande dagar.`,
    verdict: score >= 7 ? 'I dag er ein god dag å dra.' : score >= 5 ? 'Greie tilhøve, men ikkje den beste dagen.' : 'Vurder å vente på betre tilhøve.'
  };
}

module.exports = { generateBrief };
