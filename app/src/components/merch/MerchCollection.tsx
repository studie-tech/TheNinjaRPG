"use client";

import {
  ArrowDown,
  ArrowRight,
  Leaf,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { IMG_MERCH_ARTWORK, IMG_WALLPAPER_HORIZON } from "@/drizzle/constants";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { formatMerchMoney, productFromPrice } from "@/libs/merch/catalog";
import type { MerchProduct } from "@/validators/merch";
import { useMerch } from "./MerchProvider";

const FEATURED_COLLECTION_ORDER: Record<string, number> = {
  Community: 0,
  "S-ranks": 1,
  Villages: 2,
};

const COLLECTIONS = [
  {
    name: "Villages",
    title: "Where you belong.",
    text: "Carry your village with you.",
    image: IMG_MERCH_ARTWORK.tsukimori,
    number: "01",
  },
  {
    name: "S-ranks",
    title: "The power you chase.",
    text: "Legendary bloodlines. Unmistakable art.",
    image: IMG_MERCH_ARTWORK.blueblade,
    number: "02",
  },
  {
    name: "Community",
    title: "If you know, you know.",
    text: "For the jokes that never quite die.",
    image: IMG_MERCH_ARTWORK.ramen,
    number: "03",
  },
];

export function MerchCollection() {
  const { products, loading, error, retry } = useMerch();
  const [collection, setCollection] = useState("All designs");
  const [kind, setKind] = useState("Organic Hoodie");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const [limit, setLimit] = useState(24);
  const kinds = [...new Set(products.map((p) => p.kind))];
  const activeKind =
    kinds.includes(kind) || kind === "All pieces" ? kind : "All pieces";
  const filtered = products
    .filter(
      (p) =>
        (collection === "All designs" || p.category === collection) &&
        (activeKind === "All pieces" || p.kind === activeKind) &&
        `${p.title} ${p.category} ${p.description}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "price"
          ? Number(productFromPrice(a)?.amount ?? Infinity) -
            Number(productFromPrice(b)?.amount ?? Infinity)
          : (FEATURED_COLLECTION_ORDER[a.category] ?? Infinity) -
            (FEATURED_COLLECTION_ORDER[b.category] ?? Infinity),
    );
  const selectCollection = (name: string) => {
    setCollection(name);
    setLimit(24);
    document.getElementById("collection")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  const clearFilters = () => {
    setSearch("");
    setCollection("All designs");
    setKind("All pieces");
    setLimit(24);
  };
  const heroPieces = [
    { key: "blueblade", kind: "Organic T-Shirt" },
    { key: "tsukimori", kind: "Organic T-Shirt" },
    { key: "ramen", kind: "Black Glossy Mug" },
  ]
    .map(({ key, kind }) =>
      products.find((p) => p.designKey === key && p.kind === kind),
    )
    .filter((p): p is MerchProduct => Boolean(p));

  return (
    <>
      <section className="merch-hero" aria-labelledby="merch-heading">
        <Image
          className="merch-hero-wallpaper"
          src={IMG_WALLPAPER_HORIZON}
          width={1792}
          height={1024}
          alt=""
          priority
        />
        <div className="merch-hero-copy">
          <p className="merch-eyebrow">
            <span /> From our world to yours
          </p>
          <h1 id="merch-heading">
            Wear your village.
            <br />
            <em>Carry the lore.</em>
          </h1>
          <p>
            The places we call home. The power we chase. The jokes only we understand. A
            collection for the world we share.
          </p>
          <div className="merch-hero-buttons">
            <button
              className="merch-button"
              type="button"
              onClick={() => selectCollection("All designs")}
            >
              Explore the collection <ArrowDown size={17} />
            </button>
          </div>
          <span className="merch-hero-caption">
            Inspired by The Ninja RPG · Created for its community
          </span>
        </div>
        <div className="merch-hero-pieces">
          {heroPieces.map((p, i) => (
            <Link
              key={p.id}
              href={`/merch/${p.handle}`}
              className={`merch-hero-piece merch-hero-piece-${i}`}
            >
              <span className="merch-piece-number">
                {String(i + 1).padStart(2, "0")} / SEICHI COLLECTION
              </span>
              {p.images[0] && (
                <Image
                  src={p.images[0].url}
                  width={300}
                  height={330}
                  alt={p.images[0].alt}
                  loading="eager"
                />
              )}
              <span className="merch-piece-label">
                {p.designName}
                <ArrowRight size={16} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <div className="merch-values">
        <span>
          <Sparkles size={18} /> Artwork with a story
        </span>
        <span>
          <Leaf size={18} /> Organic cotton options
        </span>
        <span>
          <ShieldCheck size={18} /> Secure Shopify checkout
        </span>
      </div>
      <section className="merch-collections" aria-labelledby="collections-heading">
        <div className="merch-section-heading">
          <div>
            <p className="merch-eyebrow">Find your connection</p>
            <h2 id="collections-heading">More than a design.</h2>
          </div>
          <p>
            A village, a bloodline, a shared memory.
            <br />
            Start with the part of Seichi that feels like you.
          </p>
        </div>
        <div className="merch-collection-grid">
          {COLLECTIONS.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`merch-collection-tile merch-tile-${c.number}`}
              onClick={() => selectCollection(c.name)}
            >
              <span className="merch-tile-number">
                {c.number} / {c.name}
              </span>
              <Image src={c.image} width={350} height={360} alt="" />
              <div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <span className="merch-tile-link">
                  Explore {c.name.toLowerCase()} <ArrowRight size={18} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section
        className="merch-catalog"
        id="collection"
        aria-labelledby="catalog-heading"
      >
        <div className="merch-section-heading">
          <div>
            <p className="merch-eyebrow">Make it yours</p>
            <h2 id="catalog-heading">The collection</h2>
          </div>
        </div>
        <div className="merch-filters">
          <fieldset className="merch-category-tabs">
            <legend className="sr-only">Filter by collection</legend>
            {["All designs", ...Object.keys(FEATURED_COLLECTION_ORDER)].map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={collection === c}
                onClick={() => {
                  setCollection(c);
                  setLimit(24);
                }}
              >
                {c}
              </button>
            ))}
          </fieldset>
          <div className="merch-filter-inputs">
            <label className="merch-search">
              <Search size={18} />
              <span className="sr-only">Search the collection</span>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(24);
                }}
                placeholder="Search designs, villages…"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label>
              <span className="sr-only">Product type</span>
              <select
                value={activeKind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setLimit(24);
                }}
              >
                <option>All pieces</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Sort collection</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="featured">Featured</option>
                <option value="name">Name: A–Z</option>
                <option
                  value="price"
                  disabled={
                    !products.some((product) =>
                      product.variants.some((variant) => variant.price),
                    )
                  }
                >
                  Price: low to high
                </option>
              </select>
            </label>
          </div>
        </div>
        <div className="merch-results-note" aria-live="polite">
          <span>
            {loading
              ? "Loading the collection…"
              : `${filtered.length} ${filtered.length === 1 ? "piece" : "pieces"}`}
          </span>
          {(search ||
            collection !== "All designs" ||
            activeKind !== "Organic T-Shirt") && (
            <button type="button" onClick={clearFilters}>
              Reset filters <X size={12} />
            </button>
          )}
        </div>
        {error ? (
          <div className="merch-empty-state">
            <h3>The collection couldn’t be loaded.</h3>
            <p>Please try again in a moment.</p>
            <button type="button" className="merch-button" onClick={retry}>
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="merch-product-grid" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="merch-product-skeleton" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="merch-empty-state">
            <Sparkles size={32} />
            <h3>
              {products.length ? "No pieces found." : "A collection is taking shape."}
            </h3>
            <p>
              {products.length
                ? "Try another design name or explore a different collection."
                : "Our first pieces are being prepared. Come back soon to find your favourite."}
            </p>
            {products.length > 0 && (
              <button type="button" className="merch-button" onClick={clearFilters}>
                Show the collection
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="merch-product-grid">
              {filtered.slice(0, limit).map((p) => (
                <MerchProductCard key={p.id} product={p} />
              ))}
            </div>
            {filtered.length > limit && (
              <div className="merch-load-more">
                <p>
                  Showing {Math.min(limit, filtered.length)} of {filtered.length} pieces
                </p>
                <button
                  type="button"
                  className="merch-button merch-button-outline"
                  onClick={() => setLimit(limit + 24)}
                >
                  Explore more pieces <ArrowDown size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="merch-faq" aria-labelledby="faq-heading">
        <div>
          <p className="merch-eyebrow">The little details</p>
          <h2 id="faq-heading">Good to know.</h2>
        </div>
        <div>
          <details>
            <summary>Where is the artwork printed on apparel?</summary>
            <p>
              Our apparel uses large graphics on the back. Artwork is fitted
              proportionally to the print area, so tall designs keep their complete
              composition. Check each product’s preview for its placement.
            </p>
          </details>
          <details>
            <summary>Which products use organic materials?</summary>
            <p>
              The collection includes organic cotton apparel and totes. Materials vary
              by product and fulfillment region; each product page explains its own
              composition. Drinkware and backpacks have different materials.
            </p>
          </details>
          <details>
            <summary>How do I choose the right size?</summary>
            <p>
              Compare a garment you already love with the size guide on the product
              page. Sizing differs between the tee, hoodie and sweatshirts, so check
              each piece rather than assuming one size fits every style.
            </p>
          </details>
          <details>
            <summary>What about delivery and order support?</summary>
            <p>
              Available destinations, delivery options and applicable charges are shown
              at checkout. For order questions, contact contact@theninja-rpg.com with
              your order number and checkout email.
            </p>
          </details>
        </div>
      </section>
    </>
  );
}

export function MerchProductCard({ product }: { product: MerchProduct }) {
  const image = product.images[0];
  return (
    <article className="merch-product-card">
      <Link href={`/merch/${product.handle}`} className="merch-product-image">
        {image ? (
          <Image src={image.url} alt={image.alt} width={380} height={430} />
        ) : (
          <ShoppingPlaceholder />
        )}
        <span className="merch-product-badge">
          {product.tags.includes("Back print") ? "Back print" : product.category}
        </span>
        <span className="merch-product-view">
          Discover this piece <ArrowRight size={16} />
        </span>
      </Link>
      <div className="merch-product-info">
        <span>{product.kind}</span>
        <h3>
          <Link href={`/merch/${product.handle}`}>{product.designName}</Link>
        </h3>
        <p>
          {formatMerchMoney(productFromPrice(product))}
          <span
            aria-hidden="true"
            style={{
              background:
                product.options
                  .find((option) => option.name === "Color")
                  ?.values[0]?.toLowerCase() === "white"
                  ? "#fff"
                  : "#252923",
            }}
            className="merch-colour-dot"
          />
        </p>
      </div>
    </article>
  );
}

function ShoppingPlaceholder() {
  return <span className="merch-photo-placeholder">Product preview coming soon</span>;
}
