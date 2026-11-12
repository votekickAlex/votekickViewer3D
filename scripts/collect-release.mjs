// Collects finished build artifacts into release/ so that the large build
// cache in src-tauri/target stays untouched.
//
//   release/
//     !votekickViewer3D_<version>_x64-setup.exe   <- installer
//     portable/!votekickViewer3D-<version>-portable.zip  <- portable version
//
// Usage: node scripts/collect-release.mjs   (after `npm run tauri build`)
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "src-tauri", "target", "release");
const out = path.join(root, "release");

const version = JSON.parse(
  execSync("npm pkg get version", { cwd: root, encoding: "utf8" }),
).trim().replaceAll('"', "");

// File names deliberately avoid special characters; the "!" lives only in
// the window title.
const name = "votekickViewer3D";

// --- installer ---
const nsisDir = path.join(target, "bundle", "nsis");
const installers = readdirSync(nsisDir).filter((f) => f.endsWith("-setup.exe"));
if (installers.length === 0) {
  console.error("No NSIS installer found in", nsisDir);
  process.exit(1);
}

// --- portable: the raw exe is fully self-contained ---
// Tauri names the binary via mainBinaryName; fall back to the crate name.
const exe = [path.join(target, `${name}.exe`), path.join(target, "votekickviewer3d.exe")].find(
  (candidate) => existsSync(candidate),
);
if (!exe) {
  console.error("No application exe found in", target);
  process.exit(1);
}

mkdirSync(path.join(out, "portable"), { recursive: true });

for (const file of installers) {
  // Normalize stale names too: strip any "!" from the copied file name.
  const destName = file.replaceAll("!", "");
  copyFileSync(path.join(nsisDir, file), path.join(out, destName));
  console.log("installer:", path.join("release", destName));
}

const portableDir = path.join(out, "portable", `${name}-${version}-portable`);
rmSync(portableDir, { recursive: true, force: true });
mkdirSync(portableDir, { recursive: true });
copyFileSync(exe, path.join(portableDir, `${name}.exe`));
copyFileSync(path.join(root, "LICENSE"), path.join(portableDir, "LICENSE.txt"));

const zip = path.join(
  out,
  "portable",
  `${name}-${version}-portable.zip`,
);
rmSync(zip, { force: true });
execSync(`tar -a -c -f "${zip}" -C "${path.dirname(portableDir)}" "${path.basename(portableDir)}"`, {
  stdio: "inherit",
});
console.log("portable :", path.relative(root, zip));
