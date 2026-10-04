import { ChevronDown, MapPin, PackageOpen, Star } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import {
  TableCell,
  TableRow,
} from "@/components/ui";
import { formatMoney, orderTotal } from "@/features/orders/model";
import type {
  DeliveryCompany,
  Driver,
  OrderListItem,
} from "@/features/orders/types";
import { OrderStatus } from "@/features/orders/components/OrderStatus";
import { OrderDelivery } from "@/features/orders/components/OrderDelivery";
import { OrderRowActions } from "@/features/orders/components/OrderFulfillmentActions";
import { WhatsAppContactButton } from "@/features/orders/components/WhatsAppContactButton";

interface RowProps {
  order: OrderListItem;
  drivers: Driver[];
  companies: DeliveryCompany[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
  /** A hidden duplicate revealed under its primary row. */
  duplicate?: boolean;
  /** Primary row: how many duplicates are collapsed beneath it. */
  duplicateCount?: number;
  /** Primary row: whether the duplicates are currently shown. */
  duplicatesExpanded?: boolean;
  onToggleDuplicates?: () => void;
}

function DuplicateToggle({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT("orders");
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--status-preparing-border)] bg-[var(--status-preparing-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--status-preparing-text)]"
    >
      {t("duplicates.badge").replace("{count}", String(count + 1))}
      <ChevronDown
        size={11}
        className={`transition-transform ${expanded ? "rotate-180" : ""}`}
      />
    </button>
  );
}

export function OrderDesktopRow({
  order,
  drivers,
  companies,
  onChanged,
  onError,
  duplicate = false,
  duplicateCount = 0,
  duplicatesExpanded = false,
  onToggleDuplicates,
}: RowProps) {
  const locale = useLocale();
  const t = useT("orders");
  return (
    <TableRow
      className={`border-b border-border last:border-0 transition-colors ${
        duplicate ? "bg-muted/30 opacity-70" : "hover:bg-muted/40"
      }`}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <a
            href={`/orders/${order.id}`}
            className="inline-flex items-center gap-2 font-semibold text-link underline-offset-4 hover:underline"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
              <PackageOpen size={14} />
            </span>
            {order.orderNumber}
            {(order.hasReview ?? 0) > 0 && (
              <Star size={12} className="fill-warning text-warning" />
            )}
          </a>
          {duplicate ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
              {t("duplicates.row_tag")}
            </span>
          ) : (
            onToggleDuplicates && (
              <DuplicateToggle
                count={duplicateCount}
                expanded={duplicatesExpanded}
                onToggle={onToggleDuplicates}
              />
            )
          )}
        </div>
      </TableCell>
      <TableCell>
        <p className="font-medium text-foreground">{order.customerName}</p>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground" dir="ltr">
            {order.phone}
          </span>
          <WhatsAppContactButton
            order={order}
            statusLabel={t(`status.${order.status}`)}
          />
        </div>
      </TableCell>
      <TableCell>
        <OrderStatus order={order} onChanged={onChanged} onError={onError} />
      </TableCell>
      <TableCell>
        <span className="inline-flex max-w-44 items-start gap-1.5 truncate text-xs font-medium">
          <MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          {order.wilaya}
          {order.commune ? ` · ${order.commune}` : ""}
        </span>
      </TableCell>
      <TableCell>
        <OrderDelivery order={order} companies={companies} />
      </TableCell>
      <TableCell className="text-end font-bold tabular-nums text-foreground">
        {formatMoney(orderTotal(order), locale)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(order.createdAt))}
      </TableCell>
      <TableCell className="text-end">
        <OrderRowActions
          order={order}
          drivers={drivers}
          companies={companies}
          onChanged={onChanged}
          onError={onError}
        />
      </TableCell>
    </TableRow>
  );
}

export function OrderMobileCard({
  order,
  drivers,
  companies,
  onChanged,
  onError,
  duplicate = false,
  duplicateCount = 0,
  duplicatesExpanded = false,
  onToggleDuplicates,
}: RowProps) {
  const locale = useLocale();
  const t = useT("orders");
  return (
    <article className={duplicate ? "bg-muted/30 p-4 opacity-70" : "p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <a
              href={`/orders/${order.id}`}
              className="text-sm font-semibold text-link hover:underline"
            >
              {order.orderNumber}
            </a>
            {(order.hasReview ?? 0) > 0 && (
              <Star size={12} className="fill-warning text-warning" />
            )}
            {duplicate && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                {t("duplicates.row_tag")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {order.customerName}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <span dir="ltr">{order.phone}</span>
            <WhatsAppContactButton
              order={order}
              statusLabel={t(`status.${order.status}`)}
            />
          </p>
          {!duplicate && onToggleDuplicates && duplicateCount > 0 && (
            <div className="mt-1.5">
              <DuplicateToggle
                count={duplicateCount}
                expanded={duplicatesExpanded}
                onToggle={onToggleDuplicates}
              />
            </div>
          )}
        </div>
        <div className="flex items-start gap-1">
          <OrderStatus order={order} onChanged={onChanged} onError={onError} />
          <OrderRowActions
            order={order}
            drivers={drivers}
            companies={companies}
            onChanged={onChanged}
            onError={onError}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <MapPin size={13} />
          {order.wilaya}
          {order.commune ? ` · ${order.commune}` : ""}
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
          {formatMoney(orderTotal(order), locale)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(order.createdAt))}
      </p>
      <div className="mt-2">
        <OrderDelivery order={order} companies={companies} />
      </div>
    </article>
  );
}
