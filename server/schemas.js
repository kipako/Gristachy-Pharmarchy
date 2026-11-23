import { z } from "zod";

const cleanText = (label, min, max) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

export const cartIdSchema = z.string().uuid("A valid cart id is required.");

export const cartItemSchema = z.object({
  productId: z.coerce.number().int().positive("Choose a valid product."),
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1.")
    .max(100, "Quantity cannot exceed 100 per update.")
});

export const updateCartItemSchema = z.object({
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1.")
    .max(100, "Quantity cannot exceed 100 per update.")
});

export const productQuerySchema = z.object({
  q: z.string().trim().max(80, "Search must be 80 characters or fewer.").optional().default(""),
  category: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Choose a valid category.")
    .max(60)
    .optional(),
  prescription: z.enum(["all", "otc", "required"]).optional().default("all")
});

const consent = (message) => z.boolean().refine((value) => value === true, message);

export const staffLoginSchema = z.object({
  email: z.string().trim().email("Enter a valid staff email address.").max(254),
  password: z
    .string()
    .min(1, "Enter a password.")
    .max(128, "Password must be 128 characters or fewer.")
});

export const staffOrderQuerySchema = z.object({
  status: z
    .enum(["pending_pharmacist_review", "approved_for_payment", "rejected", "cancelled", "all"])
    .optional()
    .default("pending_pharmacist_review")
});

export const orderReferenceSchema = z
  .string()
  .regex(/^PHM-\d{8}-[A-F0-9]{8}$/, "Choose a valid review request.");

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: cleanText("Review note", 10, 1000),
  acknowledgement: consent("You must acknowledge the review boundary before recording a decision.")
});

export const orderSchema = z.object({
  cartId: cartIdSchema,
  customer: z.object({
    firstName: cleanText("First name", 1, 60),
    lastName: cleanText("Last name", 1, 60),
    email: z.string().trim().email("Enter a valid email address.").max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+() -]{7,24}$/, "Enter a valid phone number.")
      .max(24),
    addressLine1: cleanText("Address", 3, 160),
    addressLine2: z.string().trim().max(160).optional().default(""),
    district: cleanText("District", 2, 80),
    region: cleanText("Region", 2, 80)
  }),
  prescription: z
    .object({
      reference: z
        .string()
        .trim()
        .max(100, "Prescription reference must be 100 characters or fewer.")
        .optional()
        .default(""),
      consentToReview: z.boolean().optional().default(false)
    })
    .optional()
    .default({ reference: "", consentToReview: false }),
  consents: z.object({
    privacy: consent("You must acknowledge the demo privacy notice."),
    terms: consent("You must acknowledge the pharmacist-review terms.")
  })
});
