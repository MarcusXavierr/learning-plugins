/** Runs tasks one at a time in the order `run` was called. A failed task rejects only its own `run`. */
export interface SerialQueue { run<T>(task: () => Promise<T>): Promise<T> }

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
