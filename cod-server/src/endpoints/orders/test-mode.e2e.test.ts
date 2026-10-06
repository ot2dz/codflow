/**
 * Test-mode (product validation) — real D1 (E2E)
 *
 * Covers the promise of the feature:
 *   - a test order can be promoted to a live order (same row, history kept)
 *   - promotion refuses the cases that would corrupt data (not a test order,
 *     already dispatched, terminal status)
 *   - live analytics exclude test orders unless explicitly asked
 *
 * The dispatch/driver guards for test orders are covered by the mocked
 * handler tests in orders.test.ts (ORDER_IN_TEST_MODE).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { promoteTestOrders } from "../../../../cod-shared/queries/orders";
import { getOrderStatusStats } from "../../../../cod-shared/queries/analytics";

let db: AppDb;
const registry: Miniflare[] = [];

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  const d1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const preparedStatements: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) preparedStatements.push(d1.prepare(statement));
  }
  for (let i = 0; i < preparedStatements.length; i += 50) {
    await d1.batch(preparedStatements.slice(i, i + 50));
  }
  db = drizzle(d1 as unknown as D1Database, { schema }) as unknown as AppDb;
  registry.push(mf);
}, 120_000);

afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

let seedCounter = 0;

async function seedOrder(opts: {
  id: string;
  status?: (typeof schema.orders.$inferSelect)["status"];
  isTest?: boolean;
  tracking?: string | null;
}) {
  const now = new Date().toISOString();
  const { id } = opts;
  seedCounter += 1;
  await db.insert(schema.customers).values({
    id: `cust-${id}`,
    name: "Test Customer",
    phone: `0666${String(seedCounter).padStart(6, "0")}`,
    wilaya: "الجزائر",
    totalOrders: 1,
    totalSpent: 1500,
    createdAt: now,
  });
  await db.insert(schema.orders).values({
    id,
    orderNumber: `ORD-${id}`,
    customerId: `cust-${id}`,
    customerName: "Test Customer",
    phone: "0555000001",
    price: 1500,
    status: opts.status ?? "new",
    deliveryMethod: "unassigned",
    deliveryType: "home",
    deliveryFee: 0,
    driverFee: 0,
    codAmount: 1500,
    isTest: opts.isTest ?? true,
    trackingNumber: opts.tracking ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("test-mode orders — promotion", () => {
  it("promotes a new test order on the same row and records the audit entry", async () => {
    await seedOrder({ id: "t-new", status: "new" });

    const result = await promoteTestOrders(db, ["t-new"]);

    expect(result.promoted).toEqual(["t-new"]);
    expect(result.refused).toEqual([]);

    const row = await db.select().from(schema.orders).where(eq(schema.orders.id, "t-new")).get();
    expect(row!.isTest).toBe(false);
    expect(row!.status).toBe("new");
    expect(row!.customerName).toBe("Test Customer");

    const history = await db
      .select()
      .from(schema.orderStatusHistory)
      .where(eq(schema.orderStatusHistory.orderId, "t-new"))
      .all();
    expect(history.some((h) => h.by === "test-promotion")).toBe(true);
  });

  it("refuses live orders, dispatched orders and terminal statuses — with reasons", async () => {
    await seedOrder({ id: "t-live", isTest: false });
    await seedOrder({ id: "t-dispatched", status: "dispatched", tracking: "TRK-1" });
    await seedOrder({ id: "t-cancelled", status: "cancelled" });

    const result = await promoteTestOrders(db, [
      "t-live",
      "t-dispatched",
      "t-cancelled",
      "missing-id",
    ]);

    expect(result.promoted).toEqual([]);
    expect(result.refused).toEqual(
      expect.arrayContaining([
        { orderId: "t-live", reason: "not_test" },
        { orderId: "t-dispatched", reason: "already_dispatched" },
        { orderId: "t-cancelled", reason: "terminal_status" },
        { orderId: "missing-id", reason: "not_found" },
      ]),
    );

    // Nothing changed for the refused rows.
    const dispatched = await db.select().from(schema.orders).where(eq(schema.orders.id, "t-dispatched")).get();
    expect(dispatched!.isTest).toBe(true);
  });
});

describe("test-mode orders — analytics isolation", () => {
  it("excludes test orders from live status stats unless includeTest is set", async () => {
    await seedOrder({ id: "t-stat-test1", status: "confirmed", isTest: true });
    await seedOrder({ id: "t-stat-test2", status: "confirmed", isTest: true });
    await seedOrder({ id: "t-stat-live", status: "confirmed", isTest: false });

    const live = await getOrderStatusStats(db);
    const confirmedLive = live.find((r) => r.status === "confirmed")?.count ?? 0;

    const withTest = await getOrderStatusStats(db, { includeTest: true });
    const confirmedAll = withTest.find((r) => r.status === "confirmed")?.count ?? 0;

    expect(confirmedAll).toBe(confirmedLive + 2);
  });
});
