const APPAREL_CARE =
  "Machine wash cold, inside out, on a gentle cycle. Avoid ironing the print. Follow the garment’s care label.";

export const MERCH_PRODUCT_DETAILS: Record<
  string,
  {
    material: string;
    features: string;
    sizing: string;
    care: string;
    sizeGuide?: Array<{ size: string; waist: string; hips: string }>;
  }
> = {
  "Wide-Leg Joggers": {
    material:
      "US/Mexico fulfillment: 96% recycled polyester, 4% elastane. Latvia fulfillment: 95% recycled polyester, 5% elastane. 308 g/m².",
    features:
      "Relaxed wide-leg fit, side pockets and an elastic drawstring waistband. A single graphic sits on the left thigh. White base fabric may show slightly at seams and folds.",
    sizing:
      "Unisex sizes 2XS–6XL. Measure your waist and hips and compare with the body measurements below. Measurements are shown in centimetres / inches.",
    care: APPAREL_CARE,
    sizeGuide: [
      { size: "2XS", waist: "72 / 28 ⅜", hips: "90 / 35 ⅜" },
      { size: "XS", waist: "76 / 29 ⅞", hips: "94 / 37" },
      { size: "S", waist: "80 / 31 ½", hips: "98 / 38 ⅝" },
      { size: "M", waist: "84 / 33 ⅛", hips: "102 / 40 ⅛" },
      { size: "L", waist: "92 / 36 ¼", hips: "110 / 43 ¼" },
      { size: "XL", waist: "100 / 39 ⅜", hips: "118 / 46 ½" },
      { size: "2XL", waist: "108 / 42 ½", hips: "126 / 49 ⅝" },
      { size: "3XL", waist: "116 / 45 ⅝", hips: "134 / 52 ¾" },
      { size: "4XL", waist: "124 / 48 ⅞", hips: "142 / 55 ⅞" },
      { size: "5XL", waist: "132 / 52", hips: "150 / 59" },
      { size: "6XL", waist: "140 / 55 ⅛", hips: "158 / 62 ¼" },
    ],
  },
  "Organic T-Shirt": {
    material: "100% organic ring-spun cotton, 180 g/m².",
    features: "Regular fit with a soft cotton feel and a large back graphic.",
    sizing:
      "European sizing; US customers may prefer a size larger. Garment measurements (half chest × body length): S 49.5 × 69 cm; M 53.5 × 73 cm; L 56.5 × 75 cm; XL 59.5 × 77 cm; 2XL 63.5 × 79 cm. Compare a favourite tee laid flat.",
    care: APPAREL_CARE,
  },
  "Organic Hoodie": {
    material:
      "US fulfillment: 80% organic cotton, 20% recycled polyester. European fulfillment: 85% organic cotton, 15% recycled polyester. 280 g/m².",
    features: "Regular fit with side pockets and a large back graphic.",
    sizing:
      "Sizes for this style follow US sizing. European customers should check the manufacturer’s measurements and may prefer one size smaller.",
    care: APPAREL_CARE,
  },
  "Organic Sweatshirt": {
    material: "100% organic ring-spun combed cotton, 350 g/m².",
    features:
      "Regular fit crewneck with a substantial fabric weight and large back graphic.",
    sizing:
      "European sizing; US customers may prefer a size larger. Compare the manufacturer’s measurements with a sweatshirt you already wear.",
    care: APPAREL_CARE,
  },
  "Oversized Sweatshirt": {
    material:
      "US fulfillment: 80% organic cotton, 20% recycled polyester. European fulfillment: 100% organic cotton. 350 g/m².",
    features: "Oversized fit with a brushed interior and a large back graphic.",
    sizing:
      "Sizes for this style follow US sizing. European customers may prefer one size smaller; this garment is intentionally oversized.",
    care: APPAREL_CARE,
  },
  "Organic Tote": {
    material: "100% certified organic cotton twill, 272 g/m².",
    features:
      "Open compartment, flat bottom and dual straps. Capacity 23 litres; maximum load 13.6 kg.",
    sizing: "50.8 × 35.6 × 12.7 cm. Strap length 63.5 cm.",
    care: "Follow the care label; avoid bleach, dry cleaning and tumble drying.",
  },
  "Black Glossy Mug": {
    material: "Glossy ceramic.",
    features:
      "Choose 11 oz or 15 oz. The black shade of the printed area can differ slightly from the ceramic.",
    sizing: "11 oz: 9.8 × 8.5 cm; 15 oz: 12 × 8.5 cm (height × diameter).",
    care: "Dishwasher and microwave safe.",
  },
  "Straw Lid Water Bottle": {
    material:
      "Double-walled stainless steel with vacuum insulation; plastic lid and foldable straw.",
    features: "Rotating handle, glossy finish and anti-slip patch.",
    sizing: "32 oz / 950 ml. Height 25.2 cm; diameter 9 cm.",
    care: "Hand-wash only. Do not put in the dishwasher or microwave.",
  },
  "Utility Backpack": {
    material:
      "100% polyester, 330 g/m². Water-resistant fabric; contains no recycled material.",
    features:
      "Multiple compartments, a zippered laptop pocket, side mesh pockets and adjustable straps.",
    sizing: "Capacity 16.1 litres; maximum load 5 kg.",
    care: "Follow the sewn-in care instructions. Empty the bag before cleaning.",
  },
};

export function normalizeMerchKind(value: string) {
  const text = value.toLowerCase();
  if (text.includes("jogger")) return "Wide-Leg Joggers";
  if (text.includes("oversized")) return "Oversized Sweatshirt";
  if (text.includes("hoodie")) return "Organic Hoodie";
  if (text.includes("crewneck") || text.includes("sweatshirt"))
    return "Organic Sweatshirt";
  if (text.includes("tee") || text.includes("t-shirt")) return "Organic T-Shirt";
  if (text.includes("tote")) return "Organic Tote";
  if (text.includes("mug")) return "Black Glossy Mug";
  if (text.includes("bottle")) return "Straw Lid Water Bottle";
  if (text.includes("backpack")) return "Utility Backpack";
  return value;
}
