# BotForge

| Part | Where it runs |
| --- | --- |
| `index.html`, `assets/` | The main site, served by **GitHub Pages** at www.botforgeservices.dev |
| `server/` | The order server (orders, customer order pages, admin dashboard), run on **Render** |

GitHub Pages only serves plain files, so it can show the site but can't save orders. When a customer presses **Send my order**, the page sends it to the order server. The server's address is in this line near the top of `index.html`:

```html
<meta name="botforge-api" content="https://botforge-orders.onrender.com">
```

## Set up the order server on Render (once)

1. Sign in at https://render.com with GitHub.
2. Choose **New → Blueprint**, pick this repo, and press **Apply**. Render reads `render.yaml` and creates the `botforge-orders` service with a disk for orders.
3. When it's live, open the service's **Environment** tab and copy `ADMIN_PASSWORD`. You can change it there.
4. Your dashboard is at `https://botforge-orders.onrender.com/admin`.

If Render gives the service a different address, update `SITE_URL` in Render's Environment tab and the `botforge-api` line in `index.html`.

Every push to `main` updates both the site and the order server.

## Cost

The disk that keeps orders needs Render's Starter plan (about $7/month). On the free plan the server sleeps when idle and **orders are wiped** on every restart.

## Running it on your own computer

```
cd server
npm install
npm start
```

Then open http://localhost:3000 and http://localhost:3000/admin. The first start creates `server/.env` with an admin password. Needs Node.js 22.5 or newer.

## Backups

Orders are in `botforge.db` in the data folder (`/var/data` on Render, `server/data` locally).
