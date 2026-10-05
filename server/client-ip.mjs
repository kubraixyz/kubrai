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
//
// An IPv6 caller is counted by its /64. A subscriber is handed a whole /64 (a phone, a home router) and may use any
// address in it, so counting single addresses let one caller start every daily count from zero again on each request.
export function clientIp(req) {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length >= 2) return limitKey(String(req.headers["cf-connecting-ip"] ?? "").trim() || hops[hops.length - 2]);
  return limitKey(hops[0] ?? req.socket?.remoteAddress ?? "?");
}

/** IPv4 as is (also when written IPv4-mapped, ::ffff:a.b.c.d); IPv6 as its /64, "2001:db8:a:b::/64". Anything else
 *  (an IPv6 with an embedded IPv4 tail, a zone id, "?") is returned unchanged. */
export function limitKey(ip) {
  const s = String(ip ?? "").trim();
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i); if (v4) return v4[1];
  if (!s.includes(":")) return s;
  const halves = s.split("::"); if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return s;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
