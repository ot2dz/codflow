import { describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./types";

describe("worker entrypoint", () => {
  it("serves local HTTP development without the MCP OAuth provider", async () => {
    const waitUntil = vi.fn();
    const response = await worker.fetch(
      new Request("http://localhost:8787/health"),
      {
        ENVIRONMENT: "development",
        WORKER_SELF_URL: "http://localhost:8787/",
      } as Env,
      {
        waitUntil,
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
