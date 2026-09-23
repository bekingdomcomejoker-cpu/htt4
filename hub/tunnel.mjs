#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BIN = process.env.CLOUDFLARED_BIN || "/tmp/bin/cloudflared";
const TARGET = process.env.OMEGA_TUNNEL_TARGET || "http://127.0.0.1:8790";
const OUT = path.join(ROOT, "public-url.txt");

const child = spawn(
  BIN,
  ["tunnel", "--url", TARGET, "--no-autoupdate"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

function harvest(buf) {
  const text = buf.toString("utf8");
  process.stderr.write(text);
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) {
    writeFileSync(OUT, m[0]);
    console.log(`[omega-tunnel] public ${m[0]}`);
  }
}

child.stdout.on("data", harvest);
child.stderr.on("data", harvest);
child.on("exit", (code) => {
  console.error(`[omega-tunnel] exited ${code}`);
  process.exit(code || 0);
});
