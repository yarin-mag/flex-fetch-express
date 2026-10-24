import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoAbortMiddleware, abortControllerStorage } from '../src/index.js';
import { fetchWithAbort } from '../src/fetch.js';
import { raceWithAbort } from '../src/race.js';

class MockRequest extends EventEmitter {
  complete = true;
}

class MockResponse extends EventEmitter {
  writableFinished = false;
}

describe('autoAbortMiddleware', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets Connection: close and preserves caller headers', async () => {
    let observedHeaders: Headers | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        observedHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response('ok'));
      })
    );

    await fetchWithAbort('https://example.test/headers', {
      headers: { 'X-Trace': 'present', Connection: 'keep-alive' }
    });

    expect(observedHeaders?.get('x-trace')).toBe('present');
    expect(observedHeaders?.get('connection')).toBe('close');
  });

  it.each(['aborted', 'close'] as const)(
    'aborts an in-flight fetch on request %s',
    async (eventName) => {
      const request = new MockRequest() as Request;
      request.complete = false;
      const response = new MockResponse() as Response;
      let observedSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
          observedSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            observedSignal?.addEventListener(
              'abort',
              () => reject(observedSignal?.reason),
              { once: true }
            );
          });
        })
      );

      let outgoingRequest: Promise<Response> | undefined;
      const next = vi.fn(() => {
        outgoingRequest = fetchWithAbort('https://example.test/disconnected');
      }) as unknown as NextFunction;

      autoAbortMiddleware(request, response, next);
      request.emit(eventName);

      await expect(outgoingRequest).rejects.toBeInstanceOf(Error);
      expect(observedSignal?.aborted).toBe(true);
    }
  );

  it('aborts an in-flight fetch when the client closes the response', async () => {
    const request = new MockRequest() as Request;
    const response = new MockResponse() as Response;
    let observedSignal: AbortSignal | undefined;
    const delayedFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener(
          'abort',
          () => reject(observedSignal?.reason),
          { once: true }
        );
      });
    });
    vi.stubGlobal('fetch', delayedFetch);

    let outgoingRequest: Promise<Response> | undefined;
    const next = vi.fn(() => {
      outgoingRequest = fetchWithAbort('https://example.test/slow');
    }) as unknown as NextFunction;

    autoAbortMiddleware(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(false);

    response.emit('close');

    await expect(outgoingRequest).rejects.toBeInstanceOf(Error);
    expect(observedSignal?.aborted).toBe(true);
  });

  it('does not abort when the response finishes normally', async () => {
    const request = new MockRequest() as Request;
    const response = new MockResponse() as Response;
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response('ok'));
      })
    );

    let outgoingRequest: Promise<Response> | undefined;
    const next = vi.fn(() => {
      outgoingRequest = fetchWithAbort('https://example.test/ok');
    }) as unknown as NextFunction;

    autoAbortMiddleware(request, response, next);
  request.emit('close');
    response.writableFinished = true;
    response.emit('finish');
    response.emit('close');

    await expect(outgoingRequest).resolves.toBeInstanceOf(Response);
    expect(observedSignal?.aborted).toBe(false);
  });

  it('keeps the controller isolated to the active request context', () => {
    expect(abortControllerStorage.getStore()).toBeUndefined();
  });

  it('aborts losing fetch work when the first race task resolves', async () => {
    let observedSignal: AbortSignal | undefined;
    const delayedFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener(
          'abort',
          () => reject(observedSignal?.reason),
          { once: true }
        );
      });
    });
    vi.stubGlobal('fetch', delayedFetch);

    await expect(
      raceWithAbort([
        async () => 'quick result',
        async () => fetchWithAbort('https://example.test/slow')
      ])
    ).resolves.toBe('quick result');

    expect(delayedFetch).toHaveBeenCalledOnce();
    expect(observedSignal?.aborted).toBe(true);
  });
});