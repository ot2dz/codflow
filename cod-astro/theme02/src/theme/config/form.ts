/**
 * theme02 — order form controls (single place to tune the checkout UI).
 *
 * Everything the merchant/designer usually wants to flip on a COD product
 * page lives here. Change a boolean, rebuild — no component edits needed.
 * Pricing, variants, offers, OTP and Turnstile are still driven by the
 * product data and the store config from the dashboard; this file only
 * controls the presentation of the order form.
 */
export interface OrderFormOptions {
  /** Product title + price row at the top of the form card. */
  showProductHeader: boolean;
  /** Standalone quantity stepper (only used when the product has no offers). */
  showQuantityController: boolean;
  /** The collapsible "order summary" card. */
  showSummary: boolean;
  /** Render the summary expanded on load. */
  summaryOpen: boolean;
  /** Free-text address field. */
  showAddress: boolean;
  /** Small legal/confirmation note under the button. */
  showConfirmNote: boolean;
  /** Floating "order now" bar pinned to the bottom on mobile. */
  stickyMobileCta: boolean;
  /** Show the shipping row inside the summary. */
  showShippingRow: boolean;
}

export const ORDER_FORM: OrderFormOptions = {
  showProductHeader: false,
  showQuantityController: true,
  showSummary: true,
  summaryOpen: true,
  showAddress: true,
  showConfirmNote: true,
  stickyMobileCta: true,
  showShippingRow: true,
};
