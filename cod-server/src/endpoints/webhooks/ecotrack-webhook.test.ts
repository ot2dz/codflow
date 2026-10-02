/**
 * Integration tests for POST /webhooks/ecotrack (EcoTrack platform family).
 *
 * Follows the mock-db + mocked-queries pattern of webhooks.test.ts. The
 * status mapper runs REAL (it is pure); signature verification is mocked to
 * control which tenant's secret "matches" without live crypto.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { handleEcotrackWebhook } from "./handlers";

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  all: vi.fn(),
  get: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
} as any;

vi.mock("@/db", () => ({ getDb: vi.fn(() => mockDb) }));

vi.mock("@/endpoints/delivery-companies/queries", () => ({
  getDeliveryCompanyByCode: vi.fn(),
  listEcotrackCompaniesRaw: vi.fn(),
}));

vi.mock("./queries", () => ({
  insertWebhookEvent: vi.fn(),
  updateWebhookEvent: vi.fn(),
  getOrderByTracking: vi.fn(),
  getOrderByReference: vi.fn(),
}));

vi.mock("@/endpoints/orders/queries", () => ({
  updateOrderStatusWebhook: vi.fn(),
  incrementDeliveryAttempts: vi.fn(),
}));

vi.mock("./ecotrack-verify", () => ({ verifyEcotrackSignature: vi.fn() }));
vi.mock("./svix-verify", () => ({ verifySvixSignature: vi.fn() }));
vi.mock("./yalidine-verify", () => ({ verifyYalidineSignature: vi.fn() }));
vi.mock("./zr-status-mapper", () => ({
  mapZrStateName: vi.fn(),
  parseCustomMapping: vi.fn(),
}));
vi.mock("./yalidine-status-mapper", () => ({ mapYalidineStatus: vi.fn() }));

vi.mock("@/workflows/capi-helpers", () => ({
  shouldTriggerCapiPurchase: vi.fn().mockReturnValue(false),
  shouldTriggerCapiConfirmed: vi.fn().mockReturnValue(false),
  getCapiWorkflowId: vi.fn((id: string, stage: string, event: string) => `capi-${id}-${stage}-${event}`),
  resolveConversionForStage: vi.fn(() => ({ shouldFire: false })),
  resolveCapiDispatch: vi.fn(() => ({ send: false, reason: "tracking-disabled", message: "mock skip" })),
}));

import { listEcotrackCompaniesRaw } from "@/endpoints/delivery-companies/queries";
import {
  insertWebhookEvent,
  updateWebhookEvent,
  getOrderByTracking,
} from "./queries";
import {
  updateOrderStatusWebhook,
  incrementDeliveryAttempts,
} from "@/endpoints/orders/queries";
import { verifyEcotrackSignature } from "./ecotrack-verify";

const PACKERS = { id: "co-packers", code: "packers_ecotrack", name: "Packers", webhookSecret: "sec-packers" };
const DHD = { id: "co-dhd", code: "dhd_ecotrack", name: "DHD", webhookSecret: "sec-dhd" };
const NO_SECRET = { id: "co-x", code: "some_ecotrack", name: "NoSecret", webhookSecret: null };

function statePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "order.state.en_livraison",
    event_id: "01HWZQR3BKJGF5NVXMP4T8C6YE",
    occurred_at: "2026-05-12T10:30:00+01:00",
    tracking: "ECO-2026-000123",
    state: { id: 9, code: "EN_LIVRAISON", title: "En livraison" },
    previous_state: { id: 8, code: "EN_PREPARATION", title: "En préparation" },
    order: { amount: 2500, tentatives_count: 0 },
    ...overrides,
  });
}

describe("POST /webhooks/ecotrack", () => {
  let app: Hono<AppContext>;

  beforeEach(() => {
    app = new Hono<AppContext>();
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb } as any;
      await next();
    });
    app.onError(errorHandler);
    app.post("/webhooks/ecotrack", handleEcotrackWebhook);

    vi.clearAllMocks();
    vi.mocked(listEcotrackCompaniesRaw).mockResolvedValue([PACKERS, DHD] as any);
    vi.mocked(verifyEcotrackSignature).mockImplementation(async (_body, _h, secret) => secret === "sec-packers");
    vi.mocked(insertWebhookEvent).mockResolvedValue({ id: "we-1", isDuplicate: false });
    vi.mocked(updateWebhookEvent).mockResolvedValue(undefined);
  });

  async function post(body: string, headers: Record<string, string> = {}) {
    return app.request("/webhooks/ecotrack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ECOTRACK-Event": "order.state.en_livraison",
        "X-ECOTRACK-Event-Id": "01HWZQR3BKJGF5NVXMP4T8C6YE",
        "X-ECOTRACK-Signature": "sha256=deadbeef",
        ...headers,
      },
      body,
    });
  }

  it("rejects a delivery whose signature matches no tenant secret (400)", async () => {
    vi.mocked(verifyEcotrackSignature).mockResolvedValue(false);
    const res = await post(statePayload());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe(ERROR_CODES.INVALID_WEBHOOK_PAYLOAD);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
  });

  it("advances the order and attributes the event to the matched tenant", async () => {
    vi.mocked(getOrderByTracking).mockResolvedValue({ id: "o-1", status: "dispatched", wilayaId: 16 } as any);
    vi.mocked(updateOrderStatusWebhook).mockResolvedValue({ updated: true });

    const res = await post(statePayload());
    expect(res.status).toBe(200);

    expect(updateOrderStatusWebhook).toHaveBeenCalledWith(expect.anything(), "o-1", "out_for_delivery", "webhook:ecotrack");
    expect(insertWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "ecotrack", companyId: PACKERS.id, tracking: "ECO-2026-000123" })
    );
    expect(updateWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "we-1",
      expect.objectContaining({ result: "ok", newStatus: "out_for_delivery", orderId: "o-1" })
    );
    // Arabic label surfaced in the event feed
    const call = vi.mocked(updateWebhookEvent).mock.calls.at(-1)![2] as { reason?: string };
    expect(call.reason).toContain("خرج المندوب للتوصيل");
  });

  it("deduplicates the ULID across carrier retries (no double processing)", async () => {
    vi.mocked(insertWebhookEvent).mockResolvedValue({ id: "", isDuplicate: true });
    const res = await post(statePayload());
    expect(res.status).toBe(200);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
    expect(updateWebhookEvent).not.toHaveBeenCalled();
  });

  it("logs undocumented state codes as unmapped without touching the order", async () => {
    const res = await post(
      statePayload({
        event: "order.state.etat_fantome",
        state: { id: 99, code: "ETAT_FANTOME", title: "????" },
      }),
      { "X-ECOTRACK-Event": "order.state.etat_fantome" }
    );
    expect(res.status).toBe(200);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
    expect(updateWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "we-1",
      expect.objectContaining({ result: "unmapped" })
    );
  });

  it("order.maj.added increments attempts with the Arabic reason and no status change", async () => {
    vi.mocked(getOrderByTracking).mockResolvedValue({ id: "o-2", status: "out_for_delivery", wilayaId: 31 } as any);
    const majBody = JSON.stringify({
      event: "order.maj.added",
      event_id: "01HWZQR3BKJGF5NVXMP4T8C6YF",
      occurred_at: "2026-05-12T14:00:00+01:00",
      tracking: "ECO-2026-000123",
      maj: { type: "tentative_delayed", tentative_number: 2, raison: "Client absent", next_attempt_at: null },
      order: { amount: 2500, tentatives_count: 2 },
    });

    const res = await post(majBody, { "X-ECOTRACK-Event": "order.maj.added", "X-ECOTRACK-Event-Id": "01HWZQR3BKJGF5NVXMP4T8C6YF" });
    expect(res.status).toBe(200);
    expect(incrementDeliveryAttempts).toHaveBeenCalledWith(expect.anything(), "o-2");
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
    const call = vi.mocked(updateWebhookEvent).mock.calls.at(-1)![2] as { reason?: string; result?: string };
    expect(call.result).toBe("ignored");
    expect(call.reason).toContain("Client absent");
  });

  it("never increments attempts on a terminal order", async () => {
    vi.mocked(getOrderByTracking).mockResolvedValue({ id: "o-3", status: "delivered", wilayaId: 16 } as any);
    await post(
      JSON.stringify({
        event: "order.maj.added",
        event_id: "evt-late",
        tracking: "ECO-LATE",
        maj: { type: "tentative_added", tentative_number: 9, raison: null },
      }),
      { "X-ECOTRACK-Event": "order.maj.added", "X-ECOTRACK-Event-Id": "evt-late" }
    );
    expect(incrementDeliveryAttempts).not.toHaveBeenCalled();
  });

  it("ignores events whose tracking matches no order", async () => {
    vi.mocked(getOrderByTracking).mockResolvedValue(undefined);
    const res = await post(statePayload());
    expect(res.status).toBe(200);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
    expect(updateWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "we-1",
      expect.objectContaining({ result: "ignored" })
    );
  });

  it("fail-opens when NO tenant has a secret configured (mirrors Yalidine)", async () => {
    vi.mocked(listEcotrackCompaniesRaw).mockResolvedValue([NO_SECRET] as any);
    vi.mocked(getOrderByTracking).mockResolvedValue({ id: "o-4", status: "dispatched", wilayaId: 9 } as any);
    vi.mocked(updateOrderStatusWebhook).mockResolvedValue({ updated: true });

    const res = await post(statePayload());
    expect(res.status).toBe(200);
    expect(verifyEcotrackSignature).not.toHaveBeenCalled();
    expect(updateOrderStatusWebhook).toHaveBeenCalled();
    expect(insertWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: NO_SECRET.id })
    );
  });

  it("answers 200 received when no EcoTrack-family company exists", async () => {
    vi.mocked(listEcotrackCompaniesRaw).mockResolvedValue([]);
    const res = await post(statePayload());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true });
    expect(insertWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with INVALID_WEBHOOK_PAYLOAD", async () => {
    const res = await post("{not json", { "X-ECOTRACK-Signature": "sha256=whatever" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe(ERROR_CODES.INVALID_WEBHOOK_PAYLOAD);
  });
});
