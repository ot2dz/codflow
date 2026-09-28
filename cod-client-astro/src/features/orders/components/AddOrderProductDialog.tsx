import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { addOrderProduct } from "@/features/orders/api";
import { formatMoney } from "@/features/orders/model";
import { listAllProducts } from "@/features/products/api";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";

/**
 * Adds one product line to an existing order — the same product's other variant
 * or a different product entirely. The price defaults to the catalog and can be
 * overridden; the server recomputes the order total, COD, and stock.
 */
export function AddOrderProductDialog({
  orderId,
  orderNumber,
  onClose,
  onChanged,
  onError,
}: {
  orderId: string;
  orderNumber: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT("orders");
  const common = useT("common");
  const locale = useLocale();
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof listAllProducts>> | null
  >(null);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listAllProducts()
      .then((rows) => {
        if (alive) setProducts(rows);
      })
      .catch((cause) => {
        if (alive) {
          setProducts([]);
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedProduct = useMemo(
    () => products?.find((product) => product.id === productId),
    [products, productId],
  );
  const variants =
    selectedProduct?.variants.filter((variant) => variant.active) ?? [];
  const selectedVariant = variants.find((variant) => variant.id === variantId);

  const catalogPrice = selectedVariant?.price ?? selectedProduct?.price ?? 0;

  const stock = selectedVariant?.inventory ?? selectedProduct?.totalInventory ?? 0;
  const canAdd =
    Boolean(selectedProduct) &&
    (variants.length === 0 || Boolean(selectedVariant)) &&
    quantity >= 1;

  function pickProduct(id: string) {
    setProductId(id);
    setVariantId("");
    const product = products?.find((entry) => entry.id === id);
    setPricePerUnit(product ? String(product.price) : "");
  }

  function pickVariant(id: string) {
    setVariantId(id);
    const variant = variants.find((entry) => entry.id === id);
    if (variant) setPricePerUnit(String(variant.price));
  }

  async function submit() {
    if (!canAdd) return;
    setBusy(true);
    try {
      await addOrderProduct(orderId, {
        productId,
        variantId: variantId || null,
        quantity,
        pricePerUnit: pricePerUnit === "" ? undefined : Number(pricePerUnit),
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(t("detail.add_product_error"));
      setBusy(false);
      return;
    }
    notify.success(t("detail.add_product_success"));
    try {
      await onChanged();
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("detail.add_product")} onClose={onClose}>
      <p className="mb-4 text-xs font-medium text-muted-foreground">
        {orderNumber}
      </p>
      {products === null ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("form.select_product")}>
            <Select
              value={productId}
              searchable
              searchPlaceholder={t("form.select_product")}
              noResultsText={common("no_results_found")}
              onChange={(event) => pickProduct(event.currentTarget.value)}
            >
              <option value="">{t("form.select_product")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {formatMoney(product.price, locale)}
                </option>
              ))}
            </Select>
          </Field>

          {variants.length > 0 && (
            <Field label={t("form.select_variation")}>
              <Select
                value={variantId}
                onChange={(event) => pickVariant(event.currentTarget.value)}
              >
                <option value="">{t("form.select_variation")}</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {Object.values(variant.variations).join(" / ")} ·{" "}
                    {formatMoney(variant.price, locale)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("form.quantity_label")}>
              <Input
                type="number"
                min="1"
                value={String(quantity)}
                onChange={(event) =>
                  setQuantity(
                    Math.max(1, Math.round(Number(event.currentTarget.value) || 1)),
                  )
                }
              />
            </Field>
            <Field label={t("lines.unit_price")}>
              <Input
                type="number"
                min="0"
                value={pricePerUnit}
                placeholder={String(catalogPrice)}
                onChange={(event) => setPricePerUnit(event.currentTarget.value)}
              />
            </Field>
          </div>

          {selectedProduct?.trackInventory &&
            (variants.length === 0 || selectedVariant) && (
              <p
                className={`rounded-lg border p-3 text-xs font-medium ${
                  stock - quantity < 0
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}
              >
                {t("form.current_stock")}: {stock} · {t("form.remaining_stock")}:{" "}
                {stock - quantity}
                {stock - quantity < 0 && ` · ${t("form.insufficient_stock")}`}
              </p>
            )}

          <Button
            type="button"
            className="w-full"
            disabled={busy || !canAdd}
            onClick={() => void submit()}
          >
            <Plus size={16} />
            {busy ? t("form.saving") : t("form.add_product")}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
