import { z } from "zod";

export const waitlistSchema = z.object({
  visitorId: z.string().min(8).max(64),
  email: z.string().trim().toLowerCase().email().max(254),
  brandName: z.string().trim().min(1).max(120),
  storeUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "must be a valid URL"),
  platform: z.enum(["shopify", "woocommerce", "bigcommerce", "custom", "other"]).optional(),
  monthlyOrders: z.enum(["0-50", "51-500", "501-5000", "5000+"]).optional(),
  biggestProblem: z.string().trim().max(1000).optional(),
  utmSource: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  // Honeypot: real users never fill this hidden field.
  company: z.string().max(0).optional(),
});

export const landingEventSchema = z.object({
  visitorId: z.string().min(8).max(64),
  event: z.enum(["page_view", "cta_click"]),
  variant: z.string().max(32).optional(),
  path: z.string().max(200).optional(),
  utmSource: z.string().max(100).optional(),
});

export const tryOnSchema = z.object({
  photoId: z.string().uuid(),
  productId: z.string().uuid(),
  embedKey: z.string().regex(/^ts_pk_[0-9A-Za-z]{32}$/).optional(),
});

export const feedbackSchema = z.object({
  generationId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export const merchantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().startsWith("https://").max(300).optional().or(z.literal("").transform(() => undefined)),
});

export const productFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(["tops", "bottoms", "one-pieces"]),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/, "must be a price like 59.00")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  purchaseUrl: z.string().trim().url().startsWith("https://", "must start with https://").max(500),
});
