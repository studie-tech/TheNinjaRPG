import { describe, expect, it } from "vitest";
import { isUrlAccessible } from "./route";

describe("daily-link-cleaner", () => {
  it("should correctly identify accessible utfs.io URLs", async () => {
    const url =
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJUvE8xxILCIhwPniJ69VxpvAbTDWkOyGzS8rM";
    const isAccessible = await isUrlAccessible(url);
    expect(isAccessible).toBe(true);
  }, 10000); // Increase timeout to 10s for real network requests

  it("should correctly identify inaccessible URLs", async () => {
    const url =
      "https://nonexistent-url-that-should-never-exist-12345.example.com/image.jpg";
    const isAccessible = await isUrlAccessible(url);
    expect(isAccessible).toBe(false);
  }, 10000); // Increase timeout to 10s for real network requests
});
