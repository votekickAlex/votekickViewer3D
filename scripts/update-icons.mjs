// Syncs the user-provided icon sources into the bundled icon set:
//
//   app.ico -> src-tauri/icons/icon.ico   (exe / installer / shortcut icon)
//
// and clears the cached Windows resource, because the generated resource
// script only references the .ico path - cargo cannot detect that the file
// CONTENT changed, so without this step the exe keeps the old icon.
//
// Usage: npm run icons   (after replacing app.ico; if logo.png changed as
// well, also run `npx tauri icon logo.png` once to refresh the PNG set)
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const icons = path.join(root, "src-tauri", "icons");

copyFileSync(path.join(root, "app.ico"), path.join(icons, "icon.ico"));

const build = path.join(root, "src-tauri", "target", "release", "build");
if (existsSync(build)) {
  for (const dir of readdirSync(build)) {
    if (dir.startsWith("votekickviewer3d-")) {
      rmSync(path.join(build, dir), { recursive: true, force: true });
    }
  }
}

console.log("icon.ico updated, build icon cache cleared - rebuild to re-embed");
