import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { defaultDemoStaffPassword, demoStaffEmail } from "../server/auth.js";
import { createDatabase } from "../server/database.js";

function setup(t) {
  const db = createDatabase({ filename: ":memory:" });
  t.after(() => db.close());
  return request(createApp({ db }));
}

function setupAgent(t) {
  const db = createDatabase({ filename: ":memory:" });
  t.after(() => db.close());
  return request.agent(createApp({ db }));
}

function customerDetails() {
  return {
    firstName: "Asha",
    lastName: "Mashauri",
    email: "asha@example.test",
    phone: "+255 700 000 000",
    addressLine1: "12 Demo Street",
    addressLine2: "",
    district: "Ilala",
    region: "Dar es Salaam"
  };
}

test("health and catalogue endpoints expose seeded demo data", async (t) => {
  const api = setup(t);

  const health = await api.get("/api/health").expect(200);
  assert.equal(health.body.data.status, "ok");

  const categories = await api.get("/api/categories").expect(200);
  assert.equal(categories.body.data.length, 4);

  const products = await api.get("/api/products?prescription=required").expect(200);
  assert.equal(products.body.meta.count, 2);
  assert.ok(products.body.data.every((product) => product.requiresPrescription));
  assert.equal(products.body.data[0].priceTzs > 0, true);
});

test("public storefront configuration applies the provisional brand without publishing operations fields", async (t) => {
  const api = setup(t);
  const storefront = await api.get("/api/storefront").expect(200);

  assert.equal(storefront.body.data.brand.displayName, "Gristachy Pharmarchy");
  assert.equal(storefront.body.data.locale.currency, "TZS");
  assert.equal(storefront.body.data.locale.locale, "en-TZ");
  assert.equal(storefront.body.data.catalog.publicationStatus, "template_only");
  assert.equal(storefront.body.data.operations.publicationStatus, "not_published");
  assert.ok(storefront.body.data.operations.publicMessage);
  assert.equal("phone" in storefront.body.data.operations, false);
  assert.equal("email" in storefront.body.data.operations, false);
  assert.equal("address" in storefront.body.data.operations, false);
  assert.equal("legalName" in storefront.body.data.brand, false);
});

test("cart updates are persistent, calculated server-side, and stock-aware", async (t) => {
  const api = setup(t);
  const products = await api.get("/api/products").expect(200);
  const paracetamol = products.body.data.find(
    (product) => product.slug === "paracetamol-500mg-tablets"
  );

  const created = await api.post("/api/carts").expect(201);
  const cartId = created.body.data.id;

  const added = await api
    .post(`/api/carts/${cartId}/items`)
    .send({ productId: paracetamol.id, quantity: 2 })
    .expect(201);
  assert.equal(added.body.data.itemCount, 2);
  assert.equal(added.body.data.subtotalTzs, paracetamol.priceTzs * 2);

  const updated = await api
    .patch(`/api/carts/${cartId}/items/${paracetamol.id}`)
    .send({ quantity: 3 })
    .expect(200);
  assert.equal(updated.body.data.itemCount, 3);
  assert.equal(updated.body.data.subtotalTzs, paracetamol.priceTzs * 3);

  const stockError = await api
    .patch(`/api/carts/${cartId}/items/${paracetamol.id}`)
    .send({ quantity: paracetamol.stockQty + 1 })
    .expect(409);
  assert.equal(stockError.body.error.code, "STOCK_LIMIT");
});

test("prescription-required items cannot bypass pharmacist-review intake", async (t) => {
  const api = setup(t);
  const products = await api.get("/api/products?prescription=required").expect(200);
  const prescriptionProduct = products.body.data[0];
  const cart = await api.post("/api/carts").expect(201);
  const cartId = cart.body.data.id;

  await api
    .post(`/api/carts/${cartId}/items`)
    .send({ productId: prescriptionProduct.id, quantity: 1 })
    .expect(201);

  const baseRequest = {
    cartId,
    customer: customerDetails(),
    consents: { privacy: true, terms: true }
  };

  const noReference = await api.post("/api/orders").send(baseRequest).expect(422);
  assert.equal(noReference.body.error.code, "PRESCRIPTION_REFERENCE_REQUIRED");

  const order = await api
    .post("/api/orders")
    .send({
      ...baseRequest,
      prescription: { reference: "DEMO-RX-REF-2026-001", consentToReview: true }
    })
    .expect(201);

  assert.match(order.body.data.reference, /^PHM-\d{8}-[A-F0-9]{8}$/);
  assert.equal(order.body.data.status, "pending_pharmacist_review");
  assert.equal(order.body.data.containsPrescription, true);

  const submittedCart = await api.get(`/api/carts/${cartId}`).expect(200);
  assert.equal(submittedCart.body.data.status, "submitted");
});

test("orders require explicit review terms even for non-prescription products", async (t) => {
  const api = setup(t);
  const products = await api.get("/api/products?prescription=otc").expect(200);
  const cart = await api.post("/api/carts").expect(201);
  const cartId = cart.body.data.id;

  await api
    .post(`/api/carts/${cartId}/items`)
    .send({ productId: products.body.data[0].id, quantity: 1 })
    .expect(201);

  const response = await api
    .post("/api/orders")
    .send({
      cartId,
      customer: customerDetails(),
      consents: { privacy: true, terms: false }
    })
    .expect(400);

  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("staff routes require an authenticated session and a CSRF token", async (t) => {
  const agent = setupAgent(t);

  const unauthenticated = await agent.get("/api/staff/orders").expect(401);
  assert.equal(unauthenticated.body.error.code, "STAFF_AUTH_REQUIRED");

  await agent
    .post("/api/staff/auth/login")
    .send({ email: demoStaffEmail, password: "wrong-password" })
    .expect(401);

  const login = await agent
    .post("/api/staff/auth/login")
    .send({ email: demoStaffEmail, password: defaultDemoStaffPassword })
    .expect(200);
  assert.equal(login.body.data.staff.role, "pharmacist");
  assert.ok(login.body.data.csrfToken);
  assert.match(login.headers["set-cookie"][0], /HttpOnly/);

  const me = await agent.get("/api/staff/auth/me").expect(200);
  const csrfToken = me.body.data.csrfToken;
  assert.ok(csrfToken);

  await agent.post("/api/staff/auth/logout").expect(403);
  await agent.post("/api/staff/auth/logout").set("X-CSRF-Token", csrfToken).expect(204);
  await agent.get("/api/staff/orders").expect(401);
});

test("a pharmacist decision is auditable and cannot skip CSRF", async (t) => {
  const agent = setupAgent(t);
  const products = await agent.get("/api/products?prescription=required").expect(200);
  const cart = await agent.post("/api/carts").expect(201);
  const cartId = cart.body.data.id;

  await agent
    .post(`/api/carts/${cartId}/items`)
    .send({ productId: products.body.data[0].id, quantity: 1 })
    .expect(201);

  const submitted = await agent
    .post("/api/orders")
    .send({
      cartId,
      customer: customerDetails(),
      prescription: { reference: "DEMO-RX-STAFF-001", consentToReview: true },
      consents: { privacy: true, terms: true }
    })
    .expect(201);

  const login = await agent
    .post("/api/staff/auth/login")
    .send({ email: demoStaffEmail, password: defaultDemoStaffPassword })
    .expect(200);
  const reference = submitted.body.data.reference;

  await agent
    .post(`/api/staff/orders/${reference}/decision`)
    .send({
      decision: "approve",
      note: "Demo review note confirms a controlled test decision.",
      acknowledgement: true
    })
    .expect(403);

  const approved = await agent
    .post(`/api/staff/orders/${reference}/decision`)
    .set("X-CSRF-Token", login.body.data.csrfToken)
    .send({
      decision: "approve",
      note: "Demo review note confirms a controlled test decision.",
      acknowledgement: true
    })
    .expect(200);

  assert.equal(approved.body.data.status, "approved_for_payment");
  assert.equal(approved.body.data.review.acknowledged, true);
  assert.equal(approved.body.data.review.reviewer.name, "Demo Pharmacist");
  assert.ok(
    approved.body.data.audit.some(
      (entry) => entry.eventType === "order.review_approved_for_payment"
    )
  );

  const secondDecision = await agent
    .post(`/api/staff/orders/${reference}/decision`)
    .set("X-CSRF-Token", login.body.data.csrfToken)
    .send({
      decision: "reject",
      note: "A second controlled test decision should be blocked.",
      acknowledgement: true
    })
    .expect(409);
  assert.equal(secondDecision.body.error.code, "ORDER_ALREADY_REVIEWED");
});
