import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, validationError } from "./errors.js";
import {
  cartIdSchema,
  cartItemSchema,
  orderReferenceSchema,
  orderSchema,
  productQuerySchema,
  reviewDecisionSchema,
  staffLoginSchema,
  staffOrderQuerySchema,
  updateCartItemSchema
} from "./schemas.js";
import {
  addCartItem,
  createCart,
  getCart,
  getProductBySlug,
  listCategories,
  listProducts,
  removeCartItem,
  submitOrderForReview,
  updateCartItem
} from "./store.js";
import { loadStorefrontConfig, publicStorefrontConfig } from "./storefront.js";
import {
  authenticateStaff,
  csrfTokenIsValid,
  decideOrderReview,
  endStaffSession,
  getStaffOrder,
  getStaffSession,
  listStaffOrders,
  rotateSessionCsrfToken,
  staffOrderSummary
} from "./staff-store.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultPublicDirectory = path.resolve(serverDirectory, "../public");

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "request",
        message: issue.message
      }))
    );
  }
  return result.data;
}

function productIdFromParam(value) {
  const productId = Number(value);
  if (!Number.isSafeInteger(productId) || productId < 1) {
    throw new AppError(400, "VALIDATION_ERROR", "Choose a valid product.");
  }
  return productId;
}

function cartIdFromParam(value) {
  return parse(cartIdSchema, value);
}

function slugFromParam(value) {
  if (!/^[a-z0-9-]{1,120}$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Choose a valid product.");
  }
  return value;
}

const staffSessionCookieName = "pharmarchy_staff_session";
const staffSessionLifetimeMs = 8 * 60 * 60 * 1000;

function cookieValue(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const entry of header.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function setStaffSessionCookie(response, token) {
  response.cookie(staffSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: staffSessionLifetimeMs,
    path: "/"
  });
}

function clearStaffSessionCookie(response) {
  response.clearCookie(staffSessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

function requireStaffSession(request, _response, next) {
  if (!request.staffSession) {
    next(
      new AppError(
        401,
        "STAFF_AUTH_REQUIRED",
        "Sign in with an authorised staff account to continue."
      )
    );
    return;
  }
  next();
}

function requirePharmacistRole(request, _response, next) {
  if (!request.staffSession) {
    next(
      new AppError(
        401,
        "STAFF_AUTH_REQUIRED",
        "Sign in with an authorised staff account to continue."
      )
    );
    return;
  }
  if (!["pharmacist", "admin"].includes(request.staffSession.role)) {
    next(
      new AppError(403, "STAFF_ROLE_FORBIDDEN", "A pharmacist or administrator role is required.")
    );
    return;
  }
  next();
}

function requireStaffCsrf(request, _response, next) {
  if (!request.staffSession) {
    next(
      new AppError(
        401,
        "STAFF_AUTH_REQUIRED",
        "Sign in with an authorised staff account to continue."
      )
    );
    return;
  }
  if (!csrfTokenIsValid(request.staffSession, request.get("X-CSRF-Token"))) {
    next(
      new AppError(
        403,
        "CSRF_TOKEN_INVALID",
        "Your staff session security token is missing or has expired. Refresh and try again."
      )
    );
    return;
  }
  next();
}

const orderRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: "ORDER_RATE_LIMITED",
        message: "Too many order-review requests. Please wait before trying again."
      }
    });
  }
});

const staffLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: "STAFF_LOGIN_RATE_LIMITED",
        message: "Too many sign-in attempts. Please wait before trying again."
      }
    });
  }
});

export function createApp({
  db,
  storefront = loadStorefrontConfig(),
  publicDirectory = defaultPublicDirectory
} = {}) {
  if (!db) throw new Error("A database connection is required to create the application.");

  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          upgradeInsecureRequests: null
        }
      },
      referrerPolicy: { policy: "no-referrer" }
    })
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/staff", (request, _response, next) => {
    request.staffSession = getStaffSession(db, cookieValue(request, staffSessionCookieName));
    next();
  });

  app.get("/api/storefront", (_request, response) => {
    response.json({ data: publicStorefrontConfig(storefront) });
  });

  app.get("/api/health", (_request, response) => {
    db.prepare("SELECT 1").get();
    response.json({ data: { status: "ok", storefront: storefront.brand.displayName } });
  });

  app.get("/api/categories", (_request, response) => {
    response.json({ data: listCategories(db) });
  });

  app.get("/api/products", (request, response) => {
    const filters = parse(productQuerySchema, request.query);
    const products = listProducts(db, filters);
    response.json({ data: products, meta: { count: products.length, filters } });
  });

  app.get("/api/products/:slug", (request, response) => {
    const product = getProductBySlug(db, slugFromParam(request.params.slug));
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "This product is not available.");
    response.json({ data: product });
  });

  app.post("/api/carts", (_request, response) => {
    response.status(201).json({ data: createCart(db) });
  });

  app.get("/api/carts/:cartId", (request, response) => {
    const cart = getCart(db, cartIdFromParam(request.params.cartId));
    if (!cart) throw new AppError(404, "CART_NOT_FOUND", "This cart could not be found.");
    response.json({ data: cart });
  });

  app.post("/api/carts/:cartId/items", (request, response) => {
    const cart = addCartItem(
      db,
      cartIdFromParam(request.params.cartId),
      parse(cartItemSchema, request.body)
    );
    response.status(201).json({ data: cart });
  });

  app.patch("/api/carts/:cartId/items/:productId", (request, response) => {
    const cart = updateCartItem(
      db,
      cartIdFromParam(request.params.cartId),
      productIdFromParam(request.params.productId),
      parse(updateCartItemSchema, request.body)
    );
    response.json({ data: cart });
  });

  app.delete("/api/carts/:cartId/items/:productId", (request, response) => {
    const cart = removeCartItem(
      db,
      cartIdFromParam(request.params.cartId),
      productIdFromParam(request.params.productId)
    );
    response.json({ data: cart });
  });

  app.post("/api/orders", orderRateLimiter, (request, response) => {
    const order = submitOrderForReview(db, parse(orderSchema, request.body));
    response.status(201).json({ data: order });
  });

  app.post("/api/staff/auth/login", staffLoginRateLimiter, (request, response) => {
    const session = authenticateStaff(db, parse(staffLoginSchema, request.body));
    setStaffSessionCookie(response, session.sessionToken);
    response.json({
      data: {
        staff: session.staff,
        csrfToken: session.csrfToken,
        expiresInSeconds: staffSessionLifetimeMs / 1000
      }
    });
  });

  app.get("/api/staff/auth/me", requireStaffSession, (request, response) => {
    const csrfToken = rotateSessionCsrfToken(db, request.staffSession);
    response.json({
      data: {
        staff: {
          id: request.staffSession.id,
          email: request.staffSession.email,
          displayName: request.staffSession.displayName,
          role: request.staffSession.role
        },
        csrfToken,
        expiresAt: request.staffSession.expiresAt
      }
    });
  });

  app.post("/api/staff/auth/logout", requireStaffSession, requireStaffCsrf, (request, response) => {
    endStaffSession(db, request.staffSession);
    clearStaffSessionCookie(response);
    response.status(204).end();
  });

  app.get("/api/staff/orders/summary", requirePharmacistRole, (_request, response) => {
    response.json({ data: staffOrderSummary(db) });
  });

  app.get("/api/staff/orders", requirePharmacistRole, (request, response) => {
    const filters = parse(staffOrderQuerySchema, request.query);
    response.json({ data: listStaffOrders(db, filters) });
  });

  app.get("/api/staff/orders/:reference", requirePharmacistRole, (request, response) => {
    response.json({
      data: getStaffOrder(db, parse(orderReferenceSchema, request.params.reference))
    });
  });

  app.post(
    "/api/staff/orders/:reference/decision",
    requirePharmacistRole,
    requireStaffCsrf,
    (request, response) => {
      const order = decideOrderReview(
        db,
        request.staffSession,
        parse(orderReferenceSchema, request.params.reference),
        parse(reviewDecisionSchema, request.body)
      );
      response.json({ data: order });
    }
  );

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: { code: "API_NOT_FOUND", message: "That API endpoint does not exist." }
    });
  });

  app.use(
    express.static(publicDirectory, {
      etag: true,
      index: "index.html",
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
    })
  );

  app.use((request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "The requested resource was not found." }
    });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof AppError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      });
      return;
    }

    if (error.type === "entity.parse.failed") {
      response.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body must be valid JSON." }
      });
      return;
    }

    console.error("Unexpected application error", error);
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }
    });
  });

  return app;
}
