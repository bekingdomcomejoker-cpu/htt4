import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./.vercel/output/functions/__server.func/index.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), ".vercel/output/static");
const port = Number(process.env.PORT || 3000);
const types = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0]);
  const candidate = normalize(join(root, decoded));
  return candidate.startsWith(root) ? candidate : null;
}

async function bodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const path = req.url?.split("?", 1)[0] || "/";
    if (req.method === "GET" || req.method === "HEAD") {
      const target = staticPath(path);
      if (target) {
        try {
          const body = await readFile(target);
          res.statusCode = 200;
          res.setHeader("content-type", types[extname(target)] || "application/octet-stream");
          res.setHeader("cache-control", path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300");
          res.end(req.method === "HEAD" ? undefined : body);
          return;
        } catch {}
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await bodyBuffer(req);
    const request = new Request(`http://${req.headers.host || `127.0.0.1:${port}`}${req.url || "/"}`, {
      method: req.method,
      headers,
      body,
      duplex: "half",
    });
    const response = await handler.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => console.log(`OMEGA Mesh listening on ${port}`));
