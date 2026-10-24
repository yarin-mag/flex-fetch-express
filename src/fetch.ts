import { abortControllerStorage } from './store.js';

function withConnectionClose(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): RequestInit {
  const inputHeaders =
    typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? inputHeaders);
  headers.set('Connection', 'close');
  return { ...init, headers };
}

function combineSignals(signals: AbortSignal[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  const listeners = signals.map((signal) => {
    const listener = (): void => abortFrom(signal);
    return { signal, listener };
  });

  for (const { signal } of listeners) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
  }

  if (!controller.signal.aborted) {
    for (const { signal, listener } of listeners) {
      signal.addEventListener('abort', listener, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    }
  };
}

export async function fetchWithAbort(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const requestController = abortControllerStorage.getStore();
  if (!requestController) {
    return globalThis.fetch(input, withConnectionClose(input, init));
  }

  const inputSignal =
    typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined;
  const callerSignal = init?.signal ?? inputSignal;

  if (!callerSignal || callerSignal === requestController.signal) {
    return globalThis.fetch(input, {
      ...withConnectionClose(input, init),
      signal: requestController.signal
    });
  }

  const combined = combineSignals([requestController.signal, callerSignal]);
  try {
    return await globalThis.fetch(input, {
      ...withConnectionClose(input, init),
      signal: combined.signal
    });
  } finally {
    combined.cleanup();
  }
}