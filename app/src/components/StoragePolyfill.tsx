"use client";

/**
 * StoragePolyfill Component
 *
 * This component polyfills localStorage and sessionStorage for environments
 * where they are null (e.g., Android WebView without DOM storage enabled).
 *
 * The polyfill creates an in-memory storage implementation that prevents
 * errors when libraries like Clerk.js try to access storage methods.
 */

// In-memory storage implementation
class MemoryStorage implements Storage {
  private data: Map<string, string> = new Map();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.data.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

// Apply polyfill immediately when this module loads (client-side only)
if (typeof window !== "undefined") {
  // Check if localStorage is null or inaccessible
  try {
    if (window.localStorage === null) {
      const memoryLocalStorage = new MemoryStorage();
      Object.defineProperty(window, "localStorage", {
        value: memoryLocalStorage,
        writable: false,
        configurable: true,
      });
    }
  } catch {
    // localStorage might throw in some environments
    const memoryLocalStorage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: memoryLocalStorage,
      writable: false,
      configurable: true,
    });
  }

  // Check if sessionStorage is null or inaccessible
  try {
    if (window.sessionStorage === null) {
      const memorySessionStorage = new MemoryStorage();
      Object.defineProperty(window, "sessionStorage", {
        value: memorySessionStorage,
        writable: false,
        configurable: true,
      });
    }
  } catch {
    // sessionStorage might throw in some environments
    const memorySessionStorage = new MemoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: memorySessionStorage,
      writable: false,
      configurable: true,
    });
  }
}

/**
 * StoragePolyfill component - renders children without any wrapper element.
 * The polyfill is applied when this module is imported (side effect).
 */
export function StoragePolyfill({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
