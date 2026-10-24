# flex-fetch (npm package: `flex-fetch-express`)

Automatically cancel outgoing `fetch` requests when an Express client disconnects or when another task wins a race. The middleware stores one `AbortController` per incoming request with Node.js `AsyncLocalStorage`; `fetchWithAbort` picks up its signal from anywhere in that asynchronous request chain.

## The problem

When a client closes a page or loses its connection, backend work often continues. Downstream database and HTTP calls can keep running even though nobody will receive the response. Passing an `AbortSignal` through every application function is easy to forget. This package propagates cancellation through request-local async context instead.

## Requirements

- Node.js 18 or newer, with the global `fetch` API available.
- Express 4 or newer.

## Installation

```sh
npm install flex-fetch-express
```

## Quick start

```ts
import express from 'express';
import { autoAbortMiddleware, fetchWithAbort } from 'flex-fetch-express';

const app = express();

app.use(autoAbortMiddleware);

app.get('/profile', async (_req, res, next) => {
  try {
    const upstream = await fetchWithAbort('https://api.example.com/profile');
    res.json(await upstream.json());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    next(error);
  }
});

app.listen(3000);
```

The middleware aborts the request-local controller if the response connection closes before the response finishes, or if the incoming request itself is aborted. It does not abort after a normal response finish. Register it before routes that make outgoing calls.

## Caller-provided signals

If `fetchWithAbort` receives an explicit `init.signal` (or a `Request` with a signal), it combines that signal with the Express disconnect signal. Either cancellation source can abort the fetch. Outside an `autoAbortMiddleware` context, the wrapper delegates to native `fetch` unchanged.

## API

- `autoAbortMiddleware`: Express middleware that establishes request-scoped cancellation.
- `abortControllerStorage`: the shared `AsyncLocalStorage<AbortController>` instance for advanced integrations.
- `fetchWithAbort(input, init?)`: native-fetch-compatible wrapper with automatic cancellation.

Use `fetchWithAbort` for requests that should be tied to the Express response. Native `fetch` is not patched globally; this keeps behavior explicit and avoids changing unrelated code.

## Cancel losing race tasks

`Promise.race` returns the first settled result but does not cancel its other promises. Use `raceWithAbort` with task factories to run them in a child async context. Any losing `fetchWithAbort` calls are cancelled automatically, and cancellation from the parent Express request is inherited:

```ts
import { fetchWithAbort, raceWithAbort } from 'flex-fetch-express';

const result = await raceWithAbort([
  () => calculateQuickly(),
  async () => {
    const response = await fetchWithAbort('https://api.example.com/slow');
    return response.json();
  }
]);
```

Tasks should use `fetchWithAbort` or another API that observes the active abort signal to stop its underlying work. `raceWithAbort` also rejects promptly when the incoming Express request is cancelled.

## Motivation demo

Run `npm run demo` and open `http://localhost:3000/race`. The quick upstream work wins and the slow work is aborted before its five-second timeout. The server logs that the slow task's code after timeout did not run. Check `http://localhost:3000/stats`: `postTimeoutRuns.quick` increments, while `postTimeoutRuns.slow` stays at `0`. Open `/race` then disconnect before it responds to see request-disconnect cancellation as well.