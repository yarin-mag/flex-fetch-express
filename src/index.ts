import type { Request, Response, RequestHandler } from 'express';
import { abortControllerStorage } from './store.js';

export { abortControllerStorage };

function removeDisconnectListeners(
  request: Request,
  response: Response,
  triggerAbort: () => void,
  onRequestClose: () => void,
  onResponseClose: () => void,
  onResponseFinish: () => void
): void {
  request.off('aborted', triggerAbort);
  request.off('close', onRequestClose);
  response.off('close', onResponseClose);
  response.off('finish', onResponseFinish);
}

export const autoAbortMiddleware: RequestHandler = (request, response, next) => {
  const controller = new AbortController();

  const triggerAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const onRequestClose = (): void => {
    if (request.complete === false) {
      triggerAbort();
    }
  };
  const onResponseClose = (): void => {
    if (!response.writableFinished) {
      controller.abort();
    }
    removeDisconnectListeners(
      request,
      response,
      triggerAbort,
      onRequestClose,
      onResponseClose,
      onResponseFinish
    );
  };
  const onResponseFinish = (): void => {
    removeDisconnectListeners(
      request,
      response,
      triggerAbort,
      onRequestClose,
      onResponseClose,
      onResponseFinish
    );
  };

  request.once('aborted', triggerAbort);
  request.once('close', onRequestClose);
  response.once('close', onResponseClose);
  response.once('finish', onResponseFinish);

  abortControllerStorage.run(controller, next);
};

export { fetchWithAbort } from './fetch.js';
export { raceWithAbort } from './race.js';