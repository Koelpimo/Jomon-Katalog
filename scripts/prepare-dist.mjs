import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

const files = [
  "index.html",
  "manifest.json",
  ".nojekyll",
  "favicon.ico",
  "favicon.webp",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "apple-touch-icon.png",
];

const dirs = ["src", "vendor", "fonts"];

if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
}
mkdirSync(dist, { recursive: true });

for (const file of files) {
  const src = join(root, file);
  if (existsSync(src)) {
    cpSync(src, join(dist, file));
  }
}

for (const dir of dirs) {
  const src = join(root, dir);
  if (existsSync(src)) {
    cpSync(src, join(dist, dir), { recursive: true });
  }
}

console.log("dist/ bereit für Deploy");
