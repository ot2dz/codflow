/**
 * EcoTrack Webhook Status Mapper
 *
 * Maps the PartenaireState `state.code` values from EcoTrack's inbound
 * webhook (Shipper Integration Guide v1.0, §4.1 — 22 order.state.* events)
 * onto CodFlow order statuses, with the Arabic label surfaced to the
 * merchant in the webhook event feed.
 *
 * Contract rules (shared with every webhook receiver in this folder):
 *   - Unknown codes → { status: null, noop: false } → caller logs
 *     result='unmapped' and NEVER touches the order status.
 *   - Transition authority stays with updateOrderStatusWebhook's forward-only
 *     rank guard: a mapped status can never move an order backwards.
 *   - The keys here are the documented enum names, lowercased. Pull-side
 *   get/orders rows use the same lowercase vocabulary (status-mapping.ts),
 *   so both spellings observed in the wild (PRET_/PRETE_) are accepted.
 */

export interface EcotrackWebhookMapping {
  /** Target order status — null = deliberate no-op (transit) or unknown. */
  status: string | null;
  /** Known non-status update (MAJ) that increments deliveryAttempts. */
  incrementAttempts: boolean;
  /** True = documented value that changes no status (log 'ignored').
   *  False + status null = unknown value → log 'unmapped'. */
  noop: boolean;
  /** Arabic label for the merchant event feed. */
  ar: string;
}

function state(status: string, ar: string): EcotrackWebhookMapping {
  return { status, incrementAttempts: false, noop: false, ar };
}

function noop(ar: string): EcotrackWebhookMapping {
  return { status: null, incrementAttempts: false, noop: true, ar };
}

const ATTEMPT: EcotrackWebhookMapping = {
  status: null,
  incrementAttempts: true,
  noop: false,
  ar: "محاولة توصيل جديدة",
};

const DEFERRED_ATTEMPT: EcotrackWebhookMapping = {
  status: null,
  incrementAttempts: true,
  noop: false,
  ar: "أُجّلت محاولة التوصيل",
};

const UNKNOWN: EcotrackWebhookMapping = {
  status: null,
  incrementAttempts: false,
  noop: false,
  ar: "حالة غير معروفة",
};

/** All 22 documented PartenaireState codes, lowercased enum names. */
export const ECOTRACK_STATE_MAP: Record<string, EcotrackWebhookMapping> = {
  // ── At / with the carrier — maps to dispatched (same as the pull map) ──
  pret_a_expedier: state("dispatched", "جاهز للشحن لدى الشركة"),
  prete_a_expedier: state("dispatched", "جاهز للشحن لدى الشركة"),
  pret_a_preparer: state("dispatched", "جاهز للتحضير"),
  prete_a_preparer: state("dispatched", "جاهز للتحضير"),
  en_ramassage: state("dispatched", "جارٍ استلام الطرد من المتجر"),
  stock_en_preparation: state("dispatched", "في المستودع قيد التحضير"),
  vers_hub: state("dispatched", "في الطريق إلى الفرع"),
  en_hub: state("dispatched", "وصل إلى فرع الشركة"),
  vers_wilaya: state("dispatched", "في الطريق إلى الولاية"),
  en_preparation: state("dispatched", "قيد التجهيز للتوصيل"),

  // ── Out for delivery ──
  en_livraison: state("out_for_delivery", "خرج المندوب للتوصيل"),

  // ── Failed / suspended ──
  suspendus: state("unreachable", "موقوف — تعذّر التسليم"),

  // ── Delivered family ──
  livre_non_encaisse: state("delivered", "تم التسليم — لم تُحصَّل بعد"),
  livre_encaisse_non_paye: state("delivered", "تم التسليم وحُصّل — بانتظار التسوية"),
  paiement_pret: state("delivered", "المبلغ محصّل وجاهز للتسوية"),
  paiement_archived: state("delivered", "الدفع مكتمل ومُؤرشف"),

  // ── Return family (any return signal advances to returned) ──
  retours_en_traitement: state("returned", "إرجاع: قيد المعالجة"),
  retours_chez_livreur: state("returned", "إرجاع: الطرد عند المندوب"),
  retours_prets: state("returned", "إرجاع: جاهز للاستلام"),
  retours_recu: state("returned", "إرجاع: استلمته الشركة"),
  retours_a_dispatcher_vers_stock: state("returned", "إرجاع: في الطريق إلى المستودع"),
  retours_en_transit_stock: state("returned", "إرجاع: في الطريق إلى المستودع"),
  retours_en_stock: state("returned", "إرجاع: وصل إلى المستودع"),
  retours_archived: state("returned", "إرجاع: مُؤرشف"),
};

/** order.maj.* payloads (§4.2) keyed by maj.type. */
export const ECOTRACK_MAJ_MAP: Record<string, EcotrackWebhookMapping> = {
  tentative_added: ATTEMPT,
  tentative_delayed: DEFERRED_ATTEMPT,
  unknown: noop("تحديث من الشركة"),
};

/**
 * Map a state.code (case-insensitive) to its order status.
 * Unknown → status null, noop false → caller must log 'unmapped'.
 */
export function mapEcotrackWebhookState(
  code: string | null | undefined,
): EcotrackWebhookMapping {
  if (!code) return UNKNOWN;
  const key = code.trim().toLowerCase();
  return ECOTRACK_STATE_MAP[key] ?? UNKNOWN;
}

/** Map a maj.type to attempt-increment behavior. Unknown → 'unmapped'. */
export function mapEcotrackMajType(
  type: string | null | undefined,
): EcotrackWebhookMapping {
  if (!type) return UNKNOWN;
  const key = type.trim().toLowerCase();
  return ECOTRACK_MAJ_MAP[key] ?? UNKNOWN;
}
