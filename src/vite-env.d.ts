/// <reference types="vite/client" />

/**
 * Installed package version, injected by Vite's `define` at build time.
 * Read it through `APP_VERSION` in `@/shared/constants`, which also covers
 * runners such as `tsx` that do not apply Vite's define replacement.
 */
declare const __APP_VERSION__: string;

/** Product values injected from product.config.json by Vite. */
declare const __PRODUCT_NAME__: string;
declare const __PRODUCT_SHORT_NAME__: string;
declare const __PRODUCT_PAGE_TITLE__: string;
declare const __PRODUCT_REPOSITORY__: string;
declare const __PRODUCT_REPOSITORY_URL__: string;
declare const __PRODUCT_SHOW_GITHUB_STAR_BADGE__: boolean;
