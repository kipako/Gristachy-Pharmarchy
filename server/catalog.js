import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { recordAuditEvent } from "./audit.js";

const requiredColumns = [
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
const maxRows = 5000;

const text = (label, min, max) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const booleanText = (label) =>
  z
    .enum(["true", "false"], { error: `${label} must be true or false.` })
    .transform((value) => value === "true");

const nonNegativeIntegerText = (label) =>
  z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d*)$/, `${label} must be a whole non-negative number.`)
    .transform(Number)
    .refine(Number.isSafeInteger, `${label} must be a safe whole number.`);

const catalogRowSchema = z
  .object({
    sku: text("SKU", 1, 80).regex(
      /^[A-Z0-9][A-Z0-9._-]*$/,
      "SKU must use uppercase letters, numbers, dots, underscores, or hyphens."
    ),
    name: text("Product name", 2, 140),
    slug: text("Product slug", 2, 140).regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Product slug must use lowercase letters, numbers, and single hyphens."
    ),
    category_name: text("Category name", 2, 100),
    category_slug: text("Category slug", 2, 100).regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Category slug must use lowercase letters, numbers, and single hyphens."
    ),
    category_description: text("Category description", 10, 500),
    description: text("Product description", 10, 1000),
    price_tzs: nonNegativeIntegerText("TZS price"),
    stock_qty: nonNegativeIntegerText("Stock quantity"),
    requires_prescription: booleanText("Prescription classification"),
    featured: booleanText("Featured classification"),
    active: booleanText("Active classification"),
    publication_status: z.enum(["draft", "approved", "demo"], {
      error: "Publication status must be draft, approved, or demo."
    })
  })
  .transform((row) => ({
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    categoryDescription: row.category_description,
    description: row.description,
    priceTzs: row.price_tzs,
    stockQty: row.stock_qty,
    requiresPrescription: row.requires_prescription,
    featured: row.featured,
    active: row.active,
    publicationStatus: row.publication_status
  }));

export class CatalogValidationError extends Error {
  constructor(issues) {
    super("Catalog validation failed.");
    this.name = "CatalogValidationError";
    this.issues = issues;
  }
}

function parseCsv(csvText) {
  let header;
  let rows;
  try {
    const headerRows = parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      to_line: 1,
      trim: true
    });
    header = headerRows[0] || [];
    rows = parse(csvText, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    throw new CatalogValidationError([
      { row: 1, field: "file", message: `CSV could not be parsed: ${error.message}` }
    ]);
  }

  const missing = requiredColumns.filter((column) => !header.includes(column));
  const unexpected = header.filter((column) => !requiredColumns.includes(column));
  const duplicates = header.filter((column, index) => header.indexOf(column) !== index);
  const issues = [
    ...missing.map((column) => ({ row: 1, field: column, message: "Required column is missing." })),
    ...unexpected.map((column) => ({
      row: 1,
      field: column,
      message: "Unexpected column is not supported."
    })),
    ...duplicates.map((column) => ({
      row: 1,
      field: column,
      message: "Duplicate column is not supported."
    }))
  ];
  if (rows.length === 0)
    issues.push({ row: 1, field: "file", message: "At least one product row is required." });
  if (rows.length > maxRows)
    issues.push({ row: 1, field: "file", message: `A maximum of ${maxRows} rows is allowed.` });
  if (issues.length > 0) throw new CatalogValidationError(issues);
  return rows;
}

function crossRowIssues(rows) {
  const issues = [];
  const skus = new Map();
  const slugs = new Map();
  const categories = new Map();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (skus.has(row.sku)) {
      issues.push({
        row: rowNumber,
        field: "sku",
        message: `Duplicate SKU; first used on row ${skus.get(row.sku)}.`
      });
    } else {
      skus.set(row.sku, rowNumber);
    }
    if (slugs.has(row.slug)) {
      issues.push({
        row: rowNumber,
        field: "slug",
        message: `Duplicate product slug; first used on row ${slugs.get(row.slug)}.`
      });
    } else {
      slugs.set(row.slug, rowNumber);
    }

    const category = categories.get(row.categorySlug);
    if (
      category &&
      (category.name !== row.categoryName || category.description !== row.categoryDescription)
    ) {
      issues.push({
        row: rowNumber,
        field: "category_slug",
        message: `Category ${row.categorySlug} must use one consistent name and description; first defined on row ${category.row}.`
      });
    } else if (!category) {
      categories.set(row.categorySlug, {
        name: row.categoryName,
        description: row.categoryDescription,
        row: rowNumber
      });
    }
  });

  return issues;
}

export function validateCatalogCsv(csvText) {
  const rawRows = parseCsv(csvText);
  const rows = [];
  const issues = [];

  rawRows.forEach((rawRow, index) => {
    const parsed = catalogRowSchema.safeParse(rawRow);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          row: index + 2,
          field: issue.path.join(".") || "row",
          message: issue.message
        });
      }
      return;
    }
    rows.push(parsed.data);
  });

  if (issues.length > 0) throw new CatalogValidationError(issues);
  const rowIssues = crossRowIssues(rows);
  if (rowIssues.length > 0) throw new CatalogValidationError(rowIssues);
  return rows;
}

export function readAndValidateCatalogFile(filename) {
  let csvText;
  try {
    csvText = fs.readFileSync(filename, "utf8");
  } catch (error) {
    throw new CatalogValidationError([
      { row: 0, field: "file", message: `Unable to read ${filename}: ${error.message}` }
    ]);
  }
  return validateCatalogCsv(csvText);
}

function assertImportable(rows, { allowDemo }) {
  const issues = [];
  if (allowDemo && process.env.NODE_ENV === "production") {
    issues.push({
      row: 0,
      field: "allow-demo",
      message: "Demo catalog imports are forbidden in production mode."
    });
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.publicationStatus === "draft") {
      issues.push({
        row: rowNumber,
        field: "publication_status",
        message: "Draft rows cannot be imported."
      });
    }
    if (row.publicationStatus === "demo" && !allowDemo) {
      issues.push({
        row: rowNumber,
        field: "publication_status",
        message: "Demo rows require the explicit --allow-demo flag."
      });
    }
  });

  if (issues.length > 0) throw new CatalogValidationError(issues);
}

function findExistingProduct(db, row) {
  const matches = db
    .prepare("SELECT id, sku, slug FROM products WHERE sku = ? OR slug = ?")
    .all(row.sku, row.slug);
  if (matches.length === 0) return null;
  if (matches.length > 1 || matches[0].sku !== row.sku || matches[0].slug !== row.slug) {
    throw new CatalogValidationError([
      {
        row: 0,
        field: "sku/slug",
        message: `Existing catalog data conflicts with SKU ${row.sku} or slug ${row.slug}. Resolve the conflict before importing.`
      }
    ]);
  }
  return matches[0];
}

function assertCompatibleCategory(db, row) {
  const matches = db
    .prepare("SELECT id, name, slug FROM categories WHERE name = ? OR slug = ?")
    .all(row.categoryName, row.categorySlug);
  const nameMatch = matches.find((category) => category.name === row.categoryName);
  if (nameMatch && nameMatch.slug !== row.categorySlug) {
    throw new CatalogValidationError([
      {
        row: 0,
        field: "category_name/category_slug",
        message: `Existing category name ${row.categoryName} is already linked to ${nameMatch.slug}. Resolve the conflict before importing.`
      }
    ]);
  }
}

export function importCatalog(
  db,
  rows,
  { sourceName = "catalog.csv", mode = "upsert", allowDemo = false } = {}
) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CatalogValidationError([
      { row: 1, field: "file", message: "At least one validated product row is required." }
    ]);
  }
  if (rows.length > maxRows) {
    throw new CatalogValidationError([
      { row: 1, field: "file", message: `A maximum of ${maxRows} rows is allowed.` }
    ]);
  }
  if (!["upsert", "replace"].includes(mode)) {
    throw new CatalogValidationError([
      { row: 0, field: "mode", message: "Mode must be upsert or replace." }
    ]);
  }
  assertImportable(rows, { allowDemo });

  const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const publicationStatus = rows.some((row) => row.publicationStatus === "demo")
    ? "demo"
    : "approved";
  const sourceLabel = path.basename(sourceName);
  const importId = randomUUID();

  const transaction = db.transaction(() => {
    const importRecord = db.prepare(`
      INSERT INTO catalog_imports (id, source_name, checksum, mode, row_count, publication_status, contains_prescription)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCategory = db.prepare(`
      INSERT INTO categories (name, slug, description)
      VALUES (?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET name = excluded.name, description = excluded.description
    `);
    const categoryBySlug = db.prepare("SELECT id FROM categories WHERE slug = ?");
    const insertProduct = db.prepare(`
      INSERT INTO products (
        category_id, sku, name, slug, description, price_tzs, stock_qty,
        requires_prescription, featured, active, catalog_import_id, publication_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProduct = db.prepare(`
      UPDATE products
      SET category_id = ?, sku = ?, name = ?, slug = ?, description = ?, price_tzs = ?, stock_qty = ?,
          requires_prescription = ?, featured = ?, active = ?, catalog_import_id = ?, publication_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    importRecord.run(
      importId,
      sourceLabel,
      checksum,
      mode,
      rows.length,
      publicationStatus,
      rows.some((row) => row.requiresPrescription) ? 1 : 0
    );

    let deactivatedCount = 0;

    for (const row of rows) {
      assertCompatibleCategory(db, row);
      upsertCategory.run(row.categoryName, row.categorySlug, row.categoryDescription);
      const category = categoryBySlug.get(row.categorySlug);
      const existing = findExistingProduct(db, row);
      const values = [
        category.id,
        row.sku,
        row.name,
        row.slug,
        row.description,
        row.priceTzs,
        row.stockQty,
        row.requiresPrescription ? 1 : 0,
        row.featured ? 1 : 0,
        row.active ? 1 : 0,
        importId,
        row.publicationStatus
      ];
      if (existing) updateProduct.run(...values, existing.id);
      else insertProduct.run(...values);
    }

    if (mode === "replace") {
      deactivatedCount = db
        .prepare(
          "UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE active = 1 AND (catalog_import_id IS NULL OR catalog_import_id <> ?)"
        )
        .run(importId).changes;
    }

    recordAuditEvent(db, {
      eventType: "catalog.imported",
      entityType: "catalog_import",
      entityId: importId,
      metadata: {
        sourceName: sourceLabel,
        mode,
        rowCount: rows.length,
        publicationStatus,
        containsPrescription: rows.some((row) => row.requiresPrescription)
      }
    });

    return {
      importId,
      sourceName: sourceLabel,
      mode,
      importedCount: rows.length,
      deactivatedCount,
      publicationStatus,
      containsPrescription: rows.some((row) => row.requiresPrescription)
    };
  });

  return transaction();
}

export function formatCatalogIssues(issues) {
  return issues
    .map((issue) => `row ${issue.row || "?"}, ${issue.field}: ${issue.message}`)
    .join("\n");
}
