/**
 * Milestone 4: builds public/countries.geojson — one small static asset with
 * every country pre-classified into the three choropleth states from
 * terra-app-spec.md §3.2. No runtime lookup table, no join: the tier is baked
 * into the geometry file at build time, straight from country-data-coverage.md.
 *
 * Re-run this whenever coverage.md's tier tables change:
 *   node --import tsx scripts/build-countries-geojson.ts
 *
 * Source: Natural Earth 1:50m admin-0 countries (public domain). 110m was
 * tried first and silently drops Singapore and Hong Kong — two of our Tier A/B
 * countries — because they're too small to render at that resolution. 50m
 * keeps them.
 */
import fs from 'node:fs';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const OUTPUT_PATH = 'public/countries.geojson';

// Tier A (transaction-level) + Tier B (locality-level) — country-data-coverage.md §2, §3
const HAS_DATA = new Set([
  'GB', 'FR', 'SG', 'AE', 'JP', 'KR', 'TW', 'IE', 'SI', 'DK', 'MY', // Tier A
  'IT', 'NL', 'EE', 'HK', // Tier B
]);

// Tier C — coverage.md §4, with the source hint from that section where one was named
const COMING_SOON: Record<string, string | undefined> = {
  ES: 'Catastro + Ministerio de Vivienda',
  PT: 'INE',
  DE: 'Gutachterausschüsse / BORIS — fragmented per state',
  BE: 'Statbel',
  AT: undefined,
  CH: undefined,
  PL: 'GUS',
  CZ: 'ČÚZK',
  LT: 'Registrų centras',
  LV: undefined,
  FI: 'NLS / Tilastokeskus',
  NO: 'Kartverket',
  SE: 'Lantmäteriet — likely paid',
  IS: 'HMS',
  HR: undefined,
  GR: undefined,
  RO: undefined,
  HU: 'KSH',
  NZ: 'LINZ',
  TH: 'REIC',
  PH: undefined,
  ID: undefined,
  VN: undefined,
  CL: 'SII',
  CO: undefined,
  IL: 'Tax Authority transactions — reportedly good',
  TR: 'TÜİK',
  ZA: 'Deeds Office — likely paid',
};

// Tier D — coverage.md §5, with the actual blocker reason (this is the interesting one)
const BLOCKED: Record<string, string> = {
  AU: 'Bulk sales data is CC BY-NC-ND 4.0 — non-commercial and no-derivatives. Both clauses rule it out for a commercial product showing derived figures.',
  CA: 'Transaction data sits with CREA/MLS, privately controlled. No open registry.',
  US: 'No national registry — county-by-county recorders, ~3,000 of them, inconsistent licences. Sprint 4 territory, not v1.',
};

async function main() {
  console.log(`Fetching ${SOURCE_URL}...`);
  const raw = await (await fetch(SOURCE_URL)).json();

  let hasData = 0, comingSoon = 0, noData = 0;
  const features = raw.features.map((f: { properties: Record<string, unknown>; geometry: unknown }) => {
    const iso = f.properties.ISO_A2_EH as string;
    const name = f.properties.NAME as string;

    let tier: 'has-data' | 'coming-soon' | 'no-data';
    let note: string | undefined;

    if (HAS_DATA.has(iso)) {
      tier = 'has-data';
      hasData++;
    } else if (iso in COMING_SOON) {
      tier = 'coming-soon';
      note = COMING_SOON[iso];
      comingSoon++;
    } else if (iso in BLOCKED) {
      tier = 'no-data';
      note = BLOCKED[iso];
      noData++;
    } else {
      tier = 'no-data';
      noData++;
    }

    return {
      type: 'Feature',
      properties: { iso, name, tier, note },
      geometry: f.geometry,
    };
  });

  const out = { type: 'FeatureCollection', features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out));
  console.log(`Wrote ${OUTPUT_PATH}: ${features.length} countries (${hasData} has-data, ${comingSoon} coming-soon, ${noData} no-data)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
