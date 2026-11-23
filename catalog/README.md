# Catalog import templates

This directory contains a **controlled file-based import path** for the product catalogue. It is intentionally not a public upload feature: there is no product-import HTTP route or browser upload form.

## Files

| File                    | Purpose                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `products-template.csv` | Blank/draft structure for authorised product owners to complete. It cannot be imported as published data.              |
| `demo-products.csv`     | The fictional TZS development catalogue. It may only be imported with the explicit non-production `--allow-demo` flag. |

## Required columns

| Column                            | Rules                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sku`                             | Unique stable identifier, 1–80 characters.                                                                                  |
| `name`                            | Approved public product name, 2–140 characters.                                                                             |
| `slug`                            | Unique URL-safe identifier: lowercase letters, digits, and hyphens.                                                         |
| `category_name` / `category_slug` | Approved public category name and URL-safe identifier.                                                                      |
| `category_description`            | Approved public category description.                                                                                       |
| `description`                     | Approved public product description. Do not include personalised medical advice, dosage instructions, or unapproved claims. |
| `price_tzs`                       | Whole non-negative Tanzanian-shilling amount.                                                                               |
| `stock_qty`                       | Whole non-negative availability quantity.                                                                                   |
| `requires_prescription`           | Required `true` or `false`; every product must be explicitly classified.                                                    |
| `featured`, `active`              | Required `true` or `false`. Only active products appear in the customer catalogue.                                          |
| `publication_status`              | `draft`, `approved`, or `demo`. Only `approved` rows can be normally imported.                                              |

The validator requires exactly these columns, rejects duplicate headers, rejects duplicate SKU/slug values, requires a consistent name/description for every shared category slug, and limits a file to 5,000 rows.

## Workflow

1. Copy `products-template.csv` to an approved working location.
2. Complete every field, including the prescription classification.
3. Obtain the applicable commercial, pharmacy, and content approvals.
4. Validate before import:

   ```bash
   npm run catalog:validate -- --file path/to/approved-products.csv
   ```

5. Import approved data into the local SQLite database:

   ```bash
   npm run catalog:import -- --file path/to/approved-products.csv --mode replace
   ```

`replace` deactivates active catalogue products not included in the import rather than deleting historical product records. `upsert` updates or adds the supplied rows without deactivating existing products. Each successful import is recorded with a checksum, row count, source filename, mode, classification summary, and an application audit event.

## Demo catalog only

The seed/demo catalogue is not approved for production. It is available for development checks only:

```bash
npm run catalog:validate -- --file catalog/demo-products.csv
npm run catalog:import -- --file catalog/demo-products.csv --mode replace --allow-demo
```

`--allow-demo` is rejected when `NODE_ENV=production`.

## Important boundaries

- CSV import does **not** verify prescriptions, approve medicines, provide clinical review, reserve stock, or publish a production catalogue.
- Do not include patient data, supplier credentials, private pricing, or confidential prescribing information in a catalog CSV.
- Retain approval records and source-of-truth evidence outside this repository according to the approved operational process.
- The application has no audit-event mutation route, but database-level audit immutability and retention controls are still a production launch requirement.
