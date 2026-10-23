// Keep the deadline active until the response body has been consumed.
export async function readResponse(url, options, consume, timeoutMs = 15000) {
  const controller = new AbortController();
  const upstream = options.signal;
  const cancel = () => controller.abort(upstream.reason);
  if (upstream?.aborted) cancel();
  else upstream?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await consume(response);
    return { response, body };
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", cancel);
  }
}
