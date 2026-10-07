/**
 * Shared props every PDP template receives from the dispatcher
 * (ProductDetailContent). Engine values are computed once, server-side:
 * templates only arrange them — no fetching, no pricing logic.
 */
export interface PdpTemplateProps {
  product: any;
  config: any;
  content: any;
  isRTL: boolean;
  fieldErrors: any;
  serverError: string | null;
  basePrice: number;
  comparePrice: number | null;
  discountPct: number;
  defaultVariant: any;
  defaultVariantId: string | null;
  isOutOfStock: boolean;
  isLowStock: boolean;
  lowStockText: string;
  cur: string;
}
