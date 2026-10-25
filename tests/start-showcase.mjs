// Static-only server: no authentication, database, API or .env is loaded.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const relative = pathname.startsWith("/OutdoorsWeb/")
    ? pathname.slice("/OutdoorsWeb/".length)
    : null;
  if (
    relative === null ||
    (relative !== "" && !/^assets\/[\w.-]+$/.test(relative))
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    const file = path.join("tmp/showcase-build", relative || "index.html");
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}).listen(3113, "127.0.0.1", () => console.log("Static showcase ready"));
