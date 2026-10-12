/**
 * sse.js
 *
 * Server-Sent Events framing for the service -> browser stream (docs/service.md).
 * The browser reads it with EventSource; Node (tests, scripts/e2e.js) uses readSse.
 */

/** One SSE frame: `event: <name>` and a single-line JSON `data:`. */
export function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Reads an SSE body and calls `onEvent(name, data)` for every complete event. JSON data
 * is parsed; anything else is passed as the raw string. Resolves when the stream ends.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: string, data: unknown) => void} onEvent
 */
export async function readSse(body, onEvent) {
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data = [];

  const dispatch = () => {
    if (data.length > 0) {
      const raw = data.join("\n");
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // not JSON: pass the raw string through
      }
      onEvent(event, parsed);
    }
    event = "message";
    data = [];
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") dispatch();
      else if (line.startsWith(":")) continue;
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
  }
}
