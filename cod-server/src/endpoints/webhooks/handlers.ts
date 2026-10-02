/**
 * Webhook Handlers
 *
 * Handles inbound webhook deliveries from ZR Express, Yalidine, and the
 * EcoTrack platform family (*_ecotrack companies — Packers, DHD, ...).
 *
 * Key rules (from docs):
 *   - rawBody MUST be read before JSON.parse (all providers verify raw bytes)
 *   - Always return 200 — all providers retry on non-200
 *   - Yalidine GET challenge must always respond, before any DB calls
 *   - parcel.state.situation.created → log only, never change order status
 *   - Idempotency is per-event, not per-request (Yalidine batches events)
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import {
  getDeliveryCompanyByCode,
  listEcotrackCompaniesRaw,
} from "@/endpoints/delivery-companies/queries";
import {
  insertWebhookEvent,
  updateWebhookEvent,
  getOrderByTracking,
  getOrderByReference,
} from "./queries";
import {
  updateOrderStatusWebhook,
  incrementDeliveryAttempts,
} from "@/endpoints/orders/queries";
import { ORDER_STATUSES } from "../orders/validation";
import type { OrderStatus } from "../../../../cod-shared/db/schema";
import { verifySvixSignature } from "./svix-verify";
import { verifyYalidineSignature } from "./yalidine-verify";
import { verifyEcotrackSignature } from "./ecotrack-verify";
import { mapZrStateName, parseCustomMapping } from "./zr-status-mapper";
import { mapYalidineStatus } from "./yalidine-status-mapper";
import {
  mapEcotrackWebhookState,
  mapEcotrackMajType,
} from "./ecotrack-status-mapper";
import { ValidationError, ExternalApiError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

/** Guard: carrier mappers return admin-configured strings — verify before use. */
function isOrderStatus(value: string): value is (typeof ORDER_STATUSES)[number] {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Terminal order statuses — late carrier events never modify these orders. */
const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>(["delivered", "returned", "cancelled"]);
import { shouldTriggerCapiPurchase, getCapiWorkflowId } from "@/workflows/capi-helpers";

// ─── ZR Express ───────────────────────────────────────────────────────────────

/**
 * POST /webhooks/zr_express
 *
 * Receives ZR Express webhook events via Svix.
 * Payload: { eventType, occurredAt, data: ParcelWebhookDto }
 * Idempotency key: svix-id header
 */
export async function handleZrWebhook(c: Context<AppContext>) {
  // MUST read raw body first — Svix signature verification requires raw bytes
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);

  // Locate the ZR Express delivery company record
  const company = await getDeliveryCompanyByCode(db, "zr_express");
  if (!company) {
    console.warn("[webhook][zr] No zr_express delivery company configured");
    return c.json({ received: true }, 200);
  }

  // Verify Svix signature if secret is configured
  if (company.webhookSecret) {
    const valid = await verifySvixSignature(
      rawBody,
      c.req.header("svix-id") ?? null,
      c.req.header("svix-timestamp") ?? null,
      c.req.header("svix-signature") ?? null,
      company.webhookSecret
    );
    if (!valid) {
      console.warn("[webhook][zr] Signature verification failed");
      throw new ValidationError(
        "Invalid webhook signature",
        ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
        { provider: "zr_express" }
      );
    }
  } else {
    console.warn("[webhook][zr] webhookSecret not set — skipping signature verification");
  }

  // Parse the payload
  let payload: {
    eventType?: string;
    occurredAt?: string;
    data?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[webhook][zr] Failed to parse JSON body");
    throw new ValidationError(
      "Invalid JSON payload",
      ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
      { provider: "zr_express" }
    );
  }

  const eventType = payload.eventType ?? "unknown";
  const data = payload.data ?? {};
  const trackingNumber = (data.trackingNumber as string | undefined) ?? null;
  const externalId = (data.externalId as string | undefined) ?? null;

  // Use the svix-id header as the idempotency key
  const eventId = c.req.header("svix-id") ?? crypto.randomUUID();
  const now = new Date().toISOString();

  // Insert event record for idempotency + audit
  const { id: webhookEventId, isDuplicate } = await insertWebhookEvent(db, {
    provider: "zr_express",
    eventId,
    companyId: company.id,
    tracking: trackingNumber,
    eventType,
    rawPayload: rawBody,
  });

  if (isDuplicate) {
    // Already processed — return 200 without reprocessing
    return c.json({ received: true }, 200);
  }

  // Handle parcel.state.situation.created — log only, never change order status.
  // Situation slugs and names are not documented as fixed values.
  if (eventType === "parcel.state.situation.created") {
    const situation = data.situation as Record<string, unknown> | undefined;
    const situationName = (situation?.name as string | undefined) ?? null;
    await updateWebhookEvent(db, webhookEventId, {
      result: "ignored",
      reason: situationName,
      processedAt: now,
    });
    return c.json({ received: true }, 200);
  }

  try {
    let newStatus: OrderStatus | null = null;

    if (eventType === "parcel.isReturn.updated") {
      // isReturn=true is the only 100% reliable ZR terminal signal — hardcoded, no mapping needed
      const isReturn = data.isReturn as boolean | undefined;
      if (isReturn === true) {
        newStatus = "returned";
      } else {
        // isReturn=false means the return flag was cleared — no action on our side
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          processedAt: now,
        });
        return c.json({ received: true }, 200);
      }
    } else if (eventType === "parcel.state.updated") {
      const state = data.state as Record<string, unknown> | undefined;
      const stateName = (state?.name as string | undefined) ?? null;
      const stateDescription = (state?.description as string | undefined) ?? null;
      const customMap = parseCustomMapping(company.webhookStatusMapping ?? null);
      // Match the slug name first, then the French display description —
      // tenants that rename slugs usually keep the description text.
      const mappedZr =
        mapZrStateName(stateName, customMap)
        ?? mapZrStateName(stateDescription, customMap);
      if (mappedZr === null || !isOrderStatus(mappedZr)) {
        newStatus = null;
        await updateWebhookEvent(db, webhookEventId, {
          result: "unmapped",
          reason: stateName ?? undefined,
          processedAt: now,
        });
        return c.json({ received: true }, 200);
      }
      newStatus = mappedZr;
    } else {
      // Unknown event type — log and ignore
      await updateWebhookEvent(db, webhookEventId, {
        result: "ignored",
        processedAt: now,
      });
      return c.json({ received: true }, 200);
    }

    // Look up the order — try tracking number first, then externalId (our order number)
    const order = trackingNumber
      ? await getOrderByTracking(db, trackingNumber)
      : null;
    const resolvedOrder = order ?? (externalId ? await getOrderByReference(db, externalId) : null);

    if (!resolvedOrder) {
      await updateWebhookEvent(db, webhookEventId, {
        result: "ignored",
        processedAt: now,
      });
      return c.json({ received: true }, 200);
    }

    const { updated } = await updateOrderStatusWebhook(
      db,
      resolvedOrder.id,
      newStatus,
      "webhook:zr_express"
    );

      if (updated && shouldTriggerCapiPurchase(newStatus, resolvedOrder.wilayaId)) {
        if (!c.env.CAPI_WORKFLOW) {
          console.error("[capi-workflow] CAPI_WORKFLOW binding is undefined — worker needs re-provision");
        } else {
          c.executionCtx.waitUntil(
            c.env.CAPI_WORKFLOW.create({
              id: getCapiWorkflowId(resolvedOrder.id, "delivered", "Purchase"),
              params: {
                orderId: resolvedOrder.id,
                eventName: "Purchase",
                stage: "delivered",
                triggeredAt: Math.floor(Date.now() / 1000),
                triggerStatus: newStatus,
              },
            }).catch((err: unknown) => console.error("[capi-workflow] zr trigger failed:", (err as Error)?.message))
          );
        }
      }

    await updateWebhookEvent(db, webhookEventId, {
      result: updated ? "ok" : "ignored",
      newStatus: updated ? newStatus : undefined,
      orderId: resolvedOrder.id,
      processedAt: now,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[webhook][zr] Processing error:", errorMsg);
    await updateWebhookEvent(db, webhookEventId, {
      result: "error",
      errorMsg,
      processedAt: now,
    }).catch(() => {}); // never throw from error handler
    
    throw new ExternalApiError(
      "zr_express",
      "Webhook processing failed",
      { webhookId: eventId, trackingNumber, errorMsg }
    );
  }

  return c.json({ received: true }, 200);
}

// ─── Yalidine ─────────────────────────────────────────────────────────────────

/**
 * GET /webhooks/yalidine
 *
 * CRC challenge endpoint required by Yalidine.
 * Yalidine sends GET ?subscribe=...&crc_token=<value>
 * We must echo the crc_token as plain text with 200.
 *
 * This check occurs at:
 *   - Webhook creation
 *   - Webhook edit
 *   - Periodically (if it fails, Yalidine disables the webhook)
 *
 * IMPORTANT: No DB calls, no auth. Must respond within 10 seconds.
 */
export async function handleYalidineChallenge(c: Context<AppContext>) {
  const subscribe = c.req.query("subscribe");
  const crcToken = c.req.query("crc_token");

  // Both params must be present — per Yalidine docs
  if (subscribe !== undefined && crcToken !== undefined) {
    return c.text(crcToken, 200);
  }

  return c.json({ ok: true }, 200);
}

/**
 * POST /webhooks/yalidine
 *
 * Receives Yalidine webhook event batches.
 * Payload: { type: string, events: [{ event_id, occurred_at, data }] }
 * Idempotency key: event.event_id (per event, not per request)
 *
 * Each event in the array is processed independently with its own try/catch.
 * Always returns 200.
 */
export async function handleYalidineWebhook(c: Context<AppContext>) {
  // MUST read raw body first — needed for future signature verification
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);

  const company = await getDeliveryCompanyByCode(db, "yalidine");
  if (!company) {
    console.warn("[webhook][yalidine] No yalidine delivery company configured");
    return c.json({ received: true }, 200);
  }

  // Signature verification (official "Secure Your Webhook" spec): HMAC-SHA256
  // of the RAW body bytes, keyed with the webhook secret from the company
  // record (stored via PATCH /delivery-companies/:id/webhook/secret).
  // Secret set → tampered deliveries are rejected with 400 (docs: "ignore
  // the payload as it may affect the integrity of your data"). Secret unset
  // → fail-open with one clear log line so merchants without a secret keep
  // receiving events (dashboard surfaces the unverified state — Slice Y3).
  if (company.webhookSecret) {
    // Both header spellings accepted: HTTP convention X-Yalidine-Signature
    // and the docs' PHP-formatted X_YALIDINE_SIGNATURE.
    const signature =
      c.req.header("x-yalidine-signature") ?? c.req.header("x_yalidine_signature") ?? null;
    const valid = await verifyYalidineSignature(
      rawBody,
      signature,
      company.webhookSecret,
    );
    if (!valid) {
      console.warn("[webhook][yalidine] Signature verification failed");
      throw new ValidationError(
        "Invalid webhook signature",
        ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
        { provider: "yalidine" }
      );
    }
  } else {
    console.warn(
      "[webhook][yalidine] webhookSecret not set — accepting unverified events " +
      "(set the secret in the dashboard to enable verification)"
    );
  }

  let payload: {
    type?: string;
    events?: Array<{
      event_id: string;
      occurred_at: string;
      data: Record<string, unknown>;
    }>;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[webhook][yalidine] Failed to parse JSON body");
    throw new ValidationError(
      "Invalid JSON payload",
      ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
      { provider: "yalidine" }
    );
  }

  const eventType = payload.type ?? "unknown";
  const events = payload.events ?? [];

  for (const event of events) {
    const eventId = event.event_id;
    const eventData = event.data ?? {};
    const tracking = (eventData.tracking as string | undefined) ?? null;
    const now = new Date().toISOString();

    const { id: webhookEventId, isDuplicate } = await insertWebhookEvent(db, {
      provider: "yalidine",
      eventId,
      companyId: company.id,
      tracking,
      eventType,
      rawPayload: JSON.stringify({ type: eventType, event }),
    });

    if (isDuplicate) continue;

    try {
      // Non-status event types — log and ignore
      if (eventType !== "parcel_status_updated") {
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          processedAt: now,
        });
        continue;
      }

      const statusStr = (eventData.status as string | undefined) ?? null;
      const reason = (eventData.reason as string | null | undefined) ?? null;
      const { status: mappedStatus, incrementAttempts, noop } = mapYalidineStatus(statusStr);

      if (mappedStatus === null || !isOrderStatus(mappedStatus)) {
        // Known transit status (noop) → deliberate ignore, the status itself
        // (and reason, e.g. En alerte's "Téléphone injoignable") is the log
        // line. Unknown string → 'unmapped': never guess, surface it loudly.
        await updateWebhookEvent(db, webhookEventId, {
          result: noop ? "ignored" : "unmapped",
          reason: reason ?? statusStr ?? undefined,
          processedAt: now,
        });
        continue;
      }
      const nextStatus: OrderStatus = mappedStatus;

      // "Tentative échouée" — stays out_for_delivery, only increments attempts.
      // Terminal orders (delivered/returned/cancelled) are final: a late,
      // out-of-order attempt event must not touch them.
      if (incrementAttempts) {
        if (tracking) {
          const order = await getOrderByTracking(db, tracking);
          if (order && !TERMINAL_ORDER_STATUSES.has(order.status)) {
            await incrementDeliveryAttempts(db, order.id);
            await updateWebhookEvent(db, webhookEventId, {
              result: "ignored", // not a status transition
              reason: reason ?? undefined,
              orderId: order.id,
              processedAt: now,
            });
            continue;
          }
          if (order) {
            await updateWebhookEvent(db, webhookEventId, {
              result: "ignored",
              reason: reason ?? undefined,
              orderId: order.id,
              processedAt: now,
            });
            continue;
          }
        }
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          reason: reason ?? undefined,
          processedAt: now,
        });
        continue;
      }

      // Regular status transition
      if (!tracking) {
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          processedAt: now,
        });
        continue;
      }

      const order = await getOrderByTracking(db, tracking);
      if (!order) {
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          processedAt: now,
        });
        continue;
      }

      const { updated } = await updateOrderStatusWebhook(
        db,
        order.id,
        nextStatus,
        "webhook:yalidine"
      );

      if (updated && shouldTriggerCapiPurchase(nextStatus, order.wilayaId)) {
        if (!c.env.CAPI_WORKFLOW) {
          console.error("[capi-workflow] CAPI_WORKFLOW binding is undefined — worker needs re-provision");
        } else {
          c.executionCtx.waitUntil(
            c.env.CAPI_WORKFLOW.create({
              id: getCapiWorkflowId(order.id, "delivered", "Purchase"),
              params: {
                orderId: order.id,
                eventName: "Purchase",
                stage: "delivered",
                triggeredAt: Math.floor(Date.now() / 1000),
                triggerStatus: nextStatus,
              },
            }).catch((err: unknown) => console.error("[capi-workflow] yalidine trigger failed:", (err as Error)?.message))
          );
        }
      }

      await updateWebhookEvent(db, webhookEventId, {
        result: updated ? "ok" : "ignored",
        newStatus: updated ? nextStatus : undefined,
        reason: reason ?? undefined,
        orderId: order.id,
        processedAt: now,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[webhook][yalidine] Event processing error:", errorMsg);
      await updateWebhookEvent(db, webhookEventId, {
        result: "error",
        errorMsg,
        processedAt: now,
      }).catch(() => {});
      
      throw new ExternalApiError(
        "yalidine",
        "Webhook processing failed",
        { webhookId: eventId, tracking, errorMsg }
      );
    }
  }

  return c.json({ received: true }, 200);
}

// ─── EcoTrack platform family (Packers, DHD, Conexlog, …) ─────────────────────

interface EcotrackStatePayload {
  event?: string;
  event_id?: string;
  occurred_at?: string;
  tracking?: string;
  state?: { id?: number; code?: string; title?: string };
  previous_state?: { id?: number; code?: string; title?: string } | null;
  order?: { amount?: number; tentatives_count?: number } | null;
  maj?: { type?: string; tentative_number?: number; raison?: string | null } | null;
}

/**
 * POST /webhooks/ecotrack
 *
 * Receives EcoTrack platform webhook deliveries (§2 of the Shipper
 * Integration Guide). One event per request; idempotency key is the
 * `X-ECOTRACK-Event-Id` ULID header (stable across the carrier's 6 retries).
 *
 * The webhook is registered by the shipper in their EcoTrack dashboard, so
 * the sender is identified by signature, not by URL: every *_ecotrack
 * company with a stored webhook_secret is a candidate and the first secret
 * whose HMAC matches the raw body wins. No secret configured anywhere →
 * fail-open with a warning (same contract as Yalidine). No candidate matches
 * → 400 (the carrier's docs retry non-2xx; a forged delivery must never
 * advance an order).
 *
 * order.state.* → forward-only status transition via updateOrderStatusWebhook.
 * order.maj.added → deliveryAttempts counter + reason, never a status change.
 */
export async function handleEcotrackWebhook(c: Context<AppContext>) {
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);

  let payload: EcotrackStatePayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[webhook][ecotrack] Failed to parse JSON body");
    throw new ValidationError(
      "Invalid JSON payload",
      ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
      { provider: "ecotrack" }
    );
  }

  const signature = c.req.header("x-ecotrack-signature") ?? null;
  const candidates = await listEcotrackCompaniesRaw(db);
  if (candidates.length === 0) {
    console.warn("[webhook][ecotrack] No *_ecotrack delivery company configured");
    return c.json({ received: true }, 200);
  }

  const secretHolders = candidates.filter((company) => company.webhookSecret);
  let company = candidates[0];
  if (secretHolders.length > 0) {
    let verified = false;
    for (const candidate of secretHolders) {
      if (await verifyEcotrackSignature(rawBody, signature, candidate.webhookSecret!)) {
        company = candidate;
        verified = true;
        break;
      }
    }
    if (!verified) {
      console.warn("[webhook][ecotrack] Signature verification failed");
      throw new ValidationError(
        "Invalid webhook signature",
        ERROR_CODES.INVALID_WEBHOOK_PAYLOAD,
        { provider: "ecotrack" }
      );
    }
  } else {
    console.warn(
      "[webhook][ecotrack] webhookSecret not set — accepting unverified events " +
      "(set the secret in the dashboard to enable verification)"
    );
  }

  const eventType =
    c.req.header("x-ecotrack-event") ?? payload.event ?? "unknown";
  const eventId =
    c.req.header("x-ecotrack-event-id") ?? payload.event_id ?? crypto.randomUUID();
  const tracking = payload.tracking ?? null;
  const now = new Date().toISOString();

  const { id: webhookEventId, isDuplicate } = await insertWebhookEvent(db, {
    provider: "ecotrack",
    eventId,
    companyId: company.id,
    tracking,
    eventType,
    rawPayload: rawBody,
  });

  if (isDuplicate) {
    return c.json({ received: true }, 200);
  }

  try {
    // ── Delivery attempts (order.maj.added) — counter + reason, no status ──
    if (eventType.startsWith("order.maj")) {
      const majType = payload.maj?.type ?? null;
      const mapping = mapEcotrackMajType(majType);

      if (mapping.incrementAttempts) {
        const order = tracking ? await getOrderByTracking(db, tracking) : null;
        if (order && !TERMINAL_ORDER_STATUSES.has(order.status)) {
          await incrementDeliveryAttempts(db, order.id);
        }
        const raison = payload.maj?.raison ?? null;
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored", // never a status transition
          reason: raison ? `${mapping.ar} — ${raison}` : mapping.ar,
          orderId: order?.id ?? undefined,
          processedAt: now,
        });
      } else {
        await updateWebhookEvent(db, webhookEventId, {
          result: mapping.noop ? "ignored" : "unmapped",
          reason: majType ?? undefined,
          processedAt: now,
        });
      }
      return c.json({ received: true }, 200);
    }

    // ── Status transitions (order.state.*) ──
    if (eventType.startsWith("order.state.")) {
      const code =
        payload.state?.code ?? eventType.slice("order.state.".length) ?? null;
      const mapping = mapEcotrackWebhookState(code);

      if (mapping.status === null || !isOrderStatus(mapping.status)) {
        await updateWebhookEvent(db, webhookEventId, {
          result: "unmapped",
          reason: code ?? undefined,
          processedAt: now,
        });
        return c.json({ received: true }, 200);
      }
      const nextStatus: OrderStatus = mapping.status;

      if (!tracking) {
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          reason: mapping.ar,
          processedAt: now,
        });
        return c.json({ received: true }, 200);
      }

      const order = await getOrderByTracking(db, tracking);
      if (!order) {
        await updateWebhookEvent(db, webhookEventId, {
          result: "ignored",
          reason: mapping.ar,
          processedAt: now,
        });
        return c.json({ received: true }, 200);
      }

      const { updated } = await updateOrderStatusWebhook(
        db,
        order.id,
        nextStatus,
        "webhook:ecotrack"
      );

      if (updated && shouldTriggerCapiPurchase(nextStatus, order.wilayaId)) {
        if (!c.env.CAPI_WORKFLOW) {
          console.error("[capi-workflow] CAPI_WORKFLOW binding is undefined — worker needs re-provision");
        } else {
          c.executionCtx.waitUntil(
            c.env.CAPI_WORKFLOW.create({
              id: getCapiWorkflowId(order.id, "delivered", "Purchase"),
              params: {
                orderId: order.id,
                eventName: "Purchase",
                stage: "delivered",
                triggeredAt: Math.floor(Date.now() / 1000),
                triggerStatus: nextStatus,
              },
            }).catch((err: unknown) => console.error("[capi-workflow] ecotrack trigger failed:", (err as Error)?.message))
          );
        }
      }

      await updateWebhookEvent(db, webhookEventId, {
        result: updated ? "ok" : "ignored",
        newStatus: updated ? nextStatus : undefined,
        reason: mapping.ar,
        orderId: order.id,
        processedAt: now,
      });
      return c.json({ received: true }, 200);
    }

    // Unknown event family — log and ignore
    await updateWebhookEvent(db, webhookEventId, {
      result: "ignored",
      reason: eventType,
      processedAt: now,
    });
    return c.json({ received: true }, 200);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[webhook][ecotrack] Processing error:", errorMsg);
    await updateWebhookEvent(db, webhookEventId, {
      result: "error",
      errorMsg,
      processedAt: now,
    }).catch(() => {});

    throw new ExternalApiError(
      "ecotrack",
      "Webhook processing failed",
      { webhookId: eventId, tracking, errorMsg }
    );
  }
}
