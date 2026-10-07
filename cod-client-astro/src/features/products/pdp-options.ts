/**
 * PDP template + palette options for the dashboard pickers.
 *
 * Mirrors `cod-astro/theme02/src/theme/config/pdp.ts`. The dashboard cannot
 * import theme code (boundary: the theme owns its own style system), so the
 * small slug list is duplicated here — keep both files in sync when a theme
 * template or palette is added. The server accepts any slug (regex) and the
 * theme falls back to the default layout / store colors for unknown values,
 * so drift is always safe.
 */

export interface PdpTemplateOption {
  slug: string;
  labelKey: string;
  hintKey: string;
}

export const PDP_TEMPLATE_OPTIONS: PdpTemplateOption[] = [
  { slug: "default", labelKey: "pdp_template_buybox", hintKey: "pdp_template_buybox_hint" },
  { slug: "card", labelKey: "pdp_template_card", hintKey: "pdp_template_card_hint" },
];

export interface PdpPaletteOption {
  slug: string;
  labelKey: string;
  /** Swatch dots shown in the picker. */
  swatch: string[];
}

export const PDP_PALETTE_OPTIONS: PdpPaletteOption[] = [
  { slug: "", labelKey: "pdp_palette_inherit", swatch: [] },
  { slug: "ecolino", labelKey: "pdp_palette_ecolino", swatch: ["#5cb12f", "#d31476", "#e02b1d"] },
  { slug: "azure", labelKey: "pdp_palette_azure", swatch: ["#1d4ed8", "#f59e0b", "#b91c1c"] },
  { slug: "noir", labelKey: "pdp_palette_noir", swatch: ["#111827", "#c9a227", "#3730a3"] },
];

export const DEFAULT_PDP_TEMPLATE = "default";
