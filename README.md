# Gristachy Pharmarchy — pharmacist-review storefront foundation

A full-stack demonstration foundation for a regulated-pharmacy storefront. The provisional public display brand is **Gristachy Pharmarchy**. It provides a data-driven product catalogue, server-backed cart, and a review-only order request flow using Tanzanian-shilling (TZS) demo data.

> **Important safety boundary**
>
> This repository is a development demonstration, not a live pharmacy system. It does **not** process payments, dispense medication, verify a prescription, provide clinical advice, or determine medicine suitability. Submitted requests begin as `pending_pharmacist_review`; a protected **demo-only** staff console can record a fictional review outcome, but this is not a real clinical, prescription, payment, or dispensing decision. Do not use it with real patient or prescription data until the launch gates in [`IMPLEMENTATION_BACKLOG.md`](IMPLEMENTATION_BACKLOG.md) are completed and authorised.

## What is implemented

- Express API with SQLite storage.
- Clearly labelled local demo products and categories in whole Tanzanian shillings (TZS); demo rows are suppressed in production mode.
- A schema-validated, non-secret storefront configuration for the provisional brand, TZS/`en-TZ` formatting, theme values, catalog state, and unpublished operations placeholder.
- Controlled local/CI CSV validation and transactional import tooling for approved products; there is no public product-upload endpoint.
- Product search and category/prescription filters.
- Server-backed carts persisted in the browser by a random cart identifier.
- Stock-aware item quantities and server-calculated totals.
- Checkout input validation.
- Prescription-required products require a **reference** and explicit consent before the order-review request can be submitted.
- Orders are saved as `pending_pharmacist_review`; there is no payment, fulfilment, or dispensing endpoint.
- Demo-only pharmacist authentication using opaque hashed session tokens in `HttpOnly` cookies, CSRF protection, staff role checks, and login throttling.
- A protected staff queue that can record a fictional `approved_for_payment` or `rejected` review state with a required note and application-recorded audit event.
- Automated API tests for catalog validation/import, configuration projection, cart, prescription-review, staff-session, CSRF, audit, and production demo guards.

## Quick start

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Open the address printed by the server, normally `http://localhost:3000`.

For a production-style local launch:

```bash
npm start
```

Run the complete local quality gate:

```bash
npm run verify
```

This runs syntax checks, schema validation for the storefront configuration and committed catalog templates, ESLint with zero warnings, Prettier validation, the Node test suite, and a production-dependency audit. Use `npm run format` only when you intentionally want Prettier to rewrite source files. Run `npm run test:coverage` separately to print the Node runtime coverage report.

The SQLite file is generated at `data/pharmarchy.sqlite` and is intentionally ignored by Git. Delete it to reset demo data.

### Quality automation

GitHub Actions runs `npm ci` followed by `npm run verify` on pushes to `main`, pull requests, and manual dispatches. Dependabot checks npm packages and GitHub Actions weekly. The repository also includes [`.editorconfig`](.editorconfig), [`.prettierrc.json`](.prettierrc.json), [`eslint.config.js`](eslint.config.js), and [`SECURITY.md`](SECURITY.md).

### Catalog and provisional storefront configuration

The non-secret public configuration is in [`config/storefront.json`](config/storefront.json). It currently exposes the provisional display brand **Gristachy Pharmarchy**, uses `TZS` and `en-TZ`, and deliberately keeps contact, address, delivery, service-area, and operating-hour fields unpublished. The public configuration endpoint projects only the approved operations message while operations are marked `not_published`.

Catalog changes are controlled files run locally or in CI, not a browser upload. Start from [`catalog/products-template.csv`](catalog/products-template.csv), retain an explicit `requires_prescription` value on every row, and obtain the relevant pharmacy, commercial, and content approvals before import:

```bash
npm run catalog:validate -- --file path/to/approved-products.csv
npm run catalog:import -- --file path/to/approved-products.csv --mode replace
```

`upsert` adds or updates only supplied rows. `replace` deactivates active products absent from the import rather than deleting historical product records. Draft rows cannot be imported. The fictional development catalog requires the explicit `--allow-demo` flag and is rejected in `NODE_ENV=production`:

```bash
npm run catalog:validate -- --file catalog/demo-products.csv
npm run catalog:import -- --file catalog/demo-products.csv --mode replace --allow-demo
```

See [`catalog/README.md`](catalog/README.md) for the strict column rules and operational boundaries, and [`config/README.md`](config/README.md) for public-config handling.

### Demo staff console

Outside production mode, a fictional local staff account is seeded for testing the protected review console at `#/staff`:

```text
Email:    pharmacist@demo.pharmarchy.test
Password: DemoPharmarchyReview2026!
```

Override the development password by setting `DEMO_STAFF_PASSWORD` in the process environment; [`.env.example`](.env.example) documents the supported variables. `NODE_ENV=production` skips demo seeding, disables an already-seeded demo account, and ends its existing sessions. This is deliberately **not** a production identity design: use approved identity management, MFA, provisioned staff accounts, TLS, secure secret handling, monitoring, and access-review processes before real use.

## Project layout

```text
catalog/            Controlled product CSV template, fictional development data, and import workflow guide
config/             Non-secret provisional storefront configuration and public-config guide
public/             Browser application (HTML, CSS, client JavaScript)
server/             Express app, API validation, SQLite schema, sessions, audit, catalog import, and seed data
test/               Node test suite
.github/            CI quality gate and Dependabot configuration
legacy-template/    Archived original static Colorlib template; not served
IMPLEMENTATION_BACKLOG.md  Prioritised delivery plan and launch gates
```

## API overview

| Method   | Endpoint                                | Purpose                                                            |
| -------- | --------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/health`                           | Service health check                                               |
| `GET`    | `/api/storefront`                       | Approved public brand/theme/locale/configuration projection        |
| `GET`    | `/api/categories`                       | Product categories                                                 |
| `GET`    | `/api/products`                         | Search/filter product catalogue                                    |
| `GET`    | `/api/products/:slug`                   | Product detail                                                     |
| `POST`   | `/api/carts`                            | Create an anonymous cart                                           |
| `GET`    | `/api/carts/:cartId`                    | Retrieve a cart and calculated totals                              |
| `POST`   | `/api/carts/:cartId/items`              | Add a product to a cart                                            |
| `PATCH`  | `/api/carts/:cartId/items/:productId`   | Update item quantity                                               |
| `DELETE` | `/api/carts/:cartId/items/:productId`   | Remove an item                                                     |
| `POST`   | `/api/orders`                           | Submit a pharmacist-review order request                           |
| `POST`   | `/api/staff/auth/login`                 | Start a demo staff session (rate limited)                          |
| `GET`    | `/api/staff/auth/me`                    | Retrieve the authenticated staff profile and rotate its CSRF token |
| `POST`   | `/api/staff/auth/logout`                | End a staff session (CSRF-protected)                               |
| `GET`    | `/api/staff/orders/summary`             | Staff-only review status counts                                    |
| `GET`    | `/api/staff/orders`                     | Staff-only filtered review queue                                   |
| `GET`    | `/api/staff/orders/:reference`          | Staff-only order, request and audit detail                         |
| `POST`   | `/api/staff/orders/:reference/decision` | Record a CSRF-protected demo review decision                       |

All API fields are validated server-side. The API is same-origin by design; it does not enable cross-origin access. Staff session tokens are opaque and stored server-side only as hashes; the browser receives them as `HttpOnly`, `SameSite=Lax` cookies. Staff mutation routes require an `X-CSRF-Token` header.

## Regulated-pharmacy launch requirements

This foundation intentionally stops before the high-risk parts of pharmacy commerce. Before any real-world use, complete the M3 launch gates in [`IMPLEMENTATION_BACKLOG.md`](IMPLEMENTATION_BACKLOG.md): legal and clinical governance, privacy/security controls, production identity/MFA and staff-operations workflows, secure prescription-document handling, payment/fulfilment integration, and operational testing. The demo staff console is a technical pattern, not evidence that these controls are complete. In particular, audit events have no application mutation route but do **not** yet have database-enforced immutability or production retention controls.

## Legacy source

The original static template is preserved under `legacy-template/` for reference but is not served by the Node application. Its third-party license/attribution must be reviewed before any assets or copy are reused.
