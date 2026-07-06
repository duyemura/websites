/**
 * @deprecated Use: pnpm milo --url <url> --stages extract,segment,docgen
 * This wrapper delegates to milo.ts for backward compatibility.
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
if (argv.includes("--urls")) {
  console.log(
    "Note: --urls is deprecated. Use: pnpm milo --url <single-url> --stages extract,segment,docgen",
  );
}
const __dir = dirname(fileURLToPath(import.meta.url));
const tsxBin = resolve(__dir, "../../node_modules/.bin/tsx");
const miloPath = resolve(__dir, "../milo.ts");
const hasStages = argv.includes("--stages");
const args = hasStages ? argv : [...argv, "--stages", "extract,segment,docgen"];
const result = spawnSync(tsxBin, [miloPath, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
