import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
export const defaultStorefrontConfigFile = path.join(projectDirectory, "config", "storefront.json");

const text = (label, min, max) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid public email address."
  );

const storefrontSchema = z
  .object({
    schemaVersion: z.literal(1),
    brand: z.object({
      displayName: text("Public display name", 2, 80),
      shortName: text("Short public name", 2, 40),
      tagline: text("Public tagline", 2, 100),
      legalName: z.string().trim().max(160)
    }),
    theme: z.object({
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex primary color."),
      primaryDarkColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex dark primary color."),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex accent color.")
    }),
    locale: z.object({
      currency: z.literal("TZS"),
      locale: z.literal("en-TZ")
    }),
    catalog: z.object({
      publicationStatus: z.enum(["template_only", "demo", "approved"]),
      approvalNotice: text("Catalog approval notice", 10, 500)
    }),
    operations: z.object({
      publicationStatus: z.enum(["not_published", "published"]),
      publicMessage: text("Public operations message", 10, 500),
      phone: z.string().trim().max(40),
      email: optionalEmail,
      address: z.string().trim().max(300),
      serviceAreas: z.array(text("Service area", 2, 100)).max(30),
      hours: z.array(text("Operating-hour entry", 2, 100)).max(20)
    })
  })
  .superRefine((config, context) => {
    if (
      config.operations.publicationStatus === "published" &&
      !config.operations.phone &&
      !config.operations.email
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations", "phone"],
        message: "A published operations profile needs a public phone number or email address."
      });
    }
  });

export function loadStorefrontConfig({ filename = defaultStorefrontConfigFile } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read storefront configuration at ${filename}: ${error.message}`, {
      cause: error
    });
  }

  const result = storefrontSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid storefront configuration at ${filename}: ${messages}`);
  }
  return result.data;
}

export function publicStorefrontConfig(config) {
  const operations = {
    publicationStatus: config.operations.publicationStatus,
    publicMessage: config.operations.publicMessage
  };
  if (config.operations.publicationStatus === "published") {
    operations.phone = config.operations.phone;
    operations.email = config.operations.email;
    operations.address = config.operations.address;
    operations.serviceAreas = config.operations.serviceAreas;
    operations.hours = config.operations.hours;
  }

  return {
    schemaVersion: config.schemaVersion,
    brand: {
      displayName: config.brand.displayName,
      shortName: config.brand.shortName,
      tagline: config.brand.tagline
    },
    theme: config.theme,
    locale: config.locale,
    catalog: config.catalog,
    operations
  };
}
