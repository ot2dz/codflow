import { z } from "zod";

const variantOptionSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.object({
    value: z.string().min(1),
    hexColor: z.string().optional().nullable(),
  })).min(1),
});

/**
 * Rich content blocks for the product page (rendered by templates that
 * support them, below the order form). Images are URLs already stored for
 * the product (R2/media domain) or any absolute URL.
 */
const contentImage = z.string().min(1).max(600);
const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image_text"),
    image: contentImage,
    title: z.string().max(200).optional(),
    text: z.string().max(3000).optional(),
    imageSide: z.enum(["start", "end"]).optional(),
  }),
  z.object({
    type: z.literal("steps"),
    title: z.string().max(200).optional(),
    items: z
      .array(
        z.object({
          image: contentImage.optional(),
          title: z.string().max(200).optional(),
          text: z.string().max(1500).optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    type: z.literal("two_images"),
    images: z.array(contentImage).length(2),
  }),
]);
export const contentBlocksSchema = z.array(contentBlockSchema).max(20);

export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  handle: z.string().optional(), // auto-generated if not provided
  price: z.number().int().min(0),
  compareAtPrice: z.number().int().min(0).optional(),
  costPrice: z.number().int().min(0).optional(),
  type: z.enum(["PHYSICAL", "DIGITAL"]).default("PHYSICAL"),
  hasVariants: z.boolean().default(false),
  variantOptions: z.array(variantOptionSchema).optional().nullable(),
  // Required for simple products (hasVariants=false). Variant products carry SKU on each variant.
  sku: z.string().min(1).optional(),
  inventory: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(5).optional(),
  trackInventory: z.boolean().default(true),
  categoryId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  visibility: z.boolean().default(true),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  showInStore: z.boolean().default(true),
  storeFeatured: z.boolean().default(false),
  shippingProfileId: z.string().optional().nullable(),
  freeShipping: z.boolean().default(false),
  /** Test-mode product: orders from it are flagged as test orders. */
  isTest: z.boolean().default(false),
  /** Product page template slug — resolved by the theme's registry. */
  template: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Template slug: lowercase letters, digits, hyphens")
    .default("default"),
  /** Color preset slug ("" = inherit the store's colors). */
  palette: z
    .string()
    .regex(/^[a-z0-9-]{0,40}$/, "Palette slug: lowercase letters, digits, hyphens")
    .default(""),
  /** Rich content blocks (image+text / steps / two images). */
  contentBlocks: contentBlocksSchema.optional(),
}).superRefine((data, ctx) => {
  if (!data.hasVariants && !data.sku) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "SKU is required for simple products (hasVariants=false)",
      path: ["sku"],
    });
  }
});

export const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  handle: z.string().optional(),
  price: z.number().int().min(0).optional(),
  compareAtPrice: z.number().int().min(0).optional().nullable(),
  costPrice: z.number().int().min(0).optional().nullable(),
  type: z.enum(["PHYSICAL", "DIGITAL"]).optional(),
  hasVariants: z.boolean().optional(),
  variantOptions: z.array(variantOptionSchema).optional().nullable(),
  sku: z.string().min(1).optional(),
  inventory: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  trackInventory: z.boolean().optional(),
  categoryId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  visibility: z.boolean().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  showInStore: z.boolean().optional(),
  storeFeatured: z.boolean().optional(),
  shippingProfileId: z.string().optional().nullable(),
  freeShipping: z.boolean().optional(),
  /** Test-mode product: orders from it are flagged as test orders. */
  isTest: z.boolean().optional(),
  /** Product page template slug — resolved by the theme's registry. */
  template: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Template slug: lowercase letters, digits, hyphens")
    .optional(),
  /** Color preset slug ("" = inherit the store's colors). */
  palette: z
    .string()
    .regex(/^[a-z0-9-]{0,40}$/, "Palette slug: lowercase letters, digits, hyphens")
    .optional(),
  /** Rich content blocks — pass null to clear. */
  contentBlocks: contentBlocksSchema.nullable().optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});

export const productFiltersSchema = z.object({
  categoryId: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  visibility: z.string().transform((v) => v === "true").optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductFiltersInput = z.infer<typeof productFiltersSchema>;
