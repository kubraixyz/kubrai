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
