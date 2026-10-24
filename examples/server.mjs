import express from 'express';
import {
  abortControllerStorage,
  autoAbortMiddleware,
  fetchWithAbort,
  raceWithAbort
} from '../dist/index.mjs';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const postTimeoutRuns = { quick: 0, slow: 0 };

app.use(autoAbortMiddleware);

app.get('/stats', (_request, response) => {
  response.json({ postTimeoutRuns });
});

app.get('/work/:speed', (request, response) => {
  const durations = { quick: 150, slow: 5000 };
  const duration = durations[request.params.speed];

  if (duration === undefined) {
    response.status(404).json({ error: 'Unknown work speed' });
    return;
  }

  const signal = abortControllerStorage.getStore()?.signal;
  let timer;
  const onAbort = () => {
    clearTimeout(timer);
    console.log(`${request.params.speed}: server-side work aborted before timeout; code after timeout did not run`);
  };

  if (signal?.aborted) {
    onAbort();
    return;
  }

  signal?.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => {
    postTimeoutRuns[request.params.speed] += 1;
    console.log(`${request.params.speed}: timeout finished; code after timeout ran`);
    response.json({ result: `${request.params.speed} work finished` });
  }, duration);
  response.once('finish', () => signal?.removeEventListener('abort', onAbort));
});

app.get('/race', async (request, response, next) => {
  const origin = `${request.protocol}://${request.get('host')}`;
  const fetchWork = (speed) => async () => {
    try {
      return await (await fetchWithAbort(`${origin}/work/${speed}`)).json();
    } catch (error) {
      if (speed === 'slow' && error instanceof Error && error.name === 'AbortError') {
        console.log('slow: outgoing fetch aborted; its post-timeout code did not run');
      }
      throw error;
    }
  };

  try {
    const winner = await raceWithAbort([
      fetchWork('quick'),
      fetchWork('slow')
    ]);

    response.json({ winner, note: 'The slower operation was cancelled.' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    next(error);
  }
});

app.listen(port, () => {
  console.log(`flex-fetch demo (npm: flex-fetch-express) listening at http://localhost:${port}`);
});