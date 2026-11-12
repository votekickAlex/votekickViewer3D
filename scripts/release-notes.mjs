// Extracts the top section of changelog.log (everything before the first
// "detailed history" section) into release-notes.md, used as the GitHub
// Release body.
//
// Usage: node scripts/release-notes.mjs   (writes release-notes.md next to it)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const changelog = readFileSync(path.join(import.meta.dirname, "..", "changelog.log"), "utf8");

// Keep everything from the first version heading on, up to the
// "detailed history" section.
const bodyStart = changelog.search(/^0\.\d.*$/m);
const cut = changelog.search(/^.*detailed history.*$/m);
const notes = (cut >= 0 ? changelog.slice(bodyStart, cut) : changelog.slice(bodyStart)).trim();

writeFileSync(path.join(import.meta.dirname, "..", "release-notes.md"), notes + "\n");
console.log("release-notes.md written");
