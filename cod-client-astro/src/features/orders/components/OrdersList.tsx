import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUpCircle, Calendar, Check, Filter, PackageOpen, Trash2, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import {
  bulkDeleteOrders,
  bulkUpdateOrderStatus,
  listAllOrders,
  listDeliveryCompanies,
  listDrivers,
  promoteOrders,
} from "@/features/orders/api";
import {
  BULK_STATUS_TARGETS,
  FILTER_STATUSES,
  ORDER_GROUPS,
  allVisibleSelected,
  filterOrders,
  groupDuplicateOrders,
  orderGroupCounts,
  paginateOrders,
  pruneSelection,
  sortOrders,
  toggleUnitSelection,
  toggleVisibleSelection,
  unitSelected,
  type OrderFilters,
  type OrderGroupKey,
  type OrderSortKey,
  type OrderUnit,
} from "@/features/orders/model";
import type {
  DeliveryCompany,
  Driver,
  OrderListItem,
  OrderStatus,
} from "@/features/orders/types";
import {
  Button,
  EmptyState,
  LinkButton,
  Alert,
  Card,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  SortHeader,
  useConfirmDialog,
} from "@/components/ui";
import { OrderDesktopRow, OrderMobileCard } from "@/features/orders/components/OrderRow";
import { WhatsAppTemplateSettings } from "@/features/orders/components/WhatsAppTemplateSettings";

const EMPTY_FILTERS: OrderFilters = {
  query: "",
  status: "all",
  delivery: "all",
  wilaya: "all",
  type: "all",
  dateFrom: "",
  dateTo: "",
};

function OrderSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="h-14 border-b border-border bg-muted/35" />
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="grid h-14 grid-cols-[1fr_1.2fr_0.8fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <span className="h-6 w-20 justify-self-end animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
      <Filter
        size={14}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        variant="bare"
        size="sm"
        wrapperClassName="min-w-0 flex-1"
        triggerClassName="min-w-0 flex-1"
      >
        {children}
      </Select>
    </label>
  );
}

export function OrdersList() {
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    ...EMPTY_FILTERS,
    query: new URLSearchParams(window.location.search).get("search") ?? "",
  }));
  const [sortKey, setSortKey] = useState<OrderSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [group, setGroup] = useState<OrderGroupKey>("all");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "status" | "delete" | "promote">(null);
  const [bulkStatus, setBulkStatus] = useState("");
  /** Test-mode view: live orders (default) or 🧪 test orders only. */
  const [testScope, setTestScope] = useState<"live" | "test">("live");
  const confirmBulk = useConfirmDialog();

  // Selection keyed by order id; ids that vanish after a delete/reload are
  // dropped without a second state write.
  const selection = useMemo(
    () =>
      orders
        ? pruneSelection(
            selectedIds,
            new Set(orders.map((order) => order.id)),
          )
        : new Set<string>(),
    [orders, selectedIds],
  );
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "all">(() => {
    try {
      const stored = localStorage.getItem("codflow.orders.pageSize");
      if (stored === "all") return "all";
      const n = Number(stored);
      if (n === 10 || n === 25 || n === 50 || n === 100) return n;
    } catch {
      /* localStorage unavailable — fall through to the default */
    }
    return 50;
  });
  const deferredFilters = useDeferredValue(filters);

  async function load() {
    if (!canScope(identity, "orders:read")) return;
    setLoadError(null);
    try {
      const mayReadDelivery = canScope(identity, "delivery:read");
      const [orderResponse, companyResponse, driverResponse] =
        await Promise.all([
          listAllOrders(),
          mayReadDelivery ? listDeliveryCompanies(true) : Promise.resolve([]),
          mayReadDelivery ? listDrivers() : Promise.resolve([]),
        ]);
      setOrders(orderResponse);
      setCompanies(companyResponse);
      setDrivers(driverResponse);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection, pageSize, group, showDuplicates]);

  // ── Live statuses ───────────────────────────────────────────────────────
  // Carrier webhooks (EcoTrack/Yalidine/ZR) advance orders server-side at
  // any moment; while this page is open and visible, poll quietly every 25s
  // and surface what moved. Errors stay silent — the next tick retries and a
  // real first-load failure still renders the loadError alert above.
  const ordersRef = useRef(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    if (!canScope(identity, "orders:read")) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void (async () => {
        try {
          const latest = await listAllOrders();
          const previous = new Map((ordersRef.current ?? []).map((o) => [o.id, o]));
          let changed = 0;
          for (const order of latest) {
            const before = previous.get(order.id);
            if (
              !before ||
              before.status !== order.status ||
              (before.deliveryAttempts ?? 0) !== (order.deliveryAttempts ?? 0)
            ) {
              changed++;
            }
          }
          setOrders(latest);
          if (changed > 0) {
            notify.flashSuccess(t("live_status_updates").replace("{n}", String(changed)));
          }
        } catch {
          /* silent poll tick */
        }
      })();
    }, 25000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, "orders:read")) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  }

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{t("load_error")}</p>
          <p className="mt-1 text-xs opacity-80">{loadError.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (orders === null) return <OrderSkeleton />;

  const filteredOrders = filterOrders(orders, deferredFilters);

  // ── Test-mode view split ────────────────────────────────────────────────
  // Test orders (product validation, no stock yet) live in their own tab so
  // the live orders book and its stats never mix with experiments.
  const testCount = orders.filter((order) => order.isTest === true).length;
  const liveCount = orders.length - testCount;
  const scopedOrders = filteredOrders.filter(
    (order) => (order.isTest === true) === (testScope === "test"),
  );

  const displayUnits: OrderUnit[] = showDuplicates
    ? scopedOrders.map((order) => ({ primary: order, duplicates: [] }))
    : groupDuplicateOrders(scopedOrders);
  const groupCounts = orderGroupCounts(
    displayUnits.map((unit) => unit.primary),
  );
  const groupStatuses =
    ORDER_GROUPS.find((entry) => entry.key === group)?.statuses ?? null;
  const groupedUnits = groupStatuses
    ? displayUnits.filter((unit) => groupStatuses.includes(unit.primary.status))
    : displayUnits;
  const sortedPrimaries = sortOrders(
    groupedUnits.map((unit) => unit.primary),
    sortKey,
    sortDirection,
  );
  const unitById = new Map(groupedUnits.map((unit) => [unit.primary.id, unit]));
  const sortedUnits = sortedPrimaries.map((primary) => unitById.get(primary.id)!);
  const effectivePageSize =
    pageSize === "all" ? Math.max(1, sortedUnits.length) : pageSize;
  const totalPages = Math.max(
    1,
    Math.ceil(sortedUnits.length / effectivePageSize),
  );
  const safePage = Math.min(page, totalPages);
  const visibleUnits = paginateOrders(sortedUnits, safePage, effectivePageSize);
  const wilayas = [
    ...new Set(orders.map((order) => order.wilaya).filter(Boolean)),
  ] as string[];
  const hasFilters = Object.values(filters).some(
    (value) => value !== "all" && value !== "",
  );

  function setFilter(key: keyof OrderFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(key: string) {
    const cast = key as OrderSortKey;
    if (sortKey === cast)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(cast);
      setSortDirection("asc");
    }
  }

  function changePageSize(value: string) {
    const next = value === "all" ? "all" : Number(value);
    setPageSize(next);
    try {
      localStorage.setItem("codflow.orders.pageSize", String(next));
    } catch {
      /* localStorage unavailable — keep the in-memory choice only */
    }
  }

  function toggleUnit(id: string) {
    setExpandedUnits((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rowProps = {
    drivers,
    companies,
    onChanged: load,
    onError: setActionError,
  };

  // ── Bulk selection ────────────────────────────────────────────────────────
  const canBulkStatus = canScope(identity, "orders:update");
  const canBulkDelete = canScope(identity, "orders:delete");
  const bulkCapable = canBulkStatus || canBulkDelete;

  function toggleRowUnit(unit: OrderUnit) {
    setSelectedIds((current) => toggleUnitSelection(current, unit));
  }

  function toggleAllVisible() {
    setSelectedIds((current) => toggleVisibleSelection(current, visibleUnits));
  }

  function reportBulk(result: { ok: number; failed: number }) {
    const message = result.failed
      ? t("bulk_partial").replace("{ok}", String(result.ok)).replace("{failed}", String(result.failed))
      : t("bulk_done").replace("{ok}", String(result.ok));
    if (result.failed) notify.error(message);
    else notify.flashSuccess(message);
  }

  async function runBulkStatus() {
    if (!bulkStatus || bulkBusy) return;
    const ids = [...selection];
    setBulkBusy("status");
    try {
      const result = await bulkUpdateOrderStatus(ids, bulkStatus);
      reportBulk(result);
      setSelectedIds(new Set());
      setBulkStatus("");
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBulkBusy(null);
    }
  }

  async function runBulkDelete() {
    if (bulkBusy) return;
    const count = selection.size;
    const confirmed = await confirmBulk({
      title: t("bulk_delete_confirm_title").replace("{n}", String(count)),
      description: t("bulk_delete_confirm_desc"),
      confirmLabel: t("bulk_delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    const ids = [...selection];
    setBulkBusy("delete");
    try {
      const result = await bulkDeleteOrders(ids);
      reportBulk(result);
      setSelectedIds(new Set());
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBulkBusy(null);
    }
  }

  /**
   * Move the selected test orders into the live orders book (same rows,
   * history preserved). Refusals come back per order — surface, never hide.
   */
  async function runBulkPromote() {
    if (bulkBusy) return;
    const ids = [...selection];
    setBulkBusy("promote");
    try {
      const result = await promoteOrders(ids);
      const message = result.refused.length
        ? t("test_promote_partial")
            .replace("{ok}", String(result.promoted.length))
            .replace("{failed}", String(result.refused.length))
        : t("test_promote_done").replace("{ok}", String(result.promoted.length));
      if (result.refused.length) notify.error(message);
      else notify.flashSuccess(message);
      setSelectedIds(new Set());
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBulkBusy(null);
    }
  }


  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="shrink-0" />
          <div className="flex-1">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("test_scope_label")}
          className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={testScope === "live"}
            onClick={() => setTestScope("live")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              testScope === "live"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("test_scope_live")}
            <span className="rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums text-muted-foreground">
              {liveCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={testScope === "test"}
            onClick={() => setTestScope("test")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              testScope === "test"
                ? "bg-amber-500/15 text-amber-700 shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🧪 {t("test_scope_test")}
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[10.5px] tabular-nums text-amber-700">
              {testCount}
            </span>
          </button>
        </div>
        {testScope === "test" && (
          <span className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700">
            {t("test_banner")}
          </span>
        )}
      </div>
      <Card flush>
        <div className="space-y-3 border-b border-border p-3">
          <div
            role="tablist"
            aria-label={t("groups_label")}
            className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]"
          >
            {ORDER_GROUPS.map((entry) => {
              const active = entry.key === group;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setGroup(entry.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "border-brand/25 bg-brand/10 text-brand"
                      : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {t(`groups.${entry.key}`)}
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${
                      active
                        ? "bg-brand/15 text-brand"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {groupCounts[entry.key]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={filters.query}
              onChange={(query) => setFilter("query", query)}
              placeholder={t("search_placeholder")}
            />
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {sortedUnits.length} {t("orders_count")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={showDuplicates}
                onClick={() => setShowDuplicates((value) => !value)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                  showDuplicates
                    ? "border-brand/25 bg-brand/10 text-brand"
                    : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t("duplicates.toggle")}
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {t("per_page_label")}
                </span>
                <Select
                  aria-label={t("per_page_label")}
                  value={String(pageSize)}
                  onChange={(event) => changePageSize(event.currentTarget.value)}
                  variant="bare"
                  size="sm"
                  wrapperClassName="w-16"
                  triggerClassName="w-16"
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="all">{common("table.all")}</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <FilterSelect
              label={t("filters.status")}
              value={filters.status}
              onChange={(value) => setFilter("status", value)}
            >
              <option value="all">{t("status.all")}</option>
              {FILTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label={t("filters.delivery_method")}
              value={filters.delivery}
              onChange={(value) => setFilter("delivery", value)}
            >
              <option value="all">{t("filters.all_delivery")}</option>
              <option value="driver">{t("filters.driver")}</option>
              <option value="company">{t("filters.company")}</option>
              <option value="unassigned">{t("filters.unassigned")}</option>
            </FilterSelect>
            <FilterSelect
              label={t("filters.type")}
              value={filters.type}
              onChange={(value) => setFilter("type", value)}
            >
              <option value="all">{t("filters.type")}</option>
              <option value="online">{t("type.online")}</option>
              <option value="offline">{t("type.offline")}</option>
            </FilterSelect>
            {wilayas.length > 1 && (
              <FilterSelect
                label={t("filters.wilaya")}
                value={filters.wilaya}
                onChange={(value) => setFilter("wilaya", value)}
              >
                <option value="all">{t("filters.all_wilayas")}</option>
                {wilayas.map((wilaya) => (
                  <option key={wilaya} value={wilaya}>
                    {wilaya}
                  </option>
                ))}
              </FilterSelect>
            )}
            <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
              <Calendar
                size={14}
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              />
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilter("dateFrom", event.currentTarget.value)}
                aria-label={t("filters.date_from")}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
            <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
              <Calendar
                size={14}
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              />
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilter("dateTo", event.currentTarget.value)}
                aria-label={t("filters.date_to")}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="h-10 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {common("cancel")}
              </button>
            )}
          </div>
        </div>

        {sortedUnits.length === 0 ? (
          <EmptyState
            icon={<PackageOpen size={22} />}
            title={
              hasFilters || group !== "all"
                ? common("no_results_found")
                : t("empty_state.title")
            }
            description={
              hasFilters || group !== "all"
                ? undefined
                : t("empty_state.description")
            }
            action={
              !hasFilters && group === "all" && canScope(identity, "orders:create") ? (
                <LinkButton href="/orders/new">
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {visibleUnits.map((unit) => (
                <Fragment key={unit.primary.id}>
                  <OrderMobileCard
                    order={unit.primary}
                    {...rowProps}
                    selectable={bulkCapable}
                    selected={unitSelected(unit, selection)}
                    onToggleSelected={() => toggleRowUnit(unit)}
                    selectionLabel={t("bulk_select_order")}
                    duplicateCount={unit.duplicates.length}
                    duplicatesExpanded={expandedUnits.has(unit.primary.id)}
                    onToggleDuplicates={() => toggleUnit(unit.primary.id)}
                  />
                  {expandedUnits.has(unit.primary.id) &&
                    unit.duplicates.map((duplicate) => (
                      <OrderMobileCard
                        key={duplicate.id}
                        order={duplicate}
                        {...rowProps}
                        duplicate
                      />
                    ))}
                </Fragment>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[1040px]">
                <TableHeader>
                  <TableRow className="text-xs font-semibold text-muted-foreground">
                    {bulkCapable && (
                      <TableHead className="w-10 ps-4">
                        <input
                          type="checkbox"
                          checked={
                            visibleUnits.length > 0 &&
                            allVisibleSelected(visibleUnits, selection)
                          }
                          onChange={toggleAllVisible}
                          aria-label={t("bulk_select_all")}
                          className="size-4 cursor-pointer accent-primary"
                        />
                      </TableHead>
                    )}
                    <SortHeader
                      label={t("table.order_number")}
                      sortKey="orderNumber"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={t("table.customer")}
                      sortKey="customerName"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                <TableHead className="text-start">
                  <span className="inline-flex items-center gap-1.5">
                    {t("table.phone")}
                    <WhatsAppTemplateSettings />
                  </span>
                </TableHead>
                    <SortHeader
                      label={t("table.status")}
                      sortKey="status"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={t("table.wilaya")}
                      sortKey="wilaya"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="text-start">
                      {t("table.delivery")}
                    </TableHead>
                    <SortHeader
                      label={t("table.total")}
                      sortKey="total"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                      align="end"
                    />
                    <SortHeader
                      label={t("table.date")}
                      sortKey="createdAt"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="w-12">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleUnits.map((unit) => (
                    <Fragment key={unit.primary.id}>
                      <OrderDesktopRow
                        order={unit.primary}
                        {...rowProps}
                        selectable={bulkCapable}
                        selected={unitSelected(unit, selection)}
                        onToggleSelected={() => toggleRowUnit(unit)}
                        selectionLabel={t("bulk_select_order")}
                        duplicateCount={unit.duplicates.length}
                        duplicatesExpanded={expandedUnits.has(unit.primary.id)}
                        onToggleDuplicates={() => toggleUnit(unit.primary.id)}
                      />
                      {expandedUnits.has(unit.primary.id) &&
                        unit.duplicates.map((duplicate) => (
                          <OrderDesktopRow
                            key={duplicate.id}
                            order={duplicate}
                            {...rowProps}
                            selectable={bulkCapable}
                            duplicate
                          />
                        ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                total={sortedUnits.length}
                pageSize={effectivePageSize}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      {bulkCapable && selection.size > 0 && (
        <div
          role="toolbar"
          aria-label={t("bulk_selected").replace("{n}", String(selection.size))}
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl">
            <span className="text-sm font-bold text-foreground">
              {t("bulk_selected").replace("{n}", String(selection.size))}
            </span>
            <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
              {testScope === "test" && canBulkStatus && (
                <Button
                  type="button"
                  size="sm"
                  disabled={bulkBusy !== null}
                  onClick={() => void runBulkPromote()}
                >
                  <ArrowUpCircle size={14} />
                  {bulkBusy === "promote" ? t("bulk_working") : t("test_promote")}
                </Button>
              )}
              {canBulkStatus && (
                <>
                  <Select
                    aria-label={t("bulk_status_label")}
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.currentTarget.value)}
                    variant="bare"
                    size="sm"
                    wrapperClassName="w-44 shrink-0 rounded-lg border border-border"
                  >
                    <option value="">{t("bulk_status_label")}</option>
                    {BULK_STATUS_TARGETS.map((status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!bulkStatus || bulkBusy !== null}
                    onClick={() => void runBulkStatus()}
                  >
                    <Check size={14} />
                    {bulkBusy === "status" ? t("bulk_working") : t("bulk_apply_status")}
                  </Button>
                </>
              )}
              {canBulkDelete && (
                <Button
                  type="button"
                  size="sm"
                  variant="dangerOutline"
                  disabled={bulkBusy !== null}
                  onClick={() => void runBulkDelete()}
                >
                  <Trash2 size={14} />
                  {bulkBusy === "delete" ? t("bulk_working") : t("bulk_delete")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={bulkBusy !== null}
                onClick={() => setSelectedIds(new Set())}
              >
                <X size={14} />
                {t("bulk_clear")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
