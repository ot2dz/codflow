import { describe, expect, it } from "vitest";
import config from "./astro.config.mjs";

describe("Astro SSR dependency optimizer", () => {
  it("keeps astro/zod outside SSR optimization", () => {
    expect(config.vite?.environments?.ssr?.optimizeDeps?.exclude).toContain("astro/zod");
  });
});
