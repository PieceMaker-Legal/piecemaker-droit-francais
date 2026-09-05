/**
 * Fork branding for UI text that is hardcoded in upstream components rather than translated.
 *
 * Prefer this over writing the product name inline, so a rename only touches
 * `product.config.json`.
 */

/** Wordmark shown in headings, buttons and upsell copy ("PieceMaker"), from product.config.json. */
export const PRODUCT_SHORT_NAME =
  typeof __PRODUCT_SHORT_NAME__ === 'string' ? __PRODUCT_SHORT_NAME__ : 'PieceMaker';
