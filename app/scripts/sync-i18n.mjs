#!/usr/bin/env node
// The app reads the website's dictionary (web/src/i18n/<lang>.json), so a market says the same words on both. Metro
// only bundles files inside app/, hence a copy: this script makes it, and with --check fails (exit 1) when a copy no
// longer matches the website's file (the pre-commit security check and deploy-app.sh run it that way).
//   node app/scripts/sync-i18n.mjs          copy web → app
//   node app/scripts/sync-i18n.mjs --check  compare only
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANGS = ["en", "zh-TW", "zh-CN", "ja", "ko", "es"];   // the languages the app ships (app/src/i18n.ts)
const check = process.argv.includes("--check");
let stale = 0;
for (const lang of LANGS) {
  const from = path.join(repo, "web/src/i18n", lang + ".json"), to = path.join(repo, "app/src/i18n", lang + ".json");
  const want = fs.readFileSync(from), have = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (have && want.equals(have)) continue;
  if (check) { console.error(`app/src/i18n/${lang}.json differs from web/src/i18n/${lang}.json: run node app/scripts/sync-i18n.mjs`); stale++; continue; }
  fs.writeFileSync(to, want); console.log(`copied ${lang}.json`);
}
process.exit(stale ? 1 : 0);
