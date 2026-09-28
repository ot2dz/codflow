import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { uploadImageFile } from "./upload";

describe("uploadImageFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({
      success: true,
      data: { key: "landing/x.jpg", url: "https://api.test/images/landing/x.jpg" },
    });
  });

  it("POSTs multipart FormData with the file and folder", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", {
      type: "image/jpeg",
    });

    const result = await uploadImageFile(file, "landing");

    expect(result).toEqual({
      key: "landing/x.jpg",
      url: "https://api.test/images/landing/x.jpg",
    });
    const [path, init] = seam.apiFetch.mock.calls[0];
    expect(path).toBe("/api/images/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("folder")).toBe("landing");
    expect(((init.body as FormData).get("file") as File).name).toBe("photo.jpg");
  });
});
