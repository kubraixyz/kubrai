// The header shapes below are what Caddy 2.11.4 really sends upstream with our Caddyfile's options (trusted_proxies =
// Cloudflare, client_ip_headers CF-Connecting-IP X-Forwarded-For), captured from a local Caddy on 2026-10-02.
import test from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "./client-ip.mjs";

const req = (headers, remoteAddress = "127.0.0.1") => ({ headers, socket: { remoteAddress } });

test("a direct caller is the peer Caddy saw", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.7" })), "198.51.100.7");
});

test("a direct caller cannot pick its address with forged headers", () => {
  // the caller sent X-Forwarded-For: 6.6.6.6, 7.7.7.7 and CF-Connecting-IP: 6.6.6.6; Caddy replaced the first and passed the second
  assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "6.6.6.6" })), "198.51.100.7");
});

test("through Cloudflare the caller is the visitor, not the Cloudflare edge", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.9, 172.70.1.1", "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
});

test("through Cloudflare a forged X-Forwarded-For does not change who the caller is", () => {
  // this is the case the first-hop rule got wrong: it answered 6.6.6.6
  assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 172.70.1.1", "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
  // and a new forged address on every request is still one caller
  assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.9, 172.70.1.1", "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
});

test("a chain without CF-Connecting-IP falls back to the entry the proxy itself added", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 172.70.1.1" })), "203.0.113.9");
});

test("no header at all (a local caller, tests) is the socket address", () => {
  assert.equal(clientIp(req({}, "127.0.0.1")), "127.0.0.1");
  assert.equal(clientIp({ headers: {} }), "?");
});

test("an IPv6 caller is one caller across its whole /64", () => {
  const cf = (v) => clientIp(req({ "x-forwarded-for": `${v}, 2400:cb00::1`, "cf-connecting-ip": v }));
  // the audit's pattern: a new address on every request, all inside one subscriber's /64
  const seen = new Set(["2001:db8:1234:5678::1", "2001:db8:1234:5678:a:b:c:d", "2001:0db8:1234:5678:ffff:ffff:ffff:fffe", "2001:DB8:1234:5678::dead:beef"].map(cf));
  assert.deepEqual([...seen], ["2001:db8:1234:5678::/64"]);
  // a neighbouring /64 is someone else
  assert.equal(cf("2001:db8:1234:5679::1"), "2001:db8:1234:5679::/64");
  // short forms expand before the cut
  assert.equal(cf("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(cf("::1"), "0:0:0:0::/64");
  assert.equal(clientIp(req({ "x-forwarded-for": "2400:d320:2298:6904:1::7" })), "2400:d320:2298:6904::/64");
});

test("IPv4 stays one address, also when the socket writes it IPv4-mapped", () => {
  assert.equal(clientIp(req({}, "::ffff:198.51.100.7")), "198.51.100.7");
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.9, 172.70.1.1", "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
});

test("what is not a plain address passes through untouched", () => {
  for (const s of ["?", "64:ff9b::192.0.2.33", "fe80::1%eth0", "1::2::3", "not-an-ip"]) assert.equal(clientIp(req({ "x-forwarded-for": s })), s);
});
