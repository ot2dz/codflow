#!/usr/bin/env node
/**
 * Carrier commune geo-map backfill (EcoTrack family + any name-matching carrier).
 *
 * Dispatch sends the carrier's own commune spelling from carrier_communes.
 * The dashboard "Sync Delivery Zones" only records exact/near matches, which
 * silently skips spelling variants (our "Tassala El Merdja" vs DHD's
 * "Tessala El Merdja") and every later order to that commune fails with the
 * carrier's "Commune mal écrite" error. This script compares the carrier's
 * LIVE commune list against every local commune and backfills all safe
 * (unique, same-wilaya, accent/case/spacing-insensitive) matches.
 *
 * Usage (from cod-server/):
 *   node scripts/fix-carrier-geo.mjs --carrier=dhd_ecotrack            # diff report only
 *   node scripts/fix-carrier-geo.mjs --carrier=dhd_ecotrack --apply    # write mappings
 *
 * Reads credentials straight from the local or remote D1 stores table.
 */

import { execSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const flag = (name) => [...args].find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const carrier = flag("carrier");
const apply = args.has("--apply");
const local = args.has("--local");

if (!carrier) {
  console.error("Usage: node scripts/fix-carrier-geo.mjs --carrier=<company_code> [--apply] [--local]");
  process.exit(1);
}

const PERSIST = ["--persist-to", "../.wrangler-shared"];

function q(sql) {
  const scope = local ? ["--local", ...PERSIST] : ["--remote"];
  const out = execSync(
    ["npx", "wrangler", "d1", "execute", "DB", ...scope, "--json", "--command", JSON.stringify(sql)].join(" "),
    { maxBuffer: 100 * 1024 * 1024 },
  ).toString();
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return (Array.isArray(parsed) ? parsed[0] : parsed).results;
}

const company = q(
  `SELECT code, api_endpoint, api_token FROM delivery_companies WHERE code='${carrier.replace(/'/g, "''")}'`,
)[0];
if (!company) {
  console.error(`Company '${carrier}' not found.`);
  process.exit(1);
}
if (!company.api_endpoint || !company.api_token) {
  console.error("Company has no api_endpoint/api_token configured.");
  process.exit(1);
}
if (company.code !== "ecotrack" && !company.code.endsWith("_ecotrack")) {
  console.error("This backfill targets EcoTrack-family carriers (get/communes shape).");
  process.exit(1);
}

const res = await fetch(`${company.api_endpoint.replace(/\/$/, "")}/api/v1/get/communes`, {
  headers: { Authorization: `Bearer ${company.api_token}`, Accept: "application/json" },
  signal: AbortSignal.timeout(45000),
});
if (!res.ok) {
  console.error(`Carrier list fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : Object.values(data);
const byWilaya = new Map();
for (const r of rows) {
  const w = Number(r.wilaya_id ?? r.wilaya);
  const nom = String(r.nom ?? "").trim();
  if (w >= 1 && w <= 58 && nom) {
    if (!byWilaya.has(w)) byWilaya.set(w, []);
    byWilaya.get(w).push(nom);
  }
}
console.log(`${carrier}: carrier communes across ${byWilaya.size} wilayas`);

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = [...a];
  const n = [...b];
  const dp = Array.from({ length: m.length + 1 }, (_, i) => [i, ...Array(n.length).fill(0)]);
  for (let j = 0; j <= n.length; j++) dp[0][j] = j;
  for (let i = 1; i <= m.length; i++)
    for (let j = 1; j <= n.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (m[i - 1] === n[j - 1] ? 0 : 1));
  return dp[m.length][n.length];
};

const ours = q("SELECT id, wilaya_id, name FROM communes");
const mapped = new Set(q(`SELECT commune_id FROM carrier_communes WHERE carrier_code='${carrier}'`).map((r) => r.commune_id));

const claims = new Map();
const additions = [];
for (const o of ours) {
  if (mapped.has(o.id)) continue;
  const candidates = byWilaya.get(o.wilaya_id) ?? [];
  const on = norm(o.name);
  let best = null;
  let bestDist = 3;
  let ambiguous = false;
  for (const c of candidates) {
    const d = lev(on, norm(c));
    if (d < bestDist) { best = c; bestDist = d; ambiguous = false; }
    else if (d === bestDist && d > 0 && best !== null) ambiguous = true;
  }
  if (!best || ambiguous) continue;
  const key = `${o.wilaya_id}:${best}`;
  if (claims.has(key)) continue;
  claims.set(key, o.id);
  additions.push({ id: o.id, name: o.name, carrierName: best, exact: bestDist === 0 });
}

const spelling = additions.filter((a) => !a.exact);
console.log(`new mappings: ${additions.length} (spelling fixes: ${spelling.length})`);
for (const a of spelling.slice(0, 30)) console.log(`  ~ ${a.id} ${a.name} -> ${a.carrierName}`);
console.log(`unmapped after backfill: ${ours.length - mapped.size - additions.length} (carrier likely does not serve them — dispatch will surface a clear error)`);

if (!apply || additions.length === 0) {
  console.log(apply ? "nothing to apply" : "dry run — pass --apply to write");
  process.exit(0);
}

const esc = (s) => String(s).replace(/'/g, "''");
const sql = additions
  .map((a) => `INSERT OR IGNORE INTO carrier_communes (carrier_code, commune_id, carrier_name) VALUES ('${carrier}', '${a.id}', '${esc(a.carrierName)}');`)
  .join("\n");
const tmp = `fix-carrier-geo-${carrier}.sql`;
const { writeFileSync, unlinkSync } = await import("node:fs");
writeFileSync(tmp, sql, "utf8");
execSync(["npx", "wrangler", "d1", "execute", "DB", ...(local ? ["--local", ...PERSIST] : ["--remote"]), "--file", JSON.stringify(tmp)].join(" "), { stdio: "inherit" });
unlinkSync(tmp);
console.log(`applied ${additions.length} mappings for ${carrier}`);
