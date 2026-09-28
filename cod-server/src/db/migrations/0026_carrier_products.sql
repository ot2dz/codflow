-- EcoTrack carrier-held stock fulfillment.
-- `stock_fulfillment` on a delivery company switches dispatch to EcoTrack
-- `stock=1` (prepare from the carrier's own stock), keyed by each order line's
-- SKU as the carrier product reference. The carrier refuses the parcel when its
-- stock is insufficient — no local pre-check; CodFlow local inventory is
-- unaffected.
ALTER TABLE `delivery_companies` ADD `stock_fulfillment` integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- Read-only mirror of the carrier's product stock (EcoTrack get/products/list)
-- shown in the dashboard. Refreshed on demand; never used as a dispatch gate.
CREATE TABLE IF NOT EXISTS `carrier_products` (
  `id`               text PRIMARY KEY NOT NULL,
  `company_id`       text NOT NULL REFERENCES `delivery_companies`(`id`) ON DELETE CASCADE,
  `reference`        text NOT NULL,
  `barcode`          text,
  `title`            text,
  `is_active`        integer NOT NULL DEFAULT 1,
  `image`            text,
  `stock_disponible` integer NOT NULL DEFAULT 0,
  `stock_reserve`    integer NOT NULL DEFAULT 0,
  `stock_physique`   integer NOT NULL DEFAULT 0,
  `synced_at`        text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `carrier_products_company_reference_unique` ON `carrier_products` (`company_id`,`reference`);
