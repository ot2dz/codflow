-- Storefront checkout: optional commune field.
-- show_commune = 0 hides the commune picker on the storefront order form;
-- orders then carry wilaya only (commune_id NULL). Carrier dispatch still
-- requires a commune and will skip these orders (merchant completes manually).
ALTER TABLE `stores` ADD `show_commune` integer NOT NULL DEFAULT true;--> statement-breakpoint
