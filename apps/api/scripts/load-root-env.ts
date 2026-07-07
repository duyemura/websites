// apps/api/scripts/load-root-env.ts
// Side-effect module: overlay the workspace root .env on top of the cwd-loaded
// .env so shared secrets (GOOGLE_PLACES_API_KEY, etc.) are available to scripts.
import { configDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

configDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  override: false,
});
