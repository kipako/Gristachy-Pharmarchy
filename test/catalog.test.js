import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CatalogValidationError, importCatalog, validateCatalogCsv } from "../server/catalog.js";
import { demoStaffEmail } from "../server/auth.js";
import { createDatabase } from "../server/database.js";
import { listProducts } from "../server/store.js";
import { loadStorefrontConfig } from "../server/storefront.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const columns = [
  "sku",
  "name",
  "slug",
  "category_name",
  "category_slug",
  "category_description",
  "description",
  "price_tzs",
  "stock_qty",
  "requires_prescription",
  "featured",
  "active",
  "publication_status"
];

function catalogRow(overrides = {}) {
  return {
    sku: "APP-OTC-001",
    name: "Approved wellness product",
    slug: "approved-wellness-product",
    category_name: "Wellness products",
    category_slug: "wellness-products",
    category_description: "Approved public wellness product category.",
    description: "Approved public product description without clinical or personalised claims.",
    price_tzs: "2500",
    stock_qty: "12",
    requires_prescription: "false",
    featured: "false",
    active: "true",
    publication_status: "approved",
    ...overrides
  };
}

function csv(rows) {
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => row[column]).join(","))].join("\n")}\n`;
}

function setupDatabase(t) {
  const db = createDatabase({ filename: ":memory:" });
  t.after(() => db.close());
  return db;
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gristachy-catalog-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("catalog validation accepts a complete approved row and coerces controlled fields", () => {
  const rows = validateCatalogCsv(csv([catalogRow()]));

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    sku: "APP-OTC-001",
    name: "Approved wellness product",
    slug: "approved-wellness-product",
    categoryName: "Wellness products",
    categorySlug: "wellness-products",
    categoryDescription: "Approved public wellness product category.",
    description: "Approved public product description without clinical or personalised claims.",
    priceTzs: 2500,
    stockQty: 12,
    requiresPrescription: false,
    featured: false,
    active: true,
    publicationStatus: "approved"
  });
});

test("catalog validation reports malformed headers, fields, and duplicate identities", () => {
  assert.throws(
    () => validateCatalogCsv("sku,name\nAPP-OTC-001,Example product\n"),
    (error) => {
      assert.ok(error instanceof CatalogValidationError);
      assert.ok(error.issues.some((issue) => issue.field === "slug"));
      return true;
    }
  );

  assert.throws(
    () => validateCatalogCsv(csv([catalogRow({ requires_prescription: "sometimes" })])),
    (error) => {
      assert.ok(error instanceof CatalogValidationError);
      assert.ok(error.issues.some((issue) => issue.field === "requires_prescription"));
      return true;
    }
  );

  assert.throws(
    () => validateCatalogCsv(csv([catalogRow(), catalogRow({ slug: "another-wellness-product" })])),
    (error) => {
      assert.ok(error instanceof CatalogValidationError);
      assert.ok(error.issues.some((issue) => issue.field === "sku"));
      return true;
    }
  );
});

test("draft catalog rows validate as a template but cannot be imported", (t) => {
  const db = setupDatabase(t);
  const rows = validateCatalogCsv(
    csv([catalogRow({ active: "false", publication_status: "draft" })])
  );

  assert.throws(
    () => importCatalog(db, rows, { sourceName: "template.csv" }),
    (error) => {
      assert.ok(error instanceof CatalogValidationError);
      assert.ok(error.issues.some((issue) => issue.field === "publication_status"));
      return true;
    }
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM catalog_imports").get().count, 0);
});

test("demo catalog rows need an explicit development flag and record an import audit event", (t) => {
  const db = setupDatabase(t);
  const rows = validateCatalogCsv(
    csv([
      catalogRow({
        sku: "DEMO-CATALOG-001",
        slug: "demo-catalog-product",
        publication_status: "demo"
      })
    ])
  );

  assert.throws(
    () => importCatalog(db, rows, { sourceName: "demo.csv" }),
    (error) => {
      assert.ok(error instanceof CatalogValidationError);
      assert.match(error.message, /validation failed/i);
      return true;
    }
  );

  const result = importCatalog(db, rows, {
    sourceName: "/private/work/demo.csv",
    allowDemo: true
  });
  assert.equal(result.sourceName, "demo.csv");
  assert.equal(result.publicationStatus, "demo");
  assert.equal(result.containsPrescription, false);

  const product = db
    .prepare("SELECT sku, active, publication_status FROM products WHERE sku = ?")
    .get("DEMO-CATALOG-001");
  assert.deepEqual(product, {
    sku: "DEMO-CATALOG-001",
    active: 1,
    publication_status: "demo"
  });
  const audit = db
    .prepare("SELECT event_type, entity_type FROM audit_events WHERE entity_id = ?")
    .get(result.importId);
  assert.deepEqual(audit, { event_type: "catalog.imported", entity_type: "catalog_import" });
});

test(
  "demo imports are blocked in production even when the flag is supplied",
  { concurrency: false },
  (t) => {
    const previousNodeEnv = process.env.NODE_ENV;
    const db = setupDatabase(t);
    const rows = validateCatalogCsv(
      csv([
        catalogRow({
          sku: "DEMO-PRODUCTION-001",
          slug: "demo-production-product",
          publication_status: "demo"
        })
      ])
    );

    try {
      process.env.NODE_ENV = "production";
      assert.throws(
        () => importCatalog(db, rows, { sourceName: "demo.csv", allowDemo: true }),
        (error) => {
          assert.ok(error instanceof CatalogValidationError);
          assert.ok(error.issues.some((issue) => issue.field === "allow-demo"));
          return true;
        }
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  }
);

test("approved imports support upsert and replace without deleting historical product records", (t) => {
  const db = setupDatabase(t);
  const initial = validateCatalogCsv(csv([catalogRow()]));

  const firstImport = importCatalog(db, initial, {
    sourceName: "approved-products.csv",
    mode: "replace"
  });
  assert.equal(firstImport.importedCount, 1);
  assert.equal(firstImport.deactivatedCount, 7);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get().count,
    1
  );

  const updated = validateCatalogCsv(csv([catalogRow({ price_tzs: "2750", featured: "true" })]));
  const upsert = importCatalog(db, updated, {
    sourceName: "approved-products-revised.csv",
    mode: "upsert"
  });
  assert.equal(upsert.deactivatedCount, 0);
  assert.deepEqual(
    db.prepare("SELECT price_tzs, featured, active FROM products WHERE sku = ?").get("APP-OTC-001"),
    { price_tzs: 2750, featured: 1, active: 1 }
  );

  const replacement = validateCatalogCsv(
    csv([
      catalogRow({
        sku: "APP-OTC-002",
        name: "Replacement wellness product",
        slug: "replacement-wellness-product"
      })
    ])
  );
  const replace = importCatalog(db, replacement, {
    sourceName: "replacement-products.csv",
    mode: "replace"
  });
  assert.equal(replace.deactivatedCount, 1);
  assert.equal(
    db.prepare("SELECT active FROM products WHERE sku = ?").get("APP-OTC-001").active,
    0
  );
  assert.equal(
    db.prepare("SELECT active FROM products WHERE sku = ?").get("APP-OTC-002").active,
    1
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM catalog_imports").get().count, 3);
});

test("database startup adds catalog columns and indexes to a legacy products table", (t) => {
  const directory = temporaryDirectory(t);
  const filename = path.join(directory, "legacy.sqlite");
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      price_tzs INTEGER NOT NULL,
      stock_qty INTEGER NOT NULL,
      requires_prescription INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacy.close();

  const db = createDatabase({ filename });
  t.after(() => db.close());
  const productColumns = db
    .prepare("PRAGMA table_info(products)")
    .all()
    .map((column) => column.name);
  const indexes = db
    .prepare("PRAGMA index_list(products)")
    .all()
    .map((index) => index.name);

  assert.ok(productColumns.includes("catalog_import_id"));
  assert.ok(productColumns.includes("publication_status"));
  assert.ok(indexes.includes("idx_products_catalog_import"));
  assert.ok(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_imports'")
      .get()
  );
});

test(
  "production startup disables an already-seeded demo account and suppresses demo products",
  { concurrency: false },
  (t) => {
    const previousNodeEnv = process.env.NODE_ENV;
    const directory = temporaryDirectory(t);
    const filename = path.join(directory, "production-guard.sqlite");
    let developmentDb;
    let productionDb;

    try {
      delete process.env.NODE_ENV;
      developmentDb = createDatabase({ filename });
      assert.equal(
        developmentDb.prepare("SELECT active FROM staff_users WHERE email = ?").get(demoStaffEmail)
          .active,
        1
      );
      developmentDb.close();
      developmentDb = null;

      process.env.NODE_ENV = "production";
      productionDb = createDatabase({ filename });
      assert.equal(
        productionDb.prepare("SELECT active FROM staff_users WHERE email = ?").get(demoStaffEmail)
          .active,
        0
      );
      assert.equal(listProducts(productionDb).length, 0);
    } finally {
      developmentDb?.close();
      productionDb?.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  }
);

test("storefront configuration rejects a published operations profile without contact information", (t) => {
  const directory = temporaryDirectory(t);
  const filename = path.join(directory, "invalid-storefront.json");
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDirectory, "config", "storefront.json"), "utf8")
  );
  config.operations.publicationStatus = "published";
  fs.writeFileSync(filename, JSON.stringify(config));

  assert.throws(
    () => loadStorefrontConfig({ filename }),
    /published operations profile needs a public phone number or email address/
  );
});

test("catalog CLI validates the committed demo file without touching a database", (t) => {
  const output = execFileSync(
    process.execPath,
    ["server/catalog-cli.js", "validate", "--file", "catalog/demo-products.csv"],
    {
      cwd: projectDirectory,
      encoding: "utf8"
    }
  );
  t.diagnostic(output.trim());
  assert.match(output, /Catalog is valid/);
  assert.match(output, /"rowCount":7/);
});
