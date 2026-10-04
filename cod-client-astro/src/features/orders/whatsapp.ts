import type { OrderListItem } from "./types";
import { orderTotal } from "./model";

/** Merchant-editable WhatsApp outreach template (localStorage-persisted). */
export const WA_TEMPLATE_STORAGE_KEY = "codflow.orders.waTemplate";

export const DEFAULT_WA_TEMPLATE =
  "مرحبًا {customer} 👋\nطلبك رقم {order} بحالة: {status} — المجموع {total} دج.\nنرجو تأكيد الطلب أو إعلامنا بأي استفسار. شكرًا لتعاملكم 🌹";

export const WA_PLACEHOLDERS = [
  "customer",
  "order",
  "status",
  "total",
  "wilaya",
] as const;

export function loadWaTemplate(): string {
  try {
    return localStorage.getItem(WA_TEMPLATE_STORAGE_KEY) || DEFAULT_WA_TEMPLATE;
  } catch {
    return DEFAULT_WA_TEMPLATE;
  }
}

export function saveWaTemplate(template: string): void {
  try {
    if (template.trim() && template !== DEFAULT_WA_TEMPLATE) {
      localStorage.setItem(WA_TEMPLATE_STORAGE_KEY, template);
    } else {
      localStorage.removeItem(WA_TEMPLATE_STORAGE_KEY);
    }
  } catch {
    /* private mode / storage disabled — the default still works */
  }
}

/** Replace {placeholders}; unknown tokens are left intact so typos stay visible. */
export function applyWaTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Algeria mobile → wa.me international digits.
 * Accepts 0X..., +213..., 00213..., and bare 5|6|7 + 8 digits.
 * Returns null for anything that cannot be dialled from DZ.
 */
export function normalizeAlgerianPhoneToWa(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (/^00213\d{9}$/.test(digits)) return "213" + digits.slice(5);
  if (/^213\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return "213" + digits.slice(1);
  if (/^[567]\d{8}$/.test(digits)) return "213" + digits;
  return null;
}

export function buildWaUrl(phone: string, message: string): string | null {
  const normalized = normalizeAlgerianPhoneToWa(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Message vars for one order — statusLabel comes from the i18n layer. */
export function buildOrderWaMessage(
  order: Pick<
    OrderListItem,
    "customerName" | "orderNumber" | "status" | "wilaya" | "price" | "deliveryFee"
  >,
  statusLabel: string,
  template: string = loadWaTemplate(),
): string {
  return applyWaTemplate(template, {
    customer: order.customerName,
    order: order.orderNumber,
    status: statusLabel,
    total: String(orderTotal(order)),
    wilaya: order.wilaya ?? "",
  });
}
