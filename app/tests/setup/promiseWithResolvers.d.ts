/** Bun implements this ES2024 method for test latches; the project's ES2022 `lib` leaves it untyped. */
interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}
