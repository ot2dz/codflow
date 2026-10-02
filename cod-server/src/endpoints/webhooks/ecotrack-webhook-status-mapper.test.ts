/**
 * Unit tests for the EcoTrack webhook status mapper.
 *
 * Drift guard: every order.state.* code documented in the Shipper
 * Integration Guide v1.0 §4.1 must be present and map to a valid CodFlow
 * OrderStatus. Unknown values must surface as unmapped — never guessed.
 */

import { describe, it, expect } from "vitest";
import {
  ECOTRACK_STATE_MAP,
  ECOTRACK_MAJ_MAP,
  mapEcotrackWebhookState,
  mapEcotrackMajType,
} from "./ecotrack-status-mapper";
import { ORDER_STATUSES } from "../orders/validation";

/** The 22 documented PartenaireState codes (§4.1), lowercased. */
const DOCUMENTED_STATES = [
  "pret_a_expedier",
  "pret_a_preparer",
  "en_ramassage",
  "stock_en_preparation",
  "vers_hub",
  "en_hub",
  "vers_wilaya",
  "en_preparation",
  "en_livraison",
  "suspendus",
  "retours_en_traitement",
  "retours_chez_livreur",
  "retours_prets",
  "retours_recu",
  "retours_a_dispatcher_vers_stock",
  "retours_en_transit_stock",
  "retours_en_stock",
  "livre_non_encaisse",
  "livre_encaisse_non_paye",
  "paiement_pret",
  "retours_archived",
  "paiement_archived",
];

describe("ecotrack-status-mapper — order.state.* codes", () => {
  it("covers every documented state code (drift guard)", () => {
    const missing = DOCUMENTED_STATES.filter((code) => !(code in ECOTRACK_STATE_MAP));
    expect(missing).toEqual([]);
  });

  it("maps every documented code to a valid OrderStatus", () => {
    for (const code of DOCUMENTED_STATES) {
      const mapping = ECOTRACK_STATE_MAP[code];
      expect(mapping).toBeDefined();
      expect(ORDER_STATUSES).toContain(mapping.status);
      expect(mapping.incrementAttempts).toBe(false);
      expect(mapping.ar.length).toBeGreaterThan(0);
    }
  });

  it("maps the semantic anchors correctly", () => {
    expect(mapEcotrackWebhookState("EN_LIVRAISON").status).toBe("out_for_delivery");
    expect(mapEcotrackWebhookState("en_livraison").status).toBe("out_for_delivery");
    expect(mapEcotrackWebhookState("LIVRE_NON_ENCAISSE").status).toBe("delivered");
    expect(mapEcotrackWebhookState("retours_recu").status).toBe("returned");
    expect(mapEcotrackWebhookState("VERS_WILAYA").status).toBe("dispatched");
    expect(mapEcotrackWebhookState("SUSPENDUS").status).toBe("unreachable");
  });

  it("surfaces unknown codes as unmapped (status null, noop false)", () => {
    const mapping = mapEcotrackWebhookState("ETAT_FANTOME_99");
    expect(mapping.status).toBeNull();
    expect(mapping.noop).toBe(false);
    expect(mapEcotrackWebhookState(null).status).toBeNull();
    expect(mapEcotrackWebhookState(undefined).noop).toBe(false);
  });
});

describe("ecotrack-status-mapper — order.maj.* types", () => {
  it("records both documented attempt types as attempt increments", () => {
    expect(mapEcotrackMajType("tentative_added").incrementAttempts).toBe(true);
    expect(mapEcotrackMajType("tentative_delayed").incrementAttempts).toBe(true);
  });

  it("never treats a MAJ as a status transition", () => {
    for (const type of Object.keys(ECOTRACK_MAJ_MAP)) {
      expect(ECOTRACK_MAJ_MAP[type].status).toBeNull();
    }
  });

  it('logs the documented "unknown" type as a deliberate no-op', () => {
    const mapping = mapEcotrackMajType("unknown");
    expect(mapping.noop).toBe(true);
    expect(mapping.incrementAttempts).toBe(false);
  });

  it("surfaces undocumented maj types as unmapped", () => {
    const mapping = mapEcotrackMajType("colis_perdu");
    expect(mapping.noop).toBe(false);
    expect(mapping.incrementAttempts).toBe(false);
    expect(mapping.status).toBeNull();
  });
});
