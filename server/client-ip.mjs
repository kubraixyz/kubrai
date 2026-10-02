// Who the caller is, for the per-address limits (faucet, feedback, wallet lookups).
//
// Only Caddy talks to this server, and what it puts in X-Forwarded-For depends on who connected to it (measured against
// Caddy 2.11.4 with the options of our Caddyfile, 2026-10-02):
//
//   connected directly        X-Forwarded-For: <peer>                          the caller's own header is thrown away
//   through Cloudflare        X-Forwarded-For: <visitor>, <Cloudflare>         the chain it was handed, plus the peer
//   through Cloudflare, with  X-Forwarded-For: <anything>, <visitor>, <Cloudflare>
//   a forged header
//
// Cloudflare is a trusted proxy in the Caddyfile, and devnet.kubrai.xyz (whose /api/* reaches this server) has been
// behind it since 2026-10-02. The first hop, which this used to return, is then whatever the caller typed: one caller
// could be a new address on every request and walk past every per-address limit.
//
// So a chain of two or more came through Cloudflare, and there the caller is CF-Connecting-IP: Cloudflare writes that
// header itself and a visitor cannot set it. A single entry is the peer Caddy saw, and CF-Connecting-IP is ignored
// then, because a caller who connects directly can send any header it likes and Caddy passes that one through.
export function clientIp(req) {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length >= 2) return String(req.headers["cf-connecting-ip"] ?? "").trim() || hops[hops.length - 2];
  return hops[0] ?? req.socket?.remoteAddress ?? "?";
}
