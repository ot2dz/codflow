-- Per-product page templates + palette presets + rich content blocks.
--
-- template        : which PDP layout renders this product ("default" = the
--                   theme's own layout; other slugs are resolved by the
--                   theme's template registry, unknown slugs fall back).
-- palette         : color preset applied to the product page ("" = inherit
--                   the store's primary/accent colors).
-- content_blocks  : JSON array of rich blocks (image_text | steps |
--                   two_images) rendered by templates that support them,
--                   after the order form. NULL = none.
--
-- Additive, existing rows keep the exact current behavior.
ALTER TABLE `products` ADD `template` text NOT NULL DEFAULT 'default';
ALTER TABLE `products` ADD `palette` text NOT NULL DEFAULT '';
ALTER TABLE `products` ADD `content_blocks` text;
