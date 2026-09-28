import { describe, expect, it, vi } from "vitest";
import config from "../../astro.config.mjs";

type VitePlugin = {
  name?: string;
  configureServer?: (server: unknown) => (() => void) | void;
};

type Middleware = (request: { url: string; originalUrl?: string }, response: unknown, next: () => void) => void;

const plugins = (Array.isArray(config.vite?.plugins) ? config.vite.plugins : [config.vite?.plugins]) as unknown[];
const fallback = plugins.find(
  (plugin): plugin is VitePlugin =>
    typeof plugin === "object" &&
    plugin !== null &&
    (plugin as { name?: unknown }).name === "order-detail-static-fallback",
);

function getFallbackMiddleware(): Middleware {
  if (!fallback) throw new Error("order detail fallback plugin is missing");
  const stack = [{ route: "", handle: { name: "devBaseMiddleware" } }];
  const server = { middlewares: { stack } };
  const postHook = fallback.configureServer?.(server);
  postHook?.();
  return stack[1].handle as Middleware;
}

describe("order detail static fallback", () => {
  it("rewrites the request and original URL for dynamic order pages", () => {
    const middleware = getFallbackMiddleware();
    const request = { url: "/orders/e5ee4d99-82d5-4ab3-b3ac-1f84765b5c00" };
    const next = vi.fn();

    middleware(request, {}, next);

    expect(request).toEqual({ url: "/", originalUrl: "/" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves static dashboard routes unchanged", () => {
    const middleware = getFallbackMiddleware();
    const request = { url: "/orders" };
    const next = vi.fn();

    middleware(request, {}, next);

    expect(request).toEqual({ url: "/orders" });
    expect(next).toHaveBeenCalledOnce();
  });
});
