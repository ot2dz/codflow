import { apiFetch } from "@/lib/api";

export interface UploadedImage {
  key: string;
  url: string;
}

/**
 * Upload an image through the cod-server proxy (`POST /api/images/upload`),
 * which writes to R2 via the Worker binding and returns a public `/images/<key>`
 * URL. Used instead of the S3 presign flow so uploads work without R2 API
 * credentials; the 10 MB cap is enforced server-side.
 */
export async function uploadImageFile(
  file: File,
  folder: "products" | "landing" = "products",
): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  return (
    await apiFetch<{ success: boolean; data: UploadedImage }>("/api/images/upload", {
      method: "POST",
      body: form,
    })
  ).data;
}
