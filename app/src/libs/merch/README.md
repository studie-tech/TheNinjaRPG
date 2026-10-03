# Merch storefront

The public `/merch` routes render inside the regular game layout and reuse `ContentBox`, shared buttons and the site’s tRPC client. Container queries adapt the collection to the content column rather than the full browser viewport. Shopify owns product prices, variant availability, carts and checkout; Printful owns fulfillment. No game balance or account is involved in a merch purchase.

Configure these server environment variables:

- `SHOPIFY_STORE_DOMAIN`: the original `*.myshopify.com` domain.
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: the Headless channel’s **public Storefront API token**, kept in server configuration. Do not use an Admin API token.
- `MERCH_CHECKOUT_ENABLED`: `true` only after prices, shipping, payments, policies, print files and a complete test order have been verified. Defaults to closed.

Publish curated products to the Headless sales channel. Products match a design through `design:<key>` tags or the full design name. Use product titles of `Design name — Product type`; imported Printful `TNRG <number> | Design name | Product type` titles are also supported. The catalogue follows Shopify pagination and rejects truncated variant lists. The Storefront API version is pinned in `server/utils/shopify.ts`.

Cart bearer IDs stay in an HTTP-only, same-site cookie. Regular cart responses contain line items and totals only. The checkout mutation refreshes the cart and validates its destination before returning the checkout URL. Customer and payment details are entered in Shopify checkout.

`/merch/cart` opens the existing bag over the collection and restores its Shopify cart through the same cookie. Shopify storefront redirects can use this route for cart links and `/merch` for collection links. Redirect only storefront pages, preserving Shopify checkout and policy pages, and enable redirects after the game routes are deployed.

Without credentials, development displays the curated Printful review catalogue and a local review bag. Production displays a coming-soon collection and disables checkout. Review prices are deliberately unset. The preview fixture is not an inventory or availability guarantee.

`designs.json` contains the graphic descriptions, lore and artwork interpretation. `products.ts` contains material, care and sizing information for the selected blanks, with manufacturer links. Confirm region-dependent compositions and sizing when changing a blank. Artwork is hosted on UploadThing and served through the existing Bunny CDN. `IMG_MERCH_ARTWORK` in `drizzle/constants.ts` maps design keys to hosted URLs; no artwork binaries are stored in `public`.
