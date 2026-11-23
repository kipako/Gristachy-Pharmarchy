import path from "node:path";
import process from "node:process";
import {
  CatalogValidationError,
  formatCatalogIssues,
  importCatalog,
  readAndValidateCatalogFile
} from "./catalog.js";
import { createDatabase, defaultDatabaseFile } from "./database.js";

function usage() {
  console.log(`
Usage:
  npm run catalog:validate -- --file path/to/catalog.csv
  npm run catalog:import -- --file path/to/catalog.csv [--mode upsert|replace] [--database path/to/database.sqlite] [--allow-demo]

Only approved rows can be imported normally. --allow-demo is for local development only and is forbidden when NODE_ENV=production.
`);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { command, mode: "upsert", allowDemo: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--allow-demo") {
      options.allowDemo = true;
      continue;
    }
    if (["--file", "--mode", "--database"].includes(argument)) {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--file") options.file = value;
      if (argument === "--mode") options.mode = value;
      if (argument === "--database") options.database = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function summarize(rows) {
  return {
    rowCount: rows.length,
    activeCount: rows.filter((row) => row.active).length,
    prescriptionCount: rows.filter((row) => row.requiresPrescription).length,
    statuses: [...new Set(rows.map((row) => row.publicationStatus))]
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.command || options.command === "--help" || options.command === "help") {
    usage();
    return;
  }
  if (!options.file) throw new Error("--file is required.");
  if (!["validate", "import"].includes(options.command))
    throw new Error("Command must be validate or import.");

  const rows = readAndValidateCatalogFile(options.file);
  if (options.command === "validate") {
    console.log(`Catalog is valid: ${JSON.stringify(summarize(rows))}`);
    return;
  }

  const db = createDatabase({
    filename: options.database ?? process.env.DATABASE_FILE ?? defaultDatabaseFile
  });
  try {
    const result = importCatalog(db, rows, {
      sourceName: path.resolve(options.file),
      mode: options.mode,
      allowDemo: options.allowDemo
    });
    console.log(`Catalog import complete: ${JSON.stringify(result)}`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  if (error instanceof CatalogValidationError) {
    console.error(`Catalog validation failed:\n${formatCatalogIssues(error.issues)}`);
  } else {
    console.error(`Catalog command failed: ${error.message}`);
  }
  process.exitCode = 1;
}
