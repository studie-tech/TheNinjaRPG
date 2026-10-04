"use client";

import { ArrowRight, Minus, Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Table from "@/layout/Table";
import {
  formatMerchMoney,
  getMerchDesign,
  productFromPrice,
  selectedMerchImage,
  selectedMerchVariant,
} from "@/libs/merch/catalog";
import { MERCH_PRODUCT_DETAILS } from "@/libs/merch/products";
import { MerchProductCard } from "./MerchCollection";
import { useMerch } from "./MerchProvider";

export function MerchProductPage({ handle }: { handle: string }) {
  const { products, loading, error, retry, preview, busy, message, add } = useMerch();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [selectionMessage, setSelectionMessage] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [showArt, setShowArt] = useState(false);
  const product = products.find((p) => p.handle === handle);
  const design = product ? getMerchDesign(product.designKey) : undefined;
  const variant = product ? selectedMerchVariant(product, selection) : undefined;
  const details = product ? MERCH_PRODUCT_DETAILS[product.kind] : undefined;
  const startingPrice = product ? productFromPrice(product) : null;
  const image =
    showArt && design
      ? { url: design.art, alt: `${design.name} artwork` }
      : product
        ? selectedMerchImage(product, selection)
        : undefined;

  if (loading)
    return (
      <div className="merch-empty-state" role="status">
        Loading this piece…
      </div>
    );
  if (error)
    return (
      <div className="merch-empty-state">
        <h1>This piece couldn’t be loaded.</h1>
        <button type="button" className="merch-button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  if (!product)
    return (
      <div className="merch-empty-state">
        <h1>That piece isn’t in the collection.</h1>
        <Link href="/merch" className="merch-button">
          Explore the collection
        </Link>
      </div>
    );

  return (
    <>
      <section className="merch-product-detail">
        <div>
          <div className={`merch-detail-photo ${showArt ? "merch-detail-art" : ""}`}>
            {image && (
              <Image
                src={image.url}
                alt={image.alt}
                width={800}
                height={900}
                priority
              />
            )}
            <span className="merch-product-badge">
              {showArt
                ? "Artwork detail"
                : product.tags.includes("Back print")
                  ? "Back print"
                  : "Product preview"}
            </span>
          </div>
          <div className="merch-gallery-tabs">
            <button
              type="button"
              aria-pressed={!showArt}
              onClick={() => setShowArt(false)}
            >
              On the product
            </button>
            {design && (
              <button
                type="button"
                aria-pressed={showArt}
                onClick={() => setShowArt(true)}
              >
                The artwork
              </button>
            )}
          </div>
        </div>
        <div className="merch-product-copy">
          <p className="merch-eyebrow">{product.category} / Seichi collection</p>
          <h1>{product.designName}</h1>
          <p className="merch-detail-kind">{product.kind}</p>
          <p className="merch-detail-price">
            {!variant && startingPrice && "From "}
            {formatMerchMoney(variant?.price ?? startingPrice)}
            {(variant?.price ?? startingPrice) && " per item"}
          </p>
          <p>{(design?.graphic ?? product.description).split(/(?<=[.!?])\s+/)[0]}</p>
          {product.options
            .filter((option) => option.values.length > 1)
            .map((option) => (
              <fieldset key={option.name}>
                <legend>
                  {option.name}
                  {selection[option.name] && <span> · {selection[option.name]}</span>}
                </legend>
                <div className="merch-option-values">
                  {option.values.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={
                        (selection[option.name] ??
                          (option.values.length === 1 ? value : undefined)) === value
                      }
                      disabled={
                        !product.variants.some(
                          (item) =>
                            item.available &&
                            item.selectedOptions.every((selected) =>
                              selected.name === option.name
                                ? selected.value === value
                                : /^(color|colour)$/i.test(option.name) ||
                                  !selection[selected.name] ||
                                  selected.value === selection[selected.name],
                            ),
                        )
                      }
                      onClick={() => {
                        setShowArt(false);
                        const next = { ...selection, [option.name]: value };
                        const exists = product.variants.some(
                          (item) =>
                            item.available &&
                            item.selectedOptions.every(
                              (selected) =>
                                !next[selected.name] ||
                                next[selected.name] === selected.value,
                            ),
                        );
                        setSelection(exists ? next : { [option.name]: value });
                        setSelectionMessage(
                          exists
                            ? ""
                            : `${value} isn’t available with your previous options. Please choose again.`,
                        );
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          {selectionMessage && <p role="status">{selectionMessage}</p>}
          <div className="merch-purchase">
            <div className="merch-quantity">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity === 1 || busy}
                onClick={() => setQuantity(quantity - 1)}
              >
                <Minus size={16} />
              </button>
              <span>{quantity}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={quantity === 10 || busy}
                onClick={() => setQuantity(quantity + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
            <button
              type="button"
              className="merch-button"
              disabled={!variant?.available || busy}
              onClick={() => variant && void add(product, variant, quantity)}
            >
              <ShoppingBag size={18} />
              {busy
                ? "Adding…"
                : !variant
                  ? "Choose your options"
                  : !variant.available
                    ? "Unavailable"
                    : preview
                      ? "Add to review bag"
                      : "Add to bag"}
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {preview && (
            <p className="merch-product-footnote">
              Preview only. Prices, available sizes and production artwork will be
              confirmed before orders open.
            </p>
          )}
          <details className="merch-product-disclosure" open>
            <summary>About this piece</summary>
            <p>{details?.material ?? product.description}</p>
            {details && <p>{details.features}</p>}
            {product.kind !== "Wide-Leg Joggers" &&
              product.tags.includes("Back print") && (
                <p>
                  A large back graphic, fitted proportionally to preserve the complete
                  artwork.
                </p>
              )}
          </details>
          <details className="merch-product-disclosure">
            <summary>Sizing & care</summary>
            <p>
              {details?.sizing ?? "See this product’s available options for sizing."}
            </p>
            {details?.sizeGuide && (
              <Table
                compact
                data={details.sizeGuide}
                columns={[
                  { key: "size", header: "Size", type: "string" },
                  { key: "waist", header: "Waist", type: "string" },
                  { key: "hips", header: "Hips", type: "string" },
                ]}
              />
            )}
            {details && <p>{details.care}</p>}
          </details>
          <details className="merch-product-disclosure">
            <summary>Delivery & support</summary>
            <p>
              Shipping options and charges are calculated at checkout when orders open.
              For sizing or order questions, email{" "}
              <a href="mailto:contact@theninja-rpg.com">contact@theninja-rpg.com</a>.
            </p>
          </details>
        </div>
      </section>
      {design && (
        <section className="merch-design-story">
          <div>
            <p className="merch-eyebrow">The story behind the graphic</p>
            <h2>{design.name}</h2>
            <p>{design.history}</p>
          </div>
        </section>
      )}
      <section className="merch-related">
        <div className="merch-section-heading">
          <div>
            <p className="merch-eyebrow">Same story. A different piece.</p>
            <h2>Carry it your way.</h2>
          </div>
          <Link href="/merch">
            Explore everything <ArrowRight size={16} />
          </Link>
        </div>
        <div className="merch-product-grid">
          {products
            .filter((p) => p.designKey === product.designKey && p.id !== product.id)
            .slice(0, 4)
            .map((p) => (
              <MerchProductCard key={p.id} product={p} />
            ))}
        </div>
      </section>
    </>
  );
}
