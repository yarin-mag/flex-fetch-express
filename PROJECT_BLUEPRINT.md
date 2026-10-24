# Project Blueprint

## Purpose

`flex-fetch` (published on npm as `flex-fetch-express`) connects the lifetime of an Express response and competing async tasks to outgoing HTTP work. Client disconnects abort request-scoped work; `raceWithAbort` aborts losing tasks after the first task settles.

## Runtime Flow

1. `autoAbortMiddleware` creates an `AbortController` for each incoming request.
2. It subscribes to request-aborted/incomplete-close and premature response-close events. A normal response `finish` removes those listeners without aborting.
3. It calls Express `next()` inside the singleton `abortControllerStorage.run(controller, ...)` context.
4. `fetchWithAbort` reads the active controller from `AsyncLocalStorage` and passes its signal to native `fetch`.
5. When a caller also supplies a signal, both are combined so either can cancel the outgoing request.
6. `raceWithAbort` creates a child async context, starts task factories within it, and aborts the child controller once the first task settles. Parent request cancellation propagates into the child.

## Repository Layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Shared async-local store and Express lifecycle middleware; public exports. |
| `src/fetch.ts` | Fetch wrapper and caller/context signal composition. |
| `src/race.ts` | Race task factories and cancel losing work through a child context. |
| `tests/middleware.test.ts` | Disconnect cancellation and normal response completion tests. |
| `examples/server.mjs` | Express demonstration with competing quick/slow fetch operations. |
| `tsup.config.ts` | ESM/CJS bundles, declarations, and source maps. |
| `tsconfig.json` | Strict TypeScript configuration for Node.js 18+. |

## Public API

- `autoAbortMiddleware`: Express `RequestHandler`.
- `abortControllerStorage`: singleton `AsyncLocalStorage<AbortController>`.
- `fetchWithAbort`: native `fetch` wrapper.
- `raceWithAbort(tasks)`: first-settled task runner that cancels losing wrapped requests.

## Development

- `npm test`: run Vitest.
- `npm run build`: create ESM (`.mjs`), CommonJS (`.cjs`), and declaration outputs in `dist/`.

The package does not monkey-patch global `fetch`. Add optional integrations as separate modules if they can preserve the same request-scoped cancellation semantics without increasing the core dependency footprint.