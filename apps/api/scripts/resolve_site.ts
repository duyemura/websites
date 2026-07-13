import "dotenv/config";
import "./load-root-env.js";
import { db } from "../src/database";

async function main() {
  const themes = await db
    .selectFrom("themes")
    .select(["uuid", "templateKey", "name"])
    .execute();
  console.log(JSON.stringify(themes, null, 2));
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
