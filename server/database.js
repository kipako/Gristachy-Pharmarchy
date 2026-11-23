import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDemoStaffPassword, demoStaffEmail, hashPassword } from "./auth.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
export const defaultDatabaseFile = path.join(projectDirectory, "data", "pharmarchy.sqlite");

const schema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS catalog_imports (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('upsert', 'replace')),
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    publication_status TEXT NOT NULL CHECK (publication_status IN ('demo', 'approved')),
    contains_prescription INTEGER NOT NULL DEFAULT 0 CHECK (contains_prescription IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    price_tzs INTEGER NOT NULL CHECK (price_tzs >= 0),
    stock_qty INTEGER NOT NULL CHECK (stock_qty >= 0),
    requires_prescription INTEGER NOT NULL DEFAULT 0 CHECK (requires_prescription IN (0, 1)),
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    catalog_import_id TEXT,
    publication_status TEXT NOT NULL DEFAULT 'demo' CHECK (publication_status IN ('demo', 'approved')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'abandoned')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (cart_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('pharmacist', 'admin')),
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS staff_sessions (
    id TEXT PRIMARY KEY,
    staff_user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id),
    status TEXT NOT NULL CHECK (status IN ('pending_pharmacist_review', 'rejected', 'approved_for_payment', 'cancelled')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL,
    region TEXT NOT NULL,
    contains_prescription INTEGER NOT NULL DEFAULT 0 CHECK (contains_prescription IN (0, 1)),
    prescription_reference TEXT,
    prescription_review_consent INTEGER NOT NULL DEFAULT 0 CHECK (prescription_review_consent IN (0, 1)),
    privacy_consent INTEGER NOT NULL CHECK (privacy_consent IN (0, 1)),
    terms_consent INTEGER NOT NULL CHECK (terms_consent IN (0, 1)),
    subtotal_tzs INTEGER NOT NULL CHECK (subtotal_tzs >= 0),
    reviewed_by TEXT REFERENCES staff_users(id),
    reviewed_at TEXT,
    review_note TEXT,
    review_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (review_acknowledged IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    unit_price_tzs INTEGER NOT NULL CHECK (unit_price_tzs >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    requires_prescription INTEGER NOT NULL DEFAULT 0 CHECK (requires_prescription IN (0, 1))
  );

  CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(active, category_id);
  CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_staff_sessions_token ON staff_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_staff_sessions_expiry ON staff_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at);
`;

const categories = [
  {
    name: "Pain relief",
    slug: "pain-relief",
    description:
      "Illustrative non-prescription products for local development only. Product listings are not medical advice."
  },
  {
    name: "Wellness & vitamins",
    slug: "wellness-vitamins",
    description:
      "Illustrative wellness products for local development only. Product listings are not medical advice."
  },
  {
    name: "First aid & devices",
    slug: "first-aid-devices",
    description: "Illustrative first-aid supplies and devices for local development only."
  },
  {
    name: "Prescription review",
    slug: "prescription-review",
    description:
      "Illustrative prescription-review entries for local development only. No dispensing occurs in this demo."
  }
];

const products = [
  {
    categorySlug: "pain-relief",
    sku: "DEMO-PAR-500-20",
    name: "Paracetamol 500 mg tablets",
    slug: "paracetamol-500mg-tablets",
    description:
      "Illustrative development catalogue entry for a 20-tablet pack. This listing is not medical advice or a confirmation of availability.",
    priceTzs: 3500,
    stockQty: 42,
    requiresPrescription: false,
    featured: true
  },
  {
    categorySlug: "wellness-vitamins",
    sku: "DEMO-VITC-1000-30",
    name: "Vitamin C 1000 mg",
    slug: "vitamin-c-1000mg",
    description:
      "Illustrative development catalogue entry for a 30-tablet pack. This listing is not medical advice or a confirmation of availability.",
    priceTzs: 12000,
    stockQty: 31,
    requiresPrescription: false,
    featured: true
  },
  {
    categorySlug: "first-aid-devices",
    sku: "DEMO-ORS-10",
    name: "Oral rehydration salts",
    slug: "oral-rehydration-salts",
    description:
      "Illustrative development catalogue entry for 10 sachets. This listing is not medical advice or a confirmation of availability.",
    priceTzs: 1800,
    stockQty: 68,
    requiresPrescription: false,
    featured: true
  },
  {
    categorySlug: "first-aid-devices",
    sku: "DEMO-THERMO-DIGITAL",
    name: "Digital thermometer",
    slug: "digital-thermometer",
    description:
      "Illustrative development catalogue entry for a digital thermometer. This listing is not medical advice or a confirmation of availability.",
    priceTzs: 18500,
    stockQty: 14,
    requiresPrescription: false,
    featured: true
  },
  {
    categorySlug: "first-aid-devices",
    sku: "DEMO-WIPES-20",
    name: "Antiseptic wipes",
    slug: "antiseptic-wipes",
    description:
      "Illustrative development catalogue entry for 20 wipes. This listing is not medical advice or a confirmation of availability.",
    priceTzs: 6500,
    stockQty: 45,
    requiresPrescription: false,
    featured: false
  },
  {
    categorySlug: "prescription-review",
    sku: "DEMO-AMOX-500-21",
    name: "Amoxicillin 500 mg",
    slug: "amoxicillin-500mg",
    description:
      "Illustrative prescription-review development entry. A valid prescription and authorised pharmacist review would be required before any real-world process. This demo does not verify or dispense it.",
    priceTzs: 14000,
    stockQty: 18,
    requiresPrescription: true,
    featured: true
  },
  {
    categorySlug: "prescription-review",
    sku: "DEMO-METF-500-30",
    name: "Metformin 500 mg",
    slug: "metformin-500mg",
    description:
      "Illustrative prescription-review development entry. A valid prescription and authorised pharmacist review would be required before any real-world process. This demo does not verify or dispense it.",
    priceTzs: 8000,
    stockQty: 22,
    requiresPrescription: true,
    featured: false
  }
];

function seedCatalog(db) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM categories").get();
  if (existing.count > 0) return;

  const insertCategory = db.prepare(
    "INSERT INTO categories (name, slug, description) VALUES (@name, @slug, @description)"
  );
  const insertProduct = db.prepare(`
    INSERT INTO products (
      category_id, sku, name, slug, description, price_tzs, stock_qty, requires_prescription, featured
    ) VALUES (
      @categoryId, @sku, @name, @slug, @description, @priceTzs, @stockQty, @requiresPrescription, @featured
    )
  `);

  const seed = db.transaction(() => {
    for (const category of categories) insertCategory.run(category);
    const categoryBySlug = new Map(
      db
        .prepare("SELECT id, slug FROM categories")
        .all()
        .map((category) => [category.slug, category.id])
    );
    for (const product of products) {
      insertProduct.run({
        ...product,
        categoryId: categoryBySlug.get(product.categorySlug),
        requiresPrescription: product.requiresPrescription ? 1 : 0,
        featured: product.featured ? 1 : 0
      });
    }
  });

  seed();
}

function seedDemoStaff(db, demoStaffPassword) {
  if (process.env.NODE_ENV === "production") {
    const demoUsers = db
      .prepare("SELECT id FROM staff_users WHERE lower(email) = lower(?)")
      .all(demoStaffEmail);
    if (demoUsers.length > 0) {
      const deactivate = db.prepare("UPDATE staff_users SET active = 0 WHERE id = ?");
      const endSessions = db.prepare("DELETE FROM staff_sessions WHERE staff_user_id = ?");
      const disable = db.transaction(() => {
        for (const user of demoUsers) {
          deactivate.run(user.id);
          endSessions.run(user.id);
        }
      });
      disable();
    }
    return;
  }
  if (!demoStaffPassword) return;
  const existing = db.prepare("SELECT id FROM staff_users WHERE email = ?").get(demoStaffEmail);
  if (existing) return;

  db.prepare(
    `
    INSERT INTO staff_users (id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(
    "demo-pharmacist-user",
    demoStaffEmail,
    "Demo Pharmacist",
    "pharmacist",
    hashPassword(demoStaffPassword)
  );
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runMigrations(db) {
  addColumnIfMissing(db, "products", "catalog_import_id", "TEXT");
  addColumnIfMissing(
    db,
    "products",
    "publication_status",
    "TEXT NOT NULL DEFAULT 'demo' CHECK (publication_status IN ('demo', 'approved'))"
  );
  addColumnIfMissing(db, "orders", "reviewed_by", "TEXT REFERENCES staff_users(id)");
  addColumnIfMissing(db, "orders", "reviewed_at", "TEXT");
  addColumnIfMissing(db, "orders", "review_note", "TEXT");
  addColumnIfMissing(
    db,
    "orders",
    "review_acknowledged",
    "INTEGER NOT NULL DEFAULT 0 CHECK (review_acknowledged IN (0, 1))"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_products_catalog_import ON products(catalog_import_id)");
}

export function createDatabase({
  filename = defaultDatabaseFile,
  demoStaffPassword = process.env.DEMO_STAFF_PASSWORD ?? defaultDemoStaffPassword
} = {}) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  runMigrations(db);
  if (process.env.NODE_ENV !== "production") seedCatalog(db);
  seedDemoStaff(db, demoStaffPassword);
  return db;
}
