# Gristachy Pharmarchy implementation backlog

**Product decision:** regulated-pharmacy storefront foundation using TZS demo data and the provisional public display brand **Gristachy Pharmarchy**.
**Safety boundary:** this release does not process payments, dispense products, provide medical advice, or verify prescriptions. Every order is submitted as **pending pharmacist review**.

## Delivery status

| Milestone | Scope                                                                                        | Status                                                                 |
| --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M0        | Repository hygiene, documentation, architecture, legacy-template isolation                   | Quality automation implemented; deployment hardening remains           |
| M1        | SQLite catalog/cart/order API, controlled CSV import, validation, and tests                  | Demo implementation complete; production controls remain               |
| M2        | Responsive storefront, provisional brand config, dynamic catalog, cart, review-only checkout | Demo implementation complete; content/accessibility validation remains |
| M3        | Production readiness, operations, compliance, integrations                                   | Planned — launch gates are mandatory                                   |

## M0 — engineering baseline

- [x] Archive the legacy static template so it is not the served application.
- [x] Add `.gitignore` and remove tracked macOS metadata.
- [x] Add Node package manifest, scripts, local development documentation, and a safe `.env.example`.
- [x] Record the product and safety scope.
- [x] Add automated formatting/linting, a local `npm run verify` quality gate, GitHub Actions CI, Dependabot, editor settings, and a security-reporting policy.
- [ ] Establish staging/production environment configuration, secrets management, deployment approvals, and runtime monitoring.

**Acceptance criteria:** a developer can install locked dependencies, start the app, run the complete quality gate, and understand the safety boundary from the README.

## M1 — pharmacy commerce API

- [x] Define SQLite entities for categories, products, carts, cart items, orders, and immutable order-item snapshots.
- [x] Seed clearly marked demo inventory priced in whole Tanzanian shillings.
- [x] Add controlled local/CI CSV catalog validation and transactional import templates with explicit OTC/prescription classification, draft/demo guards, replace/upsert modes, and import audit records.
- [x] Provide catalog, product, cart, and review-only order endpoints.
- [x] Validate API input and enforce product stock limits.
- [x] Require a prescription reference and consent for prescription-required items.
- [x] Store submitted orders as `pending_pharmacist_review`; do not create a payment or dispense action.
- [x] Add API tests for catalog, cart, stock, prescription-review, staff-session, CSRF, and audit flows.
- [x] Implement a demo-only authenticated pharmacist role with opaque hashed sessions, CSRF protection, rate-limited login, review decisions, and application-recorded audit events.
- [x] In production mode, skip new demo seeding, disable an already-seeded demo staff account, end its sessions, and suppress demo catalog rows.
- [ ] Add production identity management, MFA, staff provisioning/deprovisioning, access reviews, database-enforced audit immutability, and monitored audit-log retention.
- [ ] Add a secure, encrypted prescription-document intake service with retention/deletion rules.
- [ ] Integrate real inventory/price source and robust reservation logic.

**Acceptance criteria:** invalid orders are rejected, prescription-required orders cannot bypass review intake, and API tests pass.

## M2 — storefront experience

- [x] Build a responsive SPA shell with clear demo and pharmacist-review messaging.
- [x] Apply the provisional Gristachy Pharmarchy display brand and validated TZS/`en-TZ` theme configuration without publishing contact, delivery, service-area, or operating-hour claims.
- [x] Implement catalog search, category filter, and prescription filter.
- [x] Implement product detail, cart persistence, quantity controls, and totals.
- [x] Implement checkout validation and order-reference confirmation.
- [x] Add a protected demo staff console with a queue, review form, status summary, and audit timeline.
- [x] Use meaningful heading hierarchy, labels, live regions, and no placeholder links.
- [ ] Add focused accessibility testing with keyboard and screen-reader checks.
- [ ] Replace provisional/demo content and imagery with final approved branding, product information, policies, and authorised catalog data.
- [ ] Publish non-medical customer support, delivery area, operating-hour, and returns guidance only after operations approves it.

**Acceptance criteria:** a shopper can browse demo products, build a cart, and submit a review request without payment or misleading dispensing claims.

## M3 — launch gates (do not skip)

1. **Regulatory and clinical governance** — confirm licensing, pharmacist review SOPs, prescription requirements, age/location restrictions, advertising rules, and adverse-event/escalation processes for the launch market.
2. **Privacy and security** — privacy notice, consent record, data minimisation, retention schedule, encrypted sensitive data, access controls, database-enforced immutable audit logs, backups, vulnerability management, and incident response.
3. **Identity and staff operations** — replace the demo credential with approved identity management, MFA, role-based access control, provision/deprovision controls, access reviews, secure staff approval queue, communication templates, inventory fulfilment, and approved substitution/refund process.
4. **Payments and fulfilment** — integrate an approved PSP only after legal/compliance review; do not transmit card details to this application. Integrate delivery, tax, receipt, and reconciliation workflows.
5. **Quality assurance** — automated tests, accessibility audit, threat model, penetration test, load test, monitoring, alerting, disaster recovery exercise, and staged rollout.

## Suggested next sprint after this foundation

1. Agree final business/legal requirements, clinical SOPs, and a data-processing map.
2. Replace demo staff authentication with an approved identity provider, MFA, provisioning controls, and audit-log operations.
3. Replace the demo catalog with authorised source-of-truth data and media.
4. Build secure prescription upload/review using a specialist protected-data storage service.
5. Add fulfilment, notifications, payment-provider integration, and end-to-end test coverage only after approval.
