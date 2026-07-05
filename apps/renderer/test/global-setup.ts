import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

export default function setup() {
  const target = "src/content/gym.json";

  // Snapshot current state so we can restore after tests (dev workflow safety)
  const prior = existsSync(target) ? readFileSync(target) : null;

  try {
    copyFileSync("src/content/gym.fixture.json", target);
  } catch (err) {
    throw new Error(`Fixture copy failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    execSync("pnpm build", { stdio: "inherit" });
  } catch (err) {
    throw new Error(`Astro build failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Teardown: restore gym.json to its pre-test state
  return () => {
    if (prior) writeFileSync(target, prior);
    else if (existsSync(target)) unlinkSync(target);
  };
}
