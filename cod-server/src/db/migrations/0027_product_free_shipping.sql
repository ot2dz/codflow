-- Free Shipping Product: a product-level flag. When EVERY product in an order
-- is tagged, the resolved delivery fee is forced to 0. Distinct from the
-- pre-existing free_shipping Offer (offers.discount_type), which is cart-based
-- (trigger product + minimum quantity). Additive column, default 0.
ALTER TABLE `products` ADD `free_shipping` integer NOT NULL DEFAULT 0;
