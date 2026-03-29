# RandevuAl

An i18n (internationalization) key consistency checker for the RandevuAl appointment booking system. It validates that all message keys used in test fixtures exist in the master message catalog and have complete translations for all supported languages.

## Running locally

```sh
npm run check:i18n-keys
```

## Required files

The following files must exist before the check can run (paths are relative to the repository root):

| File | Description |
|------|-------------|
| `i18n/message-catalog.v1.4.master.json` | Master translation catalog |
| `i18n/fixtures/backend-outcome-test-fixture.v1.json` | Backend outcome test cases |
| `i18n/fixtures/intent-routing-test-fixture.v2.expanded.json` | Intent routing test cases |
| `i18n/fixtures/email-validation-test-fixture.v1.deterministic.json` | Email validation test cases |

File paths are configured in `scripts/check-message-keys.config.json`.

### Catalog format

```json
{
  "meta": { "version": "1.4" },
  "MY_KEY": {
    "tr": "Türkçe çeviri",
    "en": "English translation",
    "de": "Deutsche Übersetzung",
    "nl": "Nederlandse vertaling"
  }
}
```

### Fixture format

```json
{
  "cases": [
    { "id": "case-001", "expected": { "message_key": "MY_KEY" } }
  ]
}
```

## What causes CI to fail

- **Missing catalog** — `i18n/message-catalog.v1.4.master.json` does not exist
- **Missing keys** — a fixture references a key not present in the catalog
- **Incomplete translations** — a catalog key is missing a translation for one or more supported languages (`tr`, `en`, `de`, `nl`)

## Report output

After each run the script writes a JSON report to `artifacts/i18n-key-check-report.json` with the following fields:

```json
{
  "status": "pass | fail",
  "missing_keys": [],
  "incomplete_translation": [],
  "occurrences": {},
  "unused_keys": []
}
```
