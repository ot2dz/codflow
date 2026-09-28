import { Fragment, useDeferredValue, useEffect, useState } from "react";
import { AlertCircle, Calendar, Filter, PackageOpen, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import {
  listAllOrders,
  listDeliveryCompanies,
  listDrivers,
} from "@/features/orders/api";
import {
  FILTER_STATUSES,
  ORDER_GROUPS,
  filterOrders,
  groupDuplicateOrders,
  orderGroupCounts,
  paginateOrders,
  sortOrders,
  type OrderFilters,
  type OrderGroupKey,
  type OrderSortKey,
  type OrderUnit,
} from "@/features/orders/model";
import type {
  DeliveryCompany,
  Driver,
  OrderListItem,
} from "@/features/orders/types";
import {
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
} from "@/components/ui";
import { OrderDesktopRow, OrderMobileCard } from "@/features/orders/components/OrderRow";

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
  const displayUnits: OrderUnit[] = showDuplicates
    ? filteredOrders.map((order) => ({ primary: order, duplicates: [] }))
    : groupDuplicateOrders(filteredOrders);
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
                      {t("table.phone")}
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
    </div>
  );
}
