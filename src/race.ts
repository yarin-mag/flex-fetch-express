import { abortControllerStorage } from './store.js';

export async function raceWithAbort<T>(
  tasks: readonly (() => T | PromiseLike<T>)[]
): Promise<T> {
  if (tasks.length === 0) {
    throw new TypeError('raceWithAbort requires at least one task');
  }

  const parentController = abortControllerStorage.getStore();
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(parentController?.signal.reason);

  if (parentController?.signal.aborted) {
    abortFromParent();
  } else {
    parentController?.signal.addEventListener('abort', abortFromParent, { once: true });
  }

  try {
    return await abortControllerStorage.run(controller, async () => {
      const aborted = new Promise<never>((_resolve, reject) => {
        const rejectWithAbort = (): void => reject(controller.signal.reason);

        if (controller.signal.aborted) {
          rejectWithAbort();
        } else {
          controller.signal.addEventListener('abort', rejectWithAbort, { once: true });
        }
      });

      const taskPromises = tasks.map((task) => Promise.resolve().then(task));
      return Promise.race([...taskPromises, aborted]);
    });
  } finally {
    controller.abort();
    parentController?.signal.removeEventListener('abort', abortFromParent);
  }
}