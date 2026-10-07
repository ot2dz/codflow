/**
 * PDP templates + color presets (theme02)
 *
 * A product picks its page layout (`products.template`) and an optional color
 * preset (`products.palette`) from the dashboard. Slugs are intentionally
 * loose on the server side: an unknown template falls back to `default`, an
 * unknown palette falls back to inheriting the store colors — a stale value
 * can never blank or break a page.
 *
 * Palette presets override the runtime color tokens for that product page
 * only (they are emitted inline by the PDP dispatcher, so the rest of the
 * storefront keeps the merchant's own colors).
 */

export interface PdpTemplateDef {
  slug: string;
  /** Dashboard content key (products namespace) for the picker label. */
  labelKey: string;
  hintKey: string;
}

export const PDP_TEMPLATES: PdpTemplateDef[] = [
  {
    slug: "default",
    labelKey: "pdp_template_default",
    hintKey: "pdp_template_default_hint",
  },
  {
    slug: "ecolino",
    labelKey: "pdp_template_ecolino",
    hintKey: "pdp_template_ecolino_hint",
  },
];

export interface PdpPaletteDef {
  slug: string;
  labelKey: string;
  /** CSS custom properties applied to the product page root. */
  vars: Record<string, string>;
}

export const PDP_PALETTES: PdpPaletteDef[] = [
  {
    slug: "",
    labelKey: "pdp_palette_inherit",
    vars: {},
  },
  {
    slug: "ecolino",
    labelKey: "pdp_palette_ecolino",
    vars: {
      "--clr-primary": "#5cb12f",
      "--clr-accent": "#d31476",
      "--pdp-price": "#e02b1d",
      "--pdp-save-bg": "#9a8b57",
      "--pdp-steps-bg": "#e9f7de",
    },
  },
  {
    slug: "azure",
    labelKey: "pdp_palette_azure",
    vars: {
      "--clr-primary": "#1d4ed8",
      "--clr-accent": "#f59e0b",
      "--pdp-price": "#b91c1c",
      "--pdp-save-bg": "#0f766e",
      "--pdp-steps-bg": "#eff6ff",
    },
  },
  {
    slug: "noir",
    labelKey: "pdp_palette_noir",
    vars: {
      "--clr-primary": "#111827",
      "--clr-accent": "#c9a227",
      "--pdp-price": "#111827",
      "--pdp-save-bg": "#c9a227",
      "--pdp-steps-bg": "#f5f5f4",
    },
  },
];

export const DEFAULT_TEMPLATE = "default";

export function resolvePdpTemplate(slug: string | null | undefined): string {
  if (!slug) return DEFAULT_TEMPLATE;
  return PDP_TEMPLATES.some((t) => t.slug === slug) ? slug : DEFAULT_TEMPLATE;
}

export function resolvePdpPalette(slug: string | null | undefined): PdpPaletteDef {
  return PDP_PALETTES.find((p) => p.slug === (slug ?? "")) ?? PDP_PALETTES[0];
}

/** Inline custom-property declarations for the product page (safe: fixed set). */
export function pdpPaletteStyle(slug: string | null | undefined): string {
  const palette = resolvePdpPalette(slug);
  return Object.entries(palette.vars)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}
