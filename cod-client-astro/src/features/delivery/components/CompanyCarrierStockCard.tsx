import { useCallback, useEffect, useState } from "react";
import { Package, RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  getCarrierProducts,
  syncCarrierStock,
  updateDeliveryCompany,
} from "@/features/delivery/api";
import type { CarrierProduct, DeliveryCompany } from "@/features/delivery/types";

/**
 * Carrier-held stock (EcoTrack): a toggle that switches dispatch to `stock=1`
 * and a read-only mirror of the products the carrier holds. Display-only — the
 * sync never gates dispatch; the carrier itself refuses out-of-stock parcels.
 */
export function CompanyCarrierStockCard({
  company,
  canManage,
}: {
  company: DeliveryCompany;
  canManage: boolean;
}) {
  const t = useT("delivery_companies");
  const [products, setProducts] = useState<CarrierProduct[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stockFulfillment, setStockFulfillment] = useState(company.stockFulfillment);
  const [savingToggle, setSavingToggle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCarrierProducts(company.id);
      setProducts(res.products);
      setSyncedAt(res.syncedAt);
    } catch {
      setProducts([]);
      setSyncedAt(null);
    } finally {
      setLoading(false);
    }
  }, [company.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setStockFulfillment(company.stockFulfillment);
  }, [company.id, company.stockFulfillment]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncCarrierStock(company.id);
      notify.success(`${t("carrier_stock_synced")} — ${res.total}`);
      await load();
    } catch {
      notify.error(t("error_saving"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggle() {
    const next = !stockFulfillment;
    const previous = stockFulfillment;
    setStockFulfillment(next);
    setSavingToggle(true);
    try {
      await updateDeliveryCompany(company.id, { stockFulfillment: next });
      notify.success(next ? t("stock_fulfillment_on") : t("stock_fulfillment_off"));
    } catch {
      setStockFulfillment(previous);
      notify.error(t("error_saving"));
    } finally {
      setSavingToggle(false);
    }
  }

  return (
    <Card
      title={t("carrier_stock_title")}
      subtitle={t("carrier_stock_subtitle")}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleSync()}
          disabled={syncing || !company.isConnected}
        >
          <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
          {t("carrier_stock_refresh")}
        </Button>
      }
    >
      <div className="space-y-4">
        {canManage && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3">
            <span className="min-w-0">
              <span className="block text-sm font-bold text-foreground">
                {t("stock_fulfillment_title")}
              </span>
              <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
                {t("stock_fulfillment_hint")}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={stockFulfillment}
              onClick={() => void handleToggle()}
              disabled={savingToggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                stockFulfillment ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                  stockFulfillment ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        )}

        {loading ? (
          <div role="status" aria-busy="true" className="space-y-2">
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <Package size={22} className="text-muted-foreground/50" />
            <p className="text-sm font-semibold text-foreground">{t("carrier_stock_empty")}</p>
            <p className="text-xs text-muted-foreground">{t("carrier_stock_empty_hint")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  <th className="px-2 py-2 text-start font-bold">{t("carrier_stock_col_reference")}</th>
                  <th className="px-2 py-2 text-start font-bold">{t("carrier_stock_col_title")}</th>
                  <th className="px-2 py-2 text-end font-bold">{t("carrier_stock_col_available")}</th>
                  <th className="px-2 py-2 text-end font-bold">{t("carrier_stock_col_reserved")}</th>
                  <th className="px-2 py-2 text-end font-bold">{t("carrier_stock_col_physical")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-2 py-2 font-mono text-xs text-foreground">{p.reference}</td>
                    <td className="px-2 py-2 text-foreground">{p.title ?? "—"}</td>
                    <td className="px-2 py-2 text-end">
                      <Badge tone={p.stockDisponible > 0 ? "success" : "critical"}>{p.stockDisponible}</Badge>
                    </td>
                    <td className="px-2 py-2 text-end text-muted-foreground">{p.stockReserve}</td>
                    <td className="px-2 py-2 text-end text-muted-foreground">{p.stockPhysique}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {syncedAt && (
              <p className="mt-3 text-end text-[11px] font-medium text-muted-foreground/70">
                {t("carrier_stock_synced_at")}: {new Date(syncedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
