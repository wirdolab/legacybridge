# BankFree™ by American Stages

Seller-financing marketplace — installment sales under IRC §453. No bank required.

- `index.html` — single-file site (calculator, marketplace, buyer scoring, agents, AI chat, booking)
- `worker.js` — Cloudflare Worker: serves the site + `/api/leads`, `/api/bookings`, `/api/assistant` (Claude proxy)
- `wrangler.toml` — deploy config (worker name: `bankfree`)

Deploys automatically to Cloudflare Workers on every push to `main`.
Secrets: set `ANTHROPIC_API_KEY` in the worker's Variables and Secrets to enable the live AI assistant.
