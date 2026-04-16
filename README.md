# Hodlekve Conditions API

Live snow conditions backend for Hodlekve / Sogndal Skisenter.

## Data sources
- **MET.no** — hourly weather forecast (free, no API key needed)
- **Regobs / NVE Varsom** — crowdsourced snow & avalanche observations (free, no API key needed)

## Setup on VPS

```bash
# Clone / copy to server
cd /var/www   # or wherever you keep projects
git clone <your-repo> hodlekve
cd hodlekve

# Install
npm install

# Start with PM2 (same as mtt-hub)
pm2 start server.js --name hodlekve-conditions
pm2 save
```

## Nginx config

Add this to your nginx config (alongside mtt-hub):

```nginx
server {
    listen 80;
    server_name hodlekve.sims84.no;  # or hodlekve.live when you have the domain

    location / {
        proxy_pass http://localhost:3030;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then: `sudo certbot --nginx -d hodlekve.sims84.no`

## Endpoints

| Route | Description |
|-------|-------------|
| `GET /api/conditions` | Full dashboard data (MET + Regobs + powder score) |
| `GET /api/forecast` | 7-day forecast from MET.no only |
| `GET /api/observations` | Regobs snow observations only |
| `GET /health` | Server health check |

## Example response — /api/conditions

```json
{
  "ok": true,
  "data": {
    "powderScore": 8,
    "current": {
      "temperature": -6.2,
      "windSpeed": 3.1,
      "windDesc": "Svak bris",
      "cloudCover": 25,
      "visibilityDesc": "God (lettskya)"
    },
    "alert": {
      "level": "moderate",
      "title": "Faretegn på snøskred observert",
      "text": "Observert: Naturleg skred. Ver forsiktig i bratt terreng."
    },
    "forecast": {
      "days": [
        { "date": "2025-01-16", "tempAvg": -5.8, "snowFall": 14, "windMax": 4.2, "powderScore": 8 },
        ...
      ]
    }
  }
}
```

## Next steps

- [ ] Phase 2: Webcam image fetching + Claude Vision AI captions
- [ ] Phase 3: Claude API for Norwegian-language daily brief
- [ ] Phase 4: Frontend dashboard (hodlekve.live)
