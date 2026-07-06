/**
 * @deprecated Use: pnpm milo --url <url> --stages mirror,eval
 * This wrapper delegates to milo.ts for backward compatibility.
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const miloPath = resolve(dirname(fileURLToPath(import.meta.url)), "../milo.js");
const hasStages = argv.includes("--stages");
const args = hasStages ? argv : [...argv, "--stages", "mirror,eval"];
const result = spawnSync(process.execPath, [miloPath, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
