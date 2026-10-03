"use client";

import { ArrowRight, Check, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { IMG_WALLPAPER_HORIZON } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import "./merch.css";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { formatMerchMoney } from "@/libs/merch/catalog";
import { usePublicPathname } from "@/utils/routing";
import {
  type MerchCartLine,
  type MerchProduct,
  type MerchVariant,
  merchReviewCartSchema,
} from "@/validators/merch";

const REVIEW_BAG_KEY = "tnr-merch-review-bag-v1";
type MerchContextValue = {
  products: MerchProduct[];
  preview: boolean;
  loading: boolean;
  error: boolean;
  retry: () => void;
  busy: boolean;
  message: string;
  add: (
    product: MerchProduct,
    variant: MerchVariant,
    quantity: number,
  ) => Promise<void>;
};
const MerchContext = createContext<MerchContextValue | null>(null);

export const useMerch = () => {
  const value = useContext(MerchContext);
  if (!value) throw new Error("MerchProvider is required.");
  return value;
};

export function MerchProvider({ children }: { children: ReactNode }) {
  const pathname = usePublicPathname();
  const catalog = api.merch.getCatalog.useQuery(undefined, {
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const preview = catalog.data?.preview ?? false;
  const cart = api.merch.getCart.useQuery(undefined, {
    enabled: Boolean(catalog.data && !preview),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const utils = api.useUtils();
  const [bagOpen, setBagOpen] = useState(false);
  const [reviewLines, setReviewLines] = useState<MerchCartLine[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [message, setMessage] = useState("");
  const [needsCartRefresh, setNeedsCartRefresh] = useState(false);
  const addMutation = api.merch.addToCart.useMutation({
    onError: () => setMessage("We couldn’t add that item. Please try again."),
  });
  const updateMutation = api.merch.updateCart.useMutation({
    onError: () => setMessage("Your bag couldn’t be updated. Please try again."),
  });
  const checkoutMutation = api.merch.checkout.useMutation({
    onError: () => setMessage("Checkout couldn’t be opened. Please try again."),
  });
  const busy =
    addMutation.isPending ||
    updateMutation.isPending ||
    checkoutMutation.isPending ||
    (!preview && (needsCartRefresh || cart.isFetching));

  const refreshCart = async () => {
    const result = await cart.refetch();
    if (result.isSuccess) setNeedsCartRefresh(false);
  };

  useEffect(() => {
    if (pathname === "/merch/cart") setBagOpen(true);
  }, [pathname]);

  useEffect(() => {
    try {
      const raw = safeLocalStorageGetItem(REVIEW_BAG_KEY);
      const parsed = merchReviewCartSchema.safeParse(raw ? JSON.parse(raw) : []);
      if (parsed.success) setReviewLines(parsed.data);
    } catch {
      /* An unreadable review bag starts empty; live carts stay in Shopify. */
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (storageReady)
      safeLocalStorageSetItem(REVIEW_BAG_KEY, JSON.stringify(reviewLines));
  }, [reviewLines, storageReady]);
  useEffect(() => {
    if (!preview || !storageReady || !catalog.data) return;
    const validVariants = new Set(
      catalog.data.products.flatMap((product) =>
        product.variants.map((variant) => variant.id),
      ),
    );
    setReviewLines((current) =>
      current.filter((line) => validVariants.has(line.variantId)),
    );
  }, [preview, storageReady, catalog.data]);

  const products = catalog.data?.products ?? [];
  const currentProduct = products.find(
    (product) => pathname === `/merch/${product.handle}`,
  );
  const isProductPage = pathname.startsWith("/merch/") && pathname !== "/merch/cart";
  // Retired preview items cannot reappear from an older saved bag.
  const lines = preview
    ? reviewLines.filter((line) =>
        products.some((p) => p.variants.some((v) => v.id === line.variantId)),
      )
    : (cart.data?.lines ?? []);
  const count = lines.reduce((total, line) => total + line.quantity, 0);

  const add = async (
    product: MerchProduct,
    variant: MerchVariant,
    quantity: number,
  ) => {
    if (busy) return;
    setMessage("");
    if (preview) {
      if (
        reviewLines.length >= 50 &&
        !reviewLines.some((line) => line.variantId === variant.id)
      ) {
        setMessage("Your review bag is full. Remove an item before adding another.");
        return;
      }
      setReviewLines((current) => {
        const existing = current.find((l) => l.variantId === variant.id);
        if (existing)
          return current.map((l) =>
            l.id === existing.id
              ? { ...l, quantity: Math.min(10, l.quantity + quantity) }
              : l,
          );
        return [
          ...current,
          {
            id: variant.id,
            variantId: variant.id,
            handle: product.handle,
            title: product.title,
            variantTitle: variant.title,
            quantity,
            image: variant.image ?? product.images[0] ?? null,
            price: null,
          },
        ];
      });
      setMessage("Added to your review bag.");
      setBagOpen(true);
      return;
    }
    const result = await addMutation
      .mutateAsync({ variantId: variant.id, quantity })
      .catch(() => null);
    if (!result) return;
    setMessage(result.message);
    if (result.success) {
      if (result.cart) utils.merch.getCart.setData(undefined, result.cart);
      else {
        setNeedsCartRefresh(true);
        void refreshCart();
      }
      setBagOpen(true);
    } else void cart.refetch();
  };
  const update = async (line: MerchCartLine, quantity: number) => {
    if (busy) return;
    setMessage("");
    if (preview) {
      setReviewLines((current) =>
        quantity === 0
          ? current.filter((l) => l.id !== line.id)
          : current.map((l) => (l.id === line.id ? { ...l, quantity } : l)),
      );
      return;
    }
    const result = await updateMutation
      .mutateAsync({ lineId: line.id, quantity })
      .catch(() => null);
    if (!result) return;
    setMessage(result.message);
    if (result.success) {
      if (result.cart) utils.merch.getCart.setData(undefined, result.cart);
      else {
        setNeedsCartRefresh(true);
        void refreshCart();
      }
    } else void cart.refetch();
  };
  const checkout = async () => {
    if (busy || preview) return;
    setMessage("");
    const result = await checkoutMutation.mutateAsync().catch(() => null);
    if (!result) return;
    setMessage(result.message);
    if (result.success) window.location.assign(result.checkoutUrl);
    else void cart.refetch();
  };

  return (
    <MerchContext.Provider
      value={{
        products,
        preview,
        loading: catalog.isLoading,
        error: catalog.isError,
        retry: () => {
          void catalog.refetch();
        },
        busy,
        message,
        add,
      }}
    >
      <div
        className="merch-store"
        style={
          {
            "--merch-wallpaper": `url("${IMG_WALLPAPER_HORIZON}")`,
          } as React.CSSProperties
        }
      >
        <a className="merch-skip" href="#merch-main">
          Skip to collection
        </a>
        <ContentBox
          title="Merch"
          subtitle={
            currentProduct
              ? `${currentProduct.category} / ${currentProduct.kind}`
              : "The Seichi collection"
          }
          defaultBackHref={isProductPage ? "/merch" : undefined}
          alreadyHasH1
          padding={false}
          topRightContent={
            <Button
              type="button"
              onClick={() => {
                setMessage("");
                setBagOpen(true);
              }}
              aria-label={`Open bag, ${count} items`}
              count={count}
            >
              <ShoppingBag className="mr-2 h-4 w-4" /> Bag
            </Button>
          }
        >
          <div id="merch-main">{children}</div>
        </ContentBox>
      </div>
      <Sheet open={bagOpen} onOpenChange={setBagOpen}>
        <SheetContent className="merch-bag" side="right">
          <SheetHeader>
            <SheetTitle>
              {preview ? "Your review bag" : "Your bag"} <span>({count})</span>
            </SheetTitle>
            <SheetDescription>
              {preview
                ? "Save your favourites for review. This bag does not place an order."
                : "Your favourites, ready for their next adventure."}
            </SheetDescription>
          </SheetHeader>
          {(cart.isError || needsCartRefresh) && !preview && (
            <div className="merch-inline-error">
              <p>Your bag couldn’t be loaded.</p>
              <button type="button" onClick={() => void refreshCart()}>
                Refresh bag
              </button>
            </div>
          )}
          {cart.isLoading && !preview ? (
            <p role="status">Loading your bag…</p>
          ) : lines.length === 0 ? (
            <div className="merch-empty-bag">
              <ShoppingBag size={48} strokeWidth={1} />
              <h3>Your next favourite is waiting.</h3>
              <p>Explore the collection and find a piece that feels like you.</p>
              <SheetClose className="merch-button">
                Keep exploring <ArrowRight size={16} />
              </SheetClose>
            </div>
          ) : (
            <>
              <ul className="merch-bag-lines">
                {lines.map((line) => (
                  <li key={line.id}>
                    {line.image && (
                      <Image
                        src={line.image.url}
                        alt={line.image.alt}
                        width={100}
                        height={120}
                      />
                    )}
                    <div>
                      <Link
                        href={`/merch/${line.handle}`}
                        onClick={() => setBagOpen(false)}
                      >
                        {line.title}
                      </Link>
                      <p>{line.variantTitle}</p>
                      <strong>{formatMerchMoney(line.price)}</strong>
                      <div className="merch-line-actions">
                        <div className="merch-quantity">
                          <button
                            type="button"
                            disabled={busy || line.quantity <= 1}
                            aria-label={`Decrease quantity of ${line.title}`}
                            onClick={() => void update(line, line.quantity - 1)}
                          >
                            <Minus size={14} />
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            disabled={busy || line.quantity >= 10}
                            aria-label={`Increase quantity of ${line.title}`}
                            onClick={() => void update(line, line.quantity + 1)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          className="merch-remove"
                          aria-label={`Remove ${line.title}`}
                          onClick={() => void update(line, 0)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="merch-bag-total">
                <span>{preview ? "Pricing" : "Subtotal"}</span>
                <strong>
                  {preview
                    ? "Confirmed at launch"
                    : formatMerchMoney(cart.data?.subtotal ?? null)}
                </strong>
              </div>
              <p className="merch-cart-shipping">
                Shipping and any applicable taxes are calculated at checkout.
              </p>
              <button
                className="merch-button"
                type="button"
                disabled={
                  busy || preview || !catalog.data?.checkoutEnabled || cart.isError
                }
                onClick={() => void checkout()}
              >
                {needsCartRefresh
                  ? "Refresh your bag to continue"
                  : busy
                    ? "One moment…"
                    : preview || !catalog.data?.checkoutEnabled
                      ? "Checkout opens at launch"
                      : "Secure checkout"}
                <ArrowRight size={17} />
              </button>
              <SheetClose className="merch-continue">Continue exploring</SheetClose>
            </>
          )}
          {message && (
            <p role="status" className="merch-bag-message">
              <Check size={16} />
              {message}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </MerchContext.Provider>
  );
}
