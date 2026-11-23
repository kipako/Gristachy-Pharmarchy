import { createApp } from "./app.js";
import { createDatabase, defaultDatabaseFile } from "./database.js";
import { defaultStorefrontConfigFile, loadStorefrontConfig } from "./storefront.js";

const requestedPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
const db = createDatabase({ filename: process.env.DATABASE_FILE ?? defaultDatabaseFile });
const storefront = loadStorefrontConfig({
  filename: process.env.STOREFRONT_CONFIG_FILE ?? defaultStorefrontConfigFile
});
const app = createApp({ db, storefront });

const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    `${storefront.brand.displayName} review foundation is running on http://0.0.0.0:${port}`
  );
  console.log(
    "Demo only: orders are queued for pharmacist review; no payment or dispensing is enabled."
  );
});

function shutdown(signal) {
  console.log(`Received ${signal}; closing server.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
