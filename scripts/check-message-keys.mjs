import fs from "node:fs";
import path from "node:path";

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function uniq(arr) {
  return [...new Set(arr)].sort();
}
function isKeyLike(s) {
  return typeof s === "string" && /^[A-Z0-9_]+$/.test(s);
}
function collectFixtureKeys(fixtureJson, fixturePath) {
  const keys = [];
  const occurrences = {};
  const cases = fixtureJson?.cases;
  if (!Array.isArray(cases)) return { keys, occurrences };

  for (const c of cases) {
    const caseId = c?.id ?? "(no-id)";
    const k = c?.expected?.message_key;
    if (!isKeyLike(k)) continue;

    keys.push(k);
    occurrences[k] ??= [];
    occurrences[k].push({ source: fixturePath, case_id: caseId });
  }
  return { keys, occurrences };
}
function mergeOccurrences(target, src) {
  for (const [k, arr] of Object.entries(src)) {
    target[k] ??= [];
    target[k].push(...arr);
  }
}
function validateCatalogTranslations(catalog, languages) {
  const incomplete = [];
  for (const [key, val] of Object.entries(catalog)) {
    if (key === "meta") continue;

    const missingLangs = [];
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      missingLangs.push(...languages);
    } else {
      for (const lang of languages) {
        const msg = val[lang];
        if (typeof msg !== "string" || msg.trim().length === 0) missingLangs.push(lang);
      }
    }

    if (missingLangs.length > 0) incomplete.push({ key, missing_languages: missingLangs });
  }
  return incomplete;
}

function main() {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, "scripts", "check-message-keys.config.json");
  const config = readJson(configPath);

  const catalogAbs = path.join(repoRoot, config.catalogPath);

  if (!fs.existsSync(catalogAbs)) {
    console.error(`[error] Catalog not found: ${config.catalogPath} (resolved: ${catalogAbs}). Add the catalog file or fix the path in the config.`);
    process.exit(1);
  }

  const languages = config.languages ?? ["tr", "en", "de", "nl"];
  const fixturePaths = config.fixturePaths ?? [];

  const catalog = readJson(catalogAbs);
  const catalogKeys = new Set(Object.keys(catalog).filter((k) => k !== "meta"));

  const usedKeys = [];
  const occurrences = {};

  for (const rel of fixturePaths) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[warn] Fixture not found, skipping: ${rel}`);
      continue;
    }
    const fixtureJson = readJson(abs);
    const { keys, occurrences: occ } = collectFixtureKeys(fixtureJson, rel);
    usedKeys.push(...keys);
    mergeOccurrences(occurrences, occ);
  }

  const usedKeysUniq = uniq(usedKeys);
  const missingKeys = usedKeysUniq.filter((k) => !catalogKeys.has(k));
  const incompleteTranslation = validateCatalogTranslations(catalog, languages);
  const unusedKeys = uniq([...catalogKeys].filter((k) => !usedKeysUniq.includes(k)));

  const status =
    (config.strict?.failOnMissingKeys && missingKeys.length > 0) ||
    (config.strict?.failOnIncompleteTranslations && incompleteTranslation.length > 0)
      ? "fail"
      : "pass";

  const report = {
    status,
    missing_keys: missingKeys,
    incomplete_translation: incompleteTranslation,
    occurrences,
    unused_keys: unusedKeys
  };

  console.log(`i18n key check: ${status.toUpperCase()}`);

  if (missingKeys.length > 0) {
    console.log(`\nMissing keys (${missingKeys.length}):`);
    for (const k of missingKeys) {
      console.log(`- ${k}`);
      for (const o of occurrences[k] ?? []) console.log(`    at ${o.source} (case: ${o.case_id})`);
    }
  }

  if (incompleteTranslation.length > 0) {
    console.log(`\nIncomplete translations (${incompleteTranslation.length}):`);
    for (const row of incompleteTranslation) {
      console.log(`- ${row.key}: missing ${row.missing_languages.join(", ")}`);
    }
  }

  if (config.report?.warnUnused && unusedKeys.length > 0) {
    console.log(`\nUnused keys in catalog (${unusedKeys.length}) [warn]:`);
    for (const k of unusedKeys.slice(0, 200)) console.log(`- ${k}`);
    if (unusedKeys.length > 200) console.log(`... and ${unusedKeys.length - 200} more`);
  }

  if (config.report?.emitJson) {
    const outRel = config.report.jsonPath ?? "artifacts/i18n-key-check-report.json";
    const outAbs = path.join(repoRoot, outRel);
    ensureDir(path.dirname(outAbs));
    fs.writeFileSync(outAbs, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nWrote report: ${outRel}`);
  }

  if (status === "fail") process.exit(1);
}
main();
