import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import {
  listCommunes,
  listWilayas,
  updateOrder,
} from "@/features/orders/api";
import type { UpdateOrderBody } from "@/features/orders/api";
import { formatMoney } from "@/features/orders/model";
import { listAllProducts } from "@/features/products/api";
import type { Commune, OrderDetail, Wilaya } from "@/features/orders/types";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

type OrderForEdit = Pick<
  OrderDetail,
  | "id"
  | "orderNumber"
  | "customerName"
  | "phone"
  | "wilayaId"
  | "wilaya"
  | "communeId"
  | "address"
  | "deliveryType"
  | "notes"
  | "price"
  | "deliveryFee"
  | "products"
>;

interface LineDraft {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  pricePerUnit: number;
}

const PHONE_RE = /^0[5-7]\d{8}$/;

export function EditOrderDialog({
  order,
  onClose,
  onChanged,
  onError,
}: {
  order: OrderForEdit;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT("orders");
  const common = useT("common");
  const locale = useLocale();

  const lines = order.products ?? [];
  const singleLine = lines.length <= 1;

  const [customerName, setCustomerName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.phone);
  const [wilayaId, setWilayaId] = useState(
    order.wilayaId ? String(order.wilayaId) : "",
  );
  const [communeId, setCommuneId] = useState(order.communeId ?? "");
  const [address, setAddress] = useState(order.address ?? "");
  const [deliveryType, setDeliveryType] = useState<"home" | "stop_desk">(
    order.deliveryType,
  );
  const [notes, setNotes] = useState(order.notes ?? "");
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>(() =>
    lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      variantId: line.variantId,
      productName: line.productName,
      variantLabel: line.variantLabel,
      quantity: line.quantity,
      pricePerUnit: line.pricePerUnit,
    })),
  );
  const [totalInput, setTotalInput] = useState(() => {
    const sole = lines[0];
    return String(
      sole
        ? sole.quantity * sole.pricePerUnit + order.deliveryFee
        : order.deliveryFee,
    );
  });
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof listAllProducts>> | null
  >(null);

  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loadingCommunes, setLoadingCommunes] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listWilayas()
      .then((rows) => {
        if (alive) setWilayas(rows);
      })
      .catch(() => {
        if (alive) setWilayas([]);
      });
    listAllProducts()
      .then((rows) => {
        if (alive) setProducts(rows);
      })
      .catch(() => {
        if (alive) setProducts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Communes follow the selected wilaya. The order's own commune is kept only
  // while it still belongs to the selected wilaya — changing wilaya clears it,
  // forcing a valid pick (the server rejects a cross-wilaya commune).
  useEffect(() => {
    if (!wilayaId) {
      setCommunes([]);
      setCommuneId("");
      return;
    }
    let alive = true;
    setLoadingCommunes(true);
    listCommunes(Number(wilayaId))
      .then((rows) => {
        if (!alive) return;
        setCommunes(rows);
        setCommuneId((prev) =>
          prev && rows.some((commune) => commune.id === prev) ? prev : "",
        );
      })
      .catch(() => {
        if (alive) setCommunes([]);
      })
      .finally(() => {
        if (alive) setLoadingCommunes(false);
      });
    return () => {
      alive = false;
    };
  }, [wilayaId]);

  const feeWillChange =
    (order.wilayaId ?? null) !== (wilayaId ? Number(wilayaId) : null) ||
    order.deliveryType !== deliveryType;

  const linesSubtotal = useMemo(
    () => lineDrafts.reduce((sum, line) => sum + line.quantity * line.pricePerUnit, 0),
    [lineDrafts],
  );

  function variantsFor(productId: string) {
    const product = products?.find((entry) => entry.id === productId);
    return product?.variants.filter((variant) => variant.active) ?? [];
  }

  function syncTotal(next: LineDraft[]) {
    if (next.length === 1) {
      setTotalInput(String(next[0].quantity * next[0].pricePerUnit + order.deliveryFee));
    }
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLineDrafts((current) => {
      const next = current.map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      );
      syncTotal(next);
      return next;
    });
  }

  function changeLineProduct(id: string, productId: string) {
    const product = products?.find((entry) => entry.id === productId);
    if (!product) return;
    updateLine(id, {
      productId,
      variantId: null,
      productName: product.name,
      variantLabel: null,
      pricePerUnit: product.price,
    });
  }

  function changeLineVariant(id: string, variantId: string) {
    setLineDrafts((current) => {
      const line = current.find((entry) => entry.id === id);
      if (!line) return current;
      const variant = variantsFor(line.productId).find(
        (entry) => entry.id === variantId,
      );
      const next = current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              variantId: variantId || null,
              variantLabel: variant
                ? Object.values(variant.variations).join(" / ")
                : null,
              pricePerUnit: variant ? variant.price : entry.pricePerUnit,
            }
          : entry,
      );
      syncTotal(next);
      return next;
    });
  }

  function changeTotal(value: string) {
    setTotalInput(value);
    const sole = lineDrafts[0];
    if (!sole) return;
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return;
    setLineDrafts((current) =>
      current.map((line) =>
        line.id === sole.id
          ? {
              ...line,
              pricePerUnit:
                line.quantity > 0
                  ? Math.max(0, numeric - order.deliveryFee) / line.quantity
                  : line.pricePerUnit,
            }
          : line,
      ),
    );
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!customerName.trim()) next.customerName = t("form.error_customer_name");
    if (!phone.trim()) next.phone = t("form.error_phone");
    else if (!PHONE_RE.test(phone.trim()))
      next.phone = t("form.error_invalid_phone");
    if (!wilayaId) next.wilayaId = t("form.error_wilaya");
    if (!communeId) next.communeId = t("form.error_commune");
    if (singleLine) {
      if (lineDrafts[0] && lineDrafts[0].quantity < 1)
        next.quantity = t("form.error_quantity");
      if (Number(totalInput) < order.deliveryFee)
        next.total = t("form.error_total_below_fee");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setBusy(true);

    const body: UpdateOrderBody = {
      customerName: customerName.trim(),
      phone: phone.trim(),
      wilayaId: Number(wilayaId),
      communeId,
      address: address.trim() || null,
      deliveryType,
      notes: notes.trim() || null,
      products: lineDrafts.map((line) => ({
        id: line.id,
        productId: line.productId,
        variantId: line.variantId,
        quantity: Math.max(1, Math.round(line.quantity)),
        pricePerUnit: Math.max(0, line.pricePerUnit),
      })),
    };

    try {
      await updateOrder(order.id, body);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(t("detail.edit_order_error"));
      setBusy(false);
      return;
    }
    notify.success(t("detail.edit_order_success"));
    try {
      await onChanged();
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function renderLine(line: LineDraft) {
    const variants = variantsFor(line.productId);
    return (
      <div key={line.id} className="rounded-xl border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("form.select_product")}>
            <Select
              value={line.productId}
              searchable
              searchPlaceholder={t("form.select_product")}
              noResultsText={common("no_results_found")}
              onChange={(event) =>
                changeLineProduct(line.id, event.currentTarget.value)
              }
            >
              {products?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {formatMoney(product.price, locale)}
                </option>
              ))}
            </Select>
          </Field>
          {variants.length > 0 && (
            <Field label={t("form.select_variation")}>
              <Select
                value={line.variantId ?? ""}
                onChange={(event) =>
                  changeLineVariant(line.id, event.currentTarget.value)
                }
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
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t("form.quantity_label")}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={String(line.quantity)}
              onChange={(event) =>
                updateLine(line.id, {
                  quantity: Math.max(
                    1,
                    Math.round(Number(event.currentTarget.value) || 1),
                  ),
                })
              }
            />
          </Field>
          <Field label={t("lines.unit_price")}>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={String(line.pricePerUnit)}
              onChange={(event) =>
                updateLine(line.id, {
                  pricePerUnit: Math.max(0, Number(event.currentTarget.value) || 0),
                })
              }
            />
          </Field>
          <Field label={t("lines.line_total")}>
            <p className="rounded-lg bg-muted px-3 py-2 text-sm font-bold tabular-nums">
              {formatMoney(line.quantity * line.pricePerUnit, locale)}
            </p>
          </Field>
        </div>
      </div>
    );
  }

  return (
    <Dialog title={t("detail.edit_order_title")} onClose={onClose}>
      <p className="mb-4 text-xs font-medium text-muted-foreground">
        {order.orderNumber}
      </p>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.customer_name_label")} error={errors.customerName}>
            <Input
              value={customerName}
              onChange={(event) => setCustomerName(event.currentTarget.value)}
              placeholder={t("form.customer_name_placeholder")}
              maxLength={100}
            />
          </Field>
          <Field label={t("form.phone_label")} error={errors.phone}>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              placeholder={t("form.phone_placeholder")}
              inputMode="tel"
              dir="ltr"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.wilaya_label")} error={errors.wilayaId}>
            <Select
              value={wilayaId}
              onChange={(event) => setWilayaId(event.currentTarget.value)}
            >
              <option value="">{t("form.wilaya_placeholder")}</option>
              {wilayas.map((wilaya) => (
                <option key={wilaya.id} value={wilaya.id}>
                  {locale === "ar" ? wilaya.nameAr : wilaya.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.commune_label")} error={errors.communeId}>
            {!wilayaId ? (
              <Select value="" disabled>
                <option value="">{t("form.commune_placeholder")}</option>
              </Select>
            ) : loadingCommunes ? (
              <p
                role="status"
                className="rounded-lg bg-muted p-3 text-sm text-muted-foreground"
              >
                {t("form.commune_loading")}
              </p>
            ) : (
              <Select
                value={communeId}
                searchable
                searchPlaceholder={t("form.commune_search_placeholder")}
                noResultsText={t("form.commune_no_results")}
                onChange={(event) => {
                  setCommuneId(event.currentTarget.value);
                  setErrors((prev) => ({ ...prev, communeId: "" }));
                }}
              >
                <option value="">{t("form.commune_placeholder")}</option>
                {communes.map((commune) => (
                  <option key={commune.id} value={commune.id}>
                    {locale === "ar" ? commune.nameAr : commune.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label={t("form.address_label")}>
          <Textarea
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder={t("form.address_placeholder")}
            maxLength={300}
          />
        </Field>

        <Field label={t("form.delivery_type_label")}>
          <Select
            value={deliveryType}
            onChange={(event) =>
              setDeliveryType(
                event.currentTarget.value === "stop_desk" ? "stop_desk" : "home",
              )
            }
          >
            <option value="home">{t("form.delivery_type_home")}</option>
            <option value="stop_desk">{t("form.delivery_type_desk")}</option>
          </Select>
        </Field>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">
            {t("form.products_section")}
          </p>
          {lineDrafts.map((line) => renderLine(line))}
        </div>

        {singleLine ? (
          <Field label={t("table.total")} error={errors.total}>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={totalInput}
              onChange={(event) => changeTotal(event.currentTarget.value)}
            />
          </Field>
        ) : (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-medium text-muted-foreground">
            {t("form.products_subtotal")}{" "}
            <span className="font-bold tabular-nums text-foreground">
              {formatMoney(linesSubtotal, locale)}
            </span>
            {" · "}
            {t("table.total")}{" "}
            <span className="font-bold tabular-nums text-foreground">
              {formatMoney(linesSubtotal + order.deliveryFee, locale)}
            </span>
          </p>
        )}

        <Field label={t("form.notes_label")}>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            maxLength={500}
          />
        </Field>

        {feeWillChange && (
          <p
            role="note"
            className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-medium text-muted-foreground"
          >
            {t("detail.edit_order_fee_note")}
          </p>
        )}

        <Button
          type="button"
          className="w-full"
          disabled={busy}
          onClick={() => void submit()}
        >
          <Save size={16} />
          {busy ? t("form.saving") : t("detail.edit_order_save")}
        </Button>
      </div>
    </Dialog>
  );
}
