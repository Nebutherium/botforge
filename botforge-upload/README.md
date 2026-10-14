# BotForge

| Part | Where it runs |
| --- | --- |
| `index.html`, `assets/` | The main site, on **GitHub Pages** at www.botforgeservices.dev |
| `server/` | The order server (saves orders, customer order pages, admin dashboard), on **your desktop** |

GitHub Pages only serves plain files, so it shows the site but can't save orders. When a customer presses **Send my order**, the page sends it to the order server on your desktop at `https://api.botforgeservices.dev`. That address is set in this line near the top of `index.html`:

```html
<meta name="botforge-api" content="https://api.botforgeservices.dev">
```

## Set up the desktop (once)

1. Install **Node.js 22.5+** from nodejs.org and **Caddy** from caddyserver.com.
2. Download this repo to your desktop (Code → Download ZIP, or `git clone`).
3. In `server/`, double-click `start.bat`. The first start creates `server/.env` and prints your admin password.
4. Open `server/.env` and set `SITE_URL=https://api.botforgeservices.dev` and `TRUST_PROXY=1`, then restart `start.bat`.
5. Where you bought botforgeservices.dev, add a DNS **A record**: name `api`, value = your home IP (search "what is my IP").
6. On your router, forward ports **80** and **443** to your desktop's local IP.
7. In `server/`, open a terminal and run `caddy run`. Caddy reads `Caddyfile` and gets an HTTPS certificate automatically.

Dashboard: `https://api.botforgeservices.dev/admin` (or `http://localhost:3000/admin` on the desktop itself).

Keep `start.bat` and `caddy run` open. If the desktop is off or asleep, the site still shows but orders can't be sent.

If your home IP changes, update the `api` DNS record.

## Backups

Orders are in `server/data/botforge.db`. Copy the `server/data` folder to back up. It is never uploaded to GitHub.
