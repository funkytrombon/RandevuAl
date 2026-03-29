# RandevuAl

A Node.js utility that checks i18n message-key consistency across a translation catalog and test fixtures.

## What it does

The `check:i18n-keys` script reads a message catalog and a set of fixture files, then verifies:

- Every `message_key` referenced in a fixture exists in the catalog.
- Every catalog entry has a non-empty translation for all configured languages (`tr`, `en`, `de`, `nl`).
- Unused catalog keys are reported as warnings.

A JSON report is written to `artifacts/i18n-key-check-report.json` after each run.

## Running locally

```bash
node -v   # Node 20 recommended
npm install
npm run check:i18n-keys
```

## Required files

The paths below are configured in `scripts/check-message-keys.config.json`:

| File | Description |
|------|-------------|
| `i18n/message-catalog.v1.4.master.json` | Master translation catalog (keys → `{tr, en, de, nl}`) |
| `i18n/fixtures/backend-outcome-test-fixture.v1.json` | Backend outcome test cases |
| `i18n/fixtures/intent-routing-test-fixture.v2.expanded.json` | Intent-routing test cases |
| `i18n/fixtures/email-validation-test-fixture.v1.deterministic.json` | Email-validation test cases |

Each fixture must be a JSON object with a top-level `cases` array where each case has an `id` and `expected.message_key` (uppercase letters, digits, and underscores only).

## What causes CI to fail

| Condition | Result |
|-----------|--------|
| `i18n/message-catalog.v1.4.master.json` is missing | ❌ Fail |
| A fixture references a key not present in the catalog | ❌ Fail |
| A catalog entry is missing one or more language translations | ❌ Fail |
| Catalog keys that are never referenced in any fixture | ⚠️ Warning only |

## Report output

After a successful run the report is written to `artifacts/i18n-key-check-report.json` and contains:

```json
{
  "status": "pass" | "fail",
  "missing_keys": [],
  "incomplete_translation": [],
  "occurrences": {},
  "unused_keys": []
}
```
