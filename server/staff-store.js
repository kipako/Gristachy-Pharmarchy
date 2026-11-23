import { randomUUID } from "node:crypto";
import { recordAuditEvent, listAuditEvents } from "./audit.js";
import {
  createOpaqueToken,
  demoStaffEmail,
  hashOpaqueToken,
  safeEqualText,
  verifyPassword
} from "./auth.js";
import { AppError } from "./errors.js";

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const reviewableStatuses = new Set([
  "pending_pharmacist_review",
  "approved_for_payment",
  "rejected",
  "cancelled",
  "all"
]);

function toStaff(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role
  };
}

function toOrderListItem(row) {
  return {
    reference: row.reference,
    status: row.status,
    customerName: `${row.first_name} ${row.last_name}`,
    containsPrescription: Boolean(row.contains_prescription),
    itemCount: row.item_count,
    subtotalTzs: row.subtotal_tzs,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewer_name || null
  };
}

function expirationTimestamp() {
  return Date.now() + sessionLifetimeMs;
}

function isBlockedDemoStaffAccount(user) {
  return (
    process.env.NODE_ENV === "production" &&
    String(user.email).trim().toLowerCase() === demoStaffEmail.toLowerCase()
  );
}

export function authenticateStaff(db, { email, password }) {
  const user = db
    .prepare(
      `
      SELECT id, email, display_name, role, password_hash, active
      FROM staff_users
      WHERE lower(email) = lower(?)
    `
    )
    .get(email);

  if (
    !user ||
    !user.active ||
    isBlockedDemoStaffAccount(user) ||
    !verifyPassword(password, user.password_hash)
  ) {
    throw new AppError(401, "INVALID_STAFF_CREDENTIALS", "Email or password is not recognised.");
  }

  db.prepare("DELETE FROM staff_sessions WHERE expires_at <= ?").run(Date.now());
  const sessionId = randomUUID();
  const sessionToken = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  db.prepare(
    `
    INSERT INTO staff_sessions (id, staff_user_id, token_hash, csrf_token_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(
    sessionId,
    user.id,
    hashOpaqueToken(sessionToken),
    hashOpaqueToken(csrfToken),
    expirationTimestamp()
  );

  recordAuditEvent(db, {
    actorId: user.id,
    eventType: "staff.session_created",
    entityType: "staff_session",
    entityId: sessionId,
    metadata: { role: user.role }
  });

  return { staff: toStaff(user), sessionToken, csrfToken };
}

export function getStaffSession(db, rawToken) {
  if (!rawToken) return null;
  const session = db
    .prepare(
      `
      SELECT ss.id AS session_id, ss.csrf_token_hash, ss.expires_at,
             s.id, s.email, s.display_name, s.role, s.active
      FROM staff_sessions ss
      INNER JOIN staff_users s ON s.id = ss.staff_user_id
      WHERE ss.token_hash = ? AND ss.expires_at > ?
    `
    )
    .get(hashOpaqueToken(rawToken), Date.now());

  if (!session || !session.active || isBlockedDemoStaffAccount(session)) return null;
  db.prepare("UPDATE staff_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    session.session_id
  );
  return {
    id: session.id,
    email: session.email,
    displayName: session.display_name,
    role: session.role,
    sessionId: session.session_id,
    csrfTokenHash: session.csrf_token_hash,
    expiresAt: session.expires_at
  };
}

export function rotateSessionCsrfToken(db, session) {
  const csrfToken = createOpaqueToken();
  const csrfTokenHash = hashOpaqueToken(csrfToken);
  db.prepare(
    "UPDATE staff_sessions SET csrf_token_hash = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(csrfTokenHash, session.sessionId);
  session.csrfTokenHash = csrfTokenHash;
  return csrfToken;
}

export function csrfTokenIsValid(session, token) {
  return Boolean(token) && safeEqualText(hashOpaqueToken(token), session.csrfTokenHash);
}

export function endStaffSession(db, session) {
  db.prepare("DELETE FROM staff_sessions WHERE id = ?").run(session.sessionId);
  recordAuditEvent(db, {
    actorId: session.id,
    eventType: "staff.session_ended",
    entityType: "staff_session",
    entityId: session.sessionId,
    metadata: { role: session.role }
  });
}

export function staffOrderSummary(db) {
  const counts = {
    pendingPharmacistReview: 0,
    approvedForPayment: 0,
    rejected: 0,
    cancelled: 0,
    total: 0
  };
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM orders GROUP BY status").all();
  for (const row of rows) {
    counts.total += row.count;
    if (row.status === "pending_pharmacist_review") counts.pendingPharmacistReview = row.count;
    if (row.status === "approved_for_payment") counts.approvedForPayment = row.count;
    if (row.status === "rejected") counts.rejected = row.count;
    if (row.status === "cancelled") counts.cancelled = row.count;
  }
  return counts;
}

export function listStaffOrders(db, { status = "pending_pharmacist_review" } = {}) {
  if (!reviewableStatuses.has(status)) {
    throw new AppError(400, "VALIDATION_ERROR", "Choose a valid review status.");
  }
  const clause = status === "all" ? "" : "WHERE o.status = ?";
  const params = status === "all" ? [] : [status];
  return db
    .prepare(
      `
      SELECT o.reference, o.status, o.first_name, o.last_name, o.contains_prescription,
             o.subtotal_tzs, o.created_at, o.reviewed_at,
             COUNT(oi.id) AS item_count, reviewer.display_name AS reviewer_name
      FROM orders o
      INNER JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN staff_users reviewer ON reviewer.id = o.reviewed_by
      ${clause}
      GROUP BY o.id
      ORDER BY
        CASE o.status WHEN 'pending_pharmacist_review' THEN 0 ELSE 1 END,
        o.created_at ASC
    `
    )
    .all(...params)
    .map(toOrderListItem);
}

export function getStaffOrder(db, reference) {
  const order = db
    .prepare(
      `
      SELECT o.*, reviewer.display_name AS reviewer_name, reviewer.role AS reviewer_role
      FROM orders o
      LEFT JOIN staff_users reviewer ON reviewer.id = o.reviewed_by
      WHERE o.reference = ?
    `
    )
    .get(reference);
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "This review request could not be found.");

  const items = db
    .prepare(
      `
      SELECT product_id, product_name, sku, unit_price_tzs, quantity, requires_prescription
      FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `
    )
    .all(order.id)
    .map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      unitPriceTzs: item.unit_price_tzs,
      quantity: item.quantity,
      requiresPrescription: Boolean(item.requires_prescription),
      lineTotalTzs: item.unit_price_tzs * item.quantity
    }));

  return {
    reference: order.reference,
    status: order.status,
    customer: {
      firstName: order.first_name,
      lastName: order.last_name,
      email: order.email,
      phone: order.phone,
      addressLine1: order.address_line1,
      addressLine2: order.address_line2,
      district: order.district,
      region: order.region
    },
    prescription: {
      required: Boolean(order.contains_prescription),
      reference: order.prescription_reference,
      reviewConsent: Boolean(order.prescription_review_consent)
    },
    subtotalTzs: order.subtotal_tzs,
    items,
    createdAt: order.created_at,
    review: order.reviewed_at
      ? {
          reviewedAt: order.reviewed_at,
          note: order.review_note,
          acknowledged: Boolean(order.review_acknowledged),
          reviewer: order.reviewer_name
            ? { name: order.reviewer_name, role: order.reviewer_role }
            : null
        }
      : null,
    audit: listAuditEvents(db, { entityType: "order", entityId: order.id })
  };
}

export function decideOrderReview(db, actor, reference, { decision, note, acknowledgement }) {
  const transaction = db.transaction(() => {
    const order = db
      .prepare("SELECT id, status, contains_prescription FROM orders WHERE reference = ?")
      .get(reference);
    if (!order)
      throw new AppError(404, "ORDER_NOT_FOUND", "This review request could not be found.");
    if (order.status !== "pending_pharmacist_review") {
      throw new AppError(
        409,
        "ORDER_ALREADY_REVIEWED",
        "This request has already received a review decision."
      );
    }
    if (!acknowledgement) {
      throw new AppError(
        422,
        "REVIEW_ACKNOWLEDGEMENT_REQUIRED",
        "You must acknowledge the review boundary before recording a decision."
      );
    }

    const nextStatus = decision === "approve" ? "approved_for_payment" : "rejected";
    db.prepare(
      `
      UPDATE orders
      SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
          review_note = ?, review_acknowledged = 1
      WHERE id = ?
    `
    ).run(nextStatus, actor.id, note, order.id);

    recordAuditEvent(db, {
      actorId: actor.id,
      eventType:
        decision === "approve" ? "order.review_approved_for_payment" : "order.review_rejected",
      entityType: "order",
      entityId: order.id,
      metadata: {
        fromStatus: order.status,
        toStatus: nextStatus,
        containsPrescription: Boolean(order.contains_prescription)
      }
    });

    return getStaffOrder(db, reference);
  });
  return transaction();
}
