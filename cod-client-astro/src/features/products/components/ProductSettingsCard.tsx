import { Card, Field, Input, Select } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { ProductStatus } from "@/features/products/types";
import { PDP_TEMPLATE_OPTIONS, PDP_PALETTE_OPTIONS } from "@/features/products/pdp-options";

const STATUS_VALUES: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];

interface ProductSettingsCardProps {
  status: ProductStatus;
  setStatus: (status: ProductStatus) => void;
  inventory: string;
  setInventory: (val: string) => void;
  lowStockThreshold: string;
  setLowStockThreshold: (val: string) => void;
  trackInventory: boolean;
  setTrackInventory: (val: boolean) => void;
  showInStore: boolean;
  setShowInStore: (val: boolean) => void;
  freeShipping: boolean;
  setFreeShipping: (val: boolean) => void;
  /** Test-mode product: its orders land in the test orders view. */
  isTest: boolean;
  setIsTest: (val: boolean) => void;
  /** Product page template + color preset. */
  template: string;
  setTemplate: (val: string) => void;
  palette: string;
  setPalette: (val: string) => void;
  hasVariantsSwitch: boolean;
  editing: boolean;
  busy: boolean;
}

export function ProductSettingsCard({
  status,
  setStatus,
  inventory,
  setInventory,
  lowStockThreshold,
  setLowStockThreshold,
  trackInventory,
  setTrackInventory,
  showInStore,
  setShowInStore,
  freeShipping,
  setFreeShipping,
  isTest,
  setIsTest,
  template,
  setTemplate,
  palette,
  setPalette,
  hasVariantsSwitch,
  editing,
  busy,
}: ProductSettingsCardProps) {
  const t = useT("products");

  return (
    <Card title={t("form.section_settings")}>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("form.status_label")}>
          <Select
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as ProductStatus)
            }
            disabled={busy}
          >
            {STATUS_VALUES.map((option) => (
              <option key={option} value={option}>
                {t(`status_options.${option.toLocaleLowerCase()}`)}
              </option>
            ))}
          </Select>
        </Field>
        {!hasVariantsSwitch && !editing && (
          <Field label={t("form.initial_stock_label")}>
            <Input
              type="number"
              value={inventory}
              onChange={(event) => setInventory(event.currentTarget.value)}
              min={0}
              disabled={busy}
            />
          </Field>
        )}
        {!hasVariantsSwitch && (
          <Field label={t("form.threshold_label")}>
            <Input
              type="number"
              value={lowStockThreshold}
              onChange={(event) =>
                setLowStockThreshold(event.currentTarget.value)
              }
              min={0}
              disabled={busy}
            />
          </Field>
        )}
      </div>
      <div className="mt-5 border-t border-border pt-5">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("form.track_stock_label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("form.track_stock_hint")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={trackInventory}
            onChange={(event) =>
              setTrackInventory(event.currentTarget.checked)
            }
            disabled={busy}
            className="size-5 accent-primary"
          />
        </label>
      </div>
      <div className="mt-4">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("form.show_in_store_label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("form.show_in_store_hint")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={showInStore}
            onChange={(event) =>
              setShowInStore(event.currentTarget.checked)
            }
            disabled={busy}
            className="size-5 accent-primary"
          />
        </label>
      </div>
      <div className="mt-4">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("form.free_shipping_label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("form.free_shipping_hint")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={freeShipping}
            onChange={(event) =>
              setFreeShipping(event.currentTarget.checked)
            }
            disabled={busy}
            className="size-5 accent-primary"
          />
        </label>
      </div>
      <div className="mt-4">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("form.test_mode_label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("form.test_mode_hint")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={isTest}
            onChange={(event) => setIsTest(event.currentTarget.checked)}
            disabled={busy}
            className="size-5 accent-amber-500"
          />
        </label>
      </div>
      <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-foreground">
            {t("form.pdp_template_label")}
          </span>
          <Select
            value={template}
            onChange={(event) => setTemplate(event.currentTarget.value)}
            disabled={busy}
          >
            {PDP_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.slug} value={option.slug}>
                {t(`form.${option.labelKey}`)}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              `form.${
                PDP_TEMPLATE_OPTIONS.find((option) => option.slug === template)?.hintKey ??
                "pdp_template_default_hint"
              }`,
            )}
          </p>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-foreground">
            {t("form.pdp_palette_label")}
          </span>
          <Select
            value={palette}
            onChange={(event) => setPalette(event.currentTarget.value)}
            disabled={busy}
          >
            {PDP_PALETTE_OPTIONS.map((option) => (
              <option key={option.slug} value={option.slug}>
                {t(`form.${option.labelKey}`)}
              </option>
            ))}
          </Select>
          {(() => {
            const active = PDP_PALETTE_OPTIONS.find((option) => option.slug === palette);
            return active && active.swatch.length > 0 ? (
              <span className="mt-2 flex items-center gap-1.5">
                {active.swatch.map((color) => (
                  <span
                    key={color}
                    className="size-4 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("form.pdp_palette_hint")}</p>
            );
          })()}
        </label>
      </div>
    </Card>
  );
}
