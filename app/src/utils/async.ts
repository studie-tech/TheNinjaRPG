/**
 * Create a queue that runs async operations one at a time, in call order. The returned
 * function resolves or rejects with its own operation; a failure never blocks the next one.
 */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = tail.then(operation);
    tail = pending.catch(() => undefined);
    return pending;
  };
};
