import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "./audit.js";
import { AppError } from "./errors.js";

const productSelect = `
  SELECT
    p.id, p.sku, p.name, p.slug, p.description, p.price_tzs, p.stock_qty,
    p.requires_prescription, p.featured, p.active, p.publication_status,
    c.name AS category_name, c.slug AS category_slug
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
`;

function toProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceTzs: row.price_tzs,
    stockQty: row.stock_qty,
    requiresPrescription: Boolean(row.requires_prescription),
    featured: Boolean(row.featured),
    publicationStatus: row.publication_status,
    category: {
      name: row.category_name,
      slug: row.category_slug
    }
  };
}

function toCartItem(row) {
  return {
    productId: row.product_id,
    quantity: row.quantity,
    product: {
      id: row.product_id,
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      description: row.description,
      priceTzs: row.price_tzs,
      stockQty: row.stock_qty,
      requiresPrescription: Boolean(row.requires_prescription),
      publicationStatus: row.publication_status,
      category: {
        name: row.category_name,
        slug: row.category_slug
      }
    },
    lineTotalTzs: row.price_tzs * row.quantity
  };
}

function getCartRecord(db, cartId) {
  return db
    .prepare("SELECT id, status, created_at, updated_at FROM carts WHERE id = ?")
    .get(cartId);
}

function requireActiveCart(db, cartId) {
  const cart = getCartRecord(db, cartId);
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", "This cart could not be found.");
  if (cart.status !== "active") {
    throw new AppError(409, "CART_NOT_ACTIVE", "This cart is no longer available for changes.");
  }
  return cart;
}

function publicProductClause() {
  return process.env.NODE_ENV === "production" ? "p.publication_status = 'approved'" : "1 = 1";
}

function getActiveProduct(db, productId) {
  const row = db
    .prepare(`${productSelect} WHERE p.id = ? AND p.active = 1 AND ${publicProductClause()}`)
    .get(productId);
  if (!row) throw new AppError(404, "PRODUCT_NOT_FOUND", "This product is not available.");
  return row;
}

function touchCart(db, cartId) {
  db.prepare("UPDATE carts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(cartId);
}

function orderReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const token = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `PHM-${date}-${token}`;
}

export function listCategories(db) {
  return db
    .prepare(
      `
      SELECT c.id, c.name, c.slug, c.description
      FROM categories c
      WHERE EXISTS (
        SELECT 1 FROM products p
        WHERE p.category_id = c.id AND p.active = 1 AND ${publicProductClause()}
      )
      ORDER BY c.name
    `
    )
    .all()
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description
    }));
}

export function listProducts(db, { q = "", category, prescription = "all" } = {}) {
  const clauses = ["p.active = 1", publicProductClause()];
  const params = [];

  if (q) {
    const wildcard = `%${q}%`;
    clauses.push(
      "(p.name LIKE ? COLLATE NOCASE OR p.description LIKE ? COLLATE NOCASE OR p.sku LIKE ? COLLATE NOCASE)"
    );
    params.push(wildcard, wildcard, wildcard);
  }
  if (category) {
    clauses.push("c.slug = ?");
    params.push(category);
  }
  if (prescription === "otc") clauses.push("p.requires_prescription = 0");
  if (prescription === "required") clauses.push("p.requires_prescription = 1");

  const rows = db
    .prepare(`${productSelect} WHERE ${clauses.join(" AND ")} ORDER BY p.featured DESC, p.name ASC`)
    .all(...params);
  return rows.map(toProduct);
}

export function getProductBySlug(db, slug) {
  return toProduct(
    db
      .prepare(`${productSelect} WHERE p.slug = ? AND p.active = 1 AND ${publicProductClause()}`)
      .get(slug)
  );
}

export function createCart(db) {
  const id = randomUUID();
  db.prepare("INSERT INTO carts (id) VALUES (?)").run(id);
  return getCart(db, id);
}

export function getCart(db, cartId) {
  const cart = getCartRecord(db, cartId);
  if (!cart) return null;

  const items = db
    .prepare(
      `
      SELECT
        ci.product_id, ci.quantity,
        p.sku, p.name, p.slug, p.description, p.price_tzs, p.stock_qty, p.requires_prescription, p.publication_status,
        c.name AS category_name, c.slug AS category_slug
      FROM cart_items ci
      INNER JOIN products p ON p.id = ci.product_id
      INNER JOIN categories c ON c.id = p.category_id
      WHERE ci.cart_id = ? AND ${publicProductClause()}
      ORDER BY p.name ASC
    `
    )
    .all(cartId)
    .map(toCartItem);

  const subtotalTzs = items.reduce((sum, item) => sum + item.lineTotalTzs, 0);
  return {
    id: cart.id,
    status: cart.status,
    createdAt: cart.created_at,
    updatedAt: cart.updated_at,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalTzs,
    requiresPrescription: items.some((item) => item.product.requiresPrescription)
  };
}

export function addCartItem(db, cartId, { productId, quantity }) {
  const operation = db.transaction(() => {
    requireActiveCart(db, cartId);
    const product = getActiveProduct(db, productId);
    const current = db
      .prepare("SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?")
      .get(cartId, productId);
    const totalQuantity = (current?.quantity ?? 0) + quantity;

    if (totalQuantity > product.stock_qty) {
      throw new AppError(
        409,
        "STOCK_LIMIT",
        `Only ${product.stock_qty} unit(s) of ${product.name} are available in this demo inventory.`
      );
    }

    db.prepare(
      `
      INSERT INTO cart_items (cart_id, product_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity
    `
    ).run(cartId, productId, totalQuantity);
    touchCart(db, cartId);
    return getCart(db, cartId);
  });
  return operation();
}

export function updateCartItem(db, cartId, productId, { quantity }) {
  const operation = db.transaction(() => {
    requireActiveCart(db, cartId);
    const product = getActiveProduct(db, productId);
    const existing = db
      .prepare("SELECT 1 FROM cart_items WHERE cart_id = ? AND product_id = ?")
      .get(cartId, productId);
    if (!existing) throw new AppError(404, "CART_ITEM_NOT_FOUND", "This item is not in the cart.");
    if (quantity > product.stock_qty) {
      throw new AppError(
        409,
        "STOCK_LIMIT",
        `Only ${product.stock_qty} unit(s) of ${product.name} are available in this demo inventory.`
      );
    }

    db.prepare("UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?").run(
      quantity,
      cartId,
      productId
    );
    touchCart(db, cartId);
    return getCart(db, cartId);
  });
  return operation();
}

export function removeCartItem(db, cartId, productId) {
  const operation = db.transaction(() => {
    requireActiveCart(db, cartId);
    const result = db
      .prepare("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?")
      .run(cartId, productId);
    if (result.changes === 0)
      throw new AppError(404, "CART_ITEM_NOT_FOUND", "This item is not in the cart.");
    touchCart(db, cartId);
    return getCart(db, cartId);
  });
  return operation();
}

export function submitOrderForReview(db, payload) {
  const operation = db.transaction(() => {
    requireActiveCart(db, payload.cartId);
    const cart = getCart(db, payload.cartId);
    if (cart.items.length === 0) {
      throw new AppError(
        400,
        "EMPTY_CART",
        "Add at least one product before submitting a review request."
      );
    }

    for (const item of cart.items) {
      const available = getActiveProduct(db, item.productId);
      if (item.quantity > available.stock_qty) {
        throw new AppError(
          409,
          "STOCK_LIMIT",
          `${item.product.name} no longer has the requested demo inventory available.`
        );
      }
    }

    if (cart.requiresPrescription && !payload.prescription.reference) {
      throw new AppError(
        422,
        "PRESCRIPTION_REFERENCE_REQUIRED",
        "A prescription reference is required for prescription-only items."
      );
    }
    if (cart.requiresPrescription && !payload.prescription.consentToReview) {
      throw new AppError(
        422,
        "PRESCRIPTION_REVIEW_CONSENT_REQUIRED",
        "Consent for pharmacist prescription review is required."
      );
    }

    const id = randomUUID();
    const reference = orderReference();
    const status = "pending_pharmacist_review";
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, reference, cart_id, status, first_name, last_name, email, phone,
        address_line1, address_line2, district, region,
        contains_prescription, prescription_reference, prescription_review_consent,
        privacy_consent, terms_consent, subtotal_tzs
      ) VALUES (
        @id, @reference, @cartId, @status, @firstName, @lastName, @email, @phone,
        @addressLine1, @addressLine2, @district, @region,
        @containsPrescription, @prescriptionReference, @prescriptionReviewConsent,
        @privacyConsent, @termsConsent, @subtotalTzs
      )
    `);
    const insertLine = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, sku, unit_price_tzs, quantity, requires_prescription)
      VALUES (@orderId, @productId, @productName, @sku, @unitPriceTzs, @quantity, @requiresPrescription)
    `);

    insertOrder.run({
      id,
      reference,
      cartId: payload.cartId,
      status,
      firstName: payload.customer.firstName,
      lastName: payload.customer.lastName,
      email: payload.customer.email,
      phone: payload.customer.phone,
      addressLine1: payload.customer.addressLine1,
      addressLine2: payload.customer.addressLine2,
      district: payload.customer.district,
      region: payload.customer.region,
      containsPrescription: cart.requiresPrescription ? 1 : 0,
      prescriptionReference: cart.requiresPrescription ? payload.prescription.reference : null,
      prescriptionReviewConsent:
        cart.requiresPrescription && payload.prescription.consentToReview ? 1 : 0,
      privacyConsent: payload.consents.privacy ? 1 : 0,
      termsConsent: payload.consents.terms ? 1 : 0,
      subtotalTzs: cart.subtotalTzs
    });

    for (const item of cart.items) {
      insertLine.run({
        orderId: id,
        productId: item.product.id,
        productName: item.product.name,
        sku: item.product.sku,
        unitPriceTzs: item.product.priceTzs,
        quantity: item.quantity,
        requiresPrescription: item.product.requiresPrescription ? 1 : 0
      });
    }

    // Inventory is not decremented: this demo does not reserve stock or determine suitability.
    db.prepare(
      "UPDATE carts SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(payload.cartId);
    recordAuditEvent(db, {
      eventType: "order.submitted_for_review",
      entityType: "order",
      entityId: id,
      metadata: {
        itemCount: cart.itemCount,
        containsPrescription: cart.requiresPrescription,
        status
      }
    });

    return {
      reference,
      status,
      itemCount: cart.itemCount,
      subtotalTzs: cart.subtotalTzs,
      containsPrescription: cart.requiresPrescription,
      message:
        "Your request is awaiting pharmacist review. No payment has been taken and no items have been dispensed."
    };
  });

  return operation();
}
