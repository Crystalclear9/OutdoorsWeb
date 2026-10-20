// Reserve permits for queued work so new arrivals cannot bypass waiting tasks.
export function createWorkQueue({ concurrency, maxWaiting, message }) {
  let active = 0;
  const waiting = [];
  return async function run(task) {
    if (active >= concurrency) {
      if (waiting.length >= maxWaiting)
        throw Object.assign(new Error(message), { status: 503 });
      await new Promise((resolve) => waiting.push(resolve));
    } else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
