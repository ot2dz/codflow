-- Test-mode (product validation) flags.
--
-- A merchant validating a product without stock marks the product and/or the
-- landing page as a test. Orders created from those sources are flagged at
-- creation (snapshot), live in an isolated test view, are blocked from
-- dispatch, and are excluded from live analytics. Promoting a test order
-- flips orders.is_test back to 0 on the SAME row, preserving all history.
--
-- Additive, default 0 (existing rows keep behaving exactly as before).
ALTER TABLE `products` ADD `is_test` integer NOT NULL DEFAULT 0;
ALTER TABLE `landing_pages` ADD `is_test` integer NOT NULL DEFAULT 0;
ALTER TABLE `orders` ADD `is_test` integer NOT NULL DEFAULT 0;
