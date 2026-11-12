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

// Build artifact file names deliberately avoid special characters; the "!"
// lives in the display name (window title, shortcuts, install folder).
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

// Stale artifacts from earlier builds may linger in the bundle dir; if two
// files normalize to the same name the release/ copy would be ambiguous.
const normalized = new Set();
for (const file of installers) {
  const destName = file.replaceAll("!", "");
  if (normalized.has(destName)) {
    console.error(
      `Duplicate installer artifact after normalization: ${file} -> ${destName}.` +
        ` Delete stale files in ${nsisDir} and rebuild.`,
    );
    process.exit(1);
  }
  normalized.add(destName);
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
