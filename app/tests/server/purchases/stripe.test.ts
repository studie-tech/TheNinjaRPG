// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { stripeCheckout } from "@/drizzle/schema";
import { invoiceCoverage } from "@/server/utils/stripe/fulfillment";
import { validFederalPrice } from "@/server/utils/stripe/client";
import { stripeCheckoutSchema } from "@/validators/stripe";

const checkout = { federalStatus: "GOLD", priceId: "price_gold", amountCents: 1500 } as typeof stripeCheckout.$inferSelect;
const invoice = (overrides: Record<string, unknown> = {}) => ({ automatic_tax: { enabled: true, status: "complete" }, status: "paid", currency: "usd", livemode: false, total: 1500, lines: { has_more: false, data: [{ amount: 1500, quantity: 1, pricing: { price_details: { price: "price_gold" } }, period: { start: 1700000000, end: 1702600000 }, parent: { subscription_item_details: { proration: false } } }] }, ...overrides }) as unknown as Stripe.Invoice;

describe("Stripe checkout and paid coverage validation", () => {
  it("uses a paid invoice's exact billing period", () => {
    expect(invoiceCoverage(invoice(), checkout)).toEqual({ purchasedAt: new Date(1700000000000), expiresAt: new Date(1702600000000) });
  });
  it("retains the billed tier when Danish VAT is included in the fixed total", () => {
    // Stripe keeps line.amount inclusive while subtotal excludes the VAT.
    const taxed = invoice({ automatic_tax: { enabled: true, status: "complete" }, total_excluding_tax: 1200 });
    const line = taxed.lines.data[0];
    if (line) {
      line.subtotal = 1200;
      line.taxes = [{ amount: 300, tax_behavior: "inclusive" }] as Stripe.InvoiceLineItem.Tax[];
    }
    expect(invoiceCoverage(taxed, checkout)).not.toBeNull();
    expect(invoiceCoverage(invoice({ automatic_tax: { enabled: true, status: "complete" }, total_excluding_tax: 1500 }), checkout)).not.toBeNull();
  });
  it.each([undefined, { enabled: false, status: "complete" }])("rejects missing or disabled automatic tax: %j", (automatic_tax) => {
    expect(invoiceCoverage(invoice({ automatic_tax }), checkout)).toBeNull();
  });
  it.each(["failed", "requires_location_inputs"])("rejects an incomplete tax calculation: %s", (status) => {
    expect(invoiceCoverage(invoice({ automatic_tax: { enabled: true, status } }), checkout)).toBeNull();
  });
  it.each([{ status: "open" }, { currency: "dkk" }, { livemode: true }, { total: 1000 }, { lines: { data: [], has_more: false } }])("rejects unpaid, foreign, sandbox-mismatched and wrong-price invoices: %j", (changes) => {
    expect(invoiceCoverage(invoice(changes), checkout)).toBeNull();
  });
  it("rejects proration and incomplete invoice line pagination", () => {
    const prorated = invoice();
    if (prorated.lines.data[0]?.parent?.subscription_item_details) prorated.lines.data[0].parent.subscription_item_details.proration = true;
    expect(invoiceCoverage(prorated, checkout)).toBeNull();
    const paginated = invoice(); paginated.lines.has_more = true;
    expect(invoiceCoverage(paginated, checkout)).toBeNull();
  });
  it("only accepts the configured fixed USD monthly price", () => {
    const price = { active: true, currency: "usd", tax_behavior: "inclusive", unit_amount: 1500, type: "recurring", recurring: { interval: "month", interval_count: 1 } } as Stripe.Price;
    expect(validFederalPrice(price, "GOLD")).toBe(true);
    expect(validFederalPrice({ ...price, currency: "dkk" }, "GOLD")).toBe(false);
    expect(validFederalPrice({ ...price, unit_amount: 1000 }, "GOLD")).toBe(false);
    expect(validFederalPrice({ ...price, tax_behavior: "exclusive" }, "GOLD")).toBe(false);
    expect(validFederalPrice({ ...price, tax_behavior: "unspecified" }, "GOLD")).toBe(false);
  });
  it("rejects fractional, negative and client-supplied monetary purchase inputs", () => {
    const input = { requestId: "abcdefghijklmnopqrstu", expectedUserId: "buyer", userId: "recipient", purchase: { type: "reputation", reputationPoints: 20 } };
    expect(stripeCheckoutSchema.safeParse(input).success).toBe(true);
    for (const reputationPoints of [-1, 0, 20.5, Infinity]) expect(stripeCheckoutSchema.safeParse({ ...input, purchase: { type: "reputation", reputationPoints } }).success).toBe(false);
  });
});
