/**
 * LegacyBridge — Cloudflare Worker backend
 *
 * Routes:
 *   GET  /api/listings   → listings JSON (KV-backed, falls back to seed data)
 *   POST /api/leads      → store lead {email} in KV
 *   POST /api/assistant  → proxy to Anthropic API (keeps API key server-side)
 *   *                    → serve static assets (index.html) via [assets] binding
 *
 * Setup:
 *   1. wrangler kv namespace create LEADS   → add id to wrangler.toml
 *   2. wrangler secret put ANTHROPIC_API_KEY
 *   3. wrangler deploy
 */

const SEED_LISTINGS = [
  { id: 1, price: 1850000, addr: 'Pasadena, CA — 3bd/2ba Craftsman', lat: 34.147, lng: -118.144, down: 15, rate: 6.25, term: 20 },
  { id: 2, price: 2400000, addr: 'Walnut Creek, CA — 4bd/3ba on ½ acre', lat: 37.906, lng: -122.065, down: 20, rate: 6.0, term: 15 },
];

const SYSTEM_PROMPT = `You are the LegacyBridge assistant. LegacyBridge is a marketplace connecting
homeowners (often 60+, with free-and-clear, highly appreciated homes) to qualified buyers for
seller-financed installment sales under IRC Section 453.

You explain, in plain language:
- Installment sales (IRC §453): gain recognized proportionally as principal is received (gross profit ratio), reported on Form 6252; interest income is ordinary income.
- Why spreading gain lowers taxes: federal LTCG brackets (0/15/20%), 3.8% NIIT thresholds ($200k/$250k MAGI), California brackets up to 13.3%.
- The step-up in basis trade-off (IRC §1014) — be honest that holding until death eliminates capital gains for heirs, and remaining installment payments are income in respect of a decedent.
- Deal mechanics: promissory note, deed of trust, title insurance, escrow, third-party servicing, foreclosure on default.
- Legal guardrails: Dodd-Frank 3-deals/year seller-financing exemption, §453A interest charge over $5M, due-on-sale (platform requires free-and-clear homes), state law variation.
- Secondary market for performing notes (typically 85–95% of remaining balance).

Also handle questions beyond the site's content when they relate to seller financing, real estate, taxes, buying, selling, or partnering — answer helpfully from general knowledge. Notes:
- Referral partners: the paid partner program is for licensed real-estate agents and financial advisors; transaction-based referral compensation generally requires a license (e.g., under California law). Anyone may informally introduce a homeowner.
- Never state specific agent commission rates — each listing agent sets their own rate, paid through escrow.

Rules:
- Respond in PLAIN TEXT only — no markdown, no asterisks, no bullet points, no headers. The chat widget renders raw text.
- ALWAYS include a brief reminder that you provide education, not tax/legal advice, and users should consult their CPA/attorney.
- Never guarantee tax outcomes or investment returns.
- Keep answers under 150 words unless asked for detail.
- LegacyBridge is a marketplace, NOT a lender — never imply it originates or funds loans.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // --- GET /api/listings ---
    if (url.pathname === '/api/listings' && request.method === 'GET') {
      let listings = SEED_LISTINGS;
      if (env.LISTINGS) {
        const stored = await env.LISTINGS.get('all', 'json');
        if (stored) listings = stored;
      }
      return json({ listings });
    }

    // --- POST /api/leads ---
    if (url.pathname === '/api/leads' && request.method === 'POST') {
      try {
        const { email } = await request.json();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid email' }, 400);
        if (env.LEADS) {
          await env.LEADS.put(`lead:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify({
            email, ts: new Date().toISOString(), ua: request.headers.get('User-Agent') || '',
          }));
        }
        return json({ ok: true });
      } catch { return json({ error: 'bad request' }, 400); }
    }

    // --- POST /api/bookings ---
    if (url.pathname === '/api/bookings' && request.method === 'POST') {
      try {
        const { email, name = '', day, time } = await request.json();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid email' }, 400);
        if (!day || !time) return json({ error: 'missing slot' }, 400);
        if (env.LEADS) {
          await env.LEADS.put(`booking:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify({
            email, name, day, time, ts: new Date().toISOString(),
          }));
        }
        // TODO: send confirmation email (e.g. MailChannels / Resend) and create calendar event
        return json({ ok: true });
      } catch { return json({ error: 'bad request' }, 400); }
    }

    // --- POST /api/assistant ---
    if (url.pathname === '/api/assistant' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'assistant not configured' }, 503);
      try {
        const { message, history = [] } = await request.json();
        if (!message || message.length > 2000) return json({ error: 'invalid message' }, 400);

        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: SYSTEM_PROMPT,
            messages: [...history.slice(-10), { role: 'user', content: message }],
          }),
        });
        if (!resp.ok) return json({ error: 'upstream error' }, 502);
        const data = await resp.json();
        return json({ reply: data.content?.[0]?.text || '' });
      } catch { return json({ error: 'bad request' }, 400); }
    }

    // --- Static assets (configure [assets] in wrangler.toml) ---
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
