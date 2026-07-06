import { createServer, type Server } from "http";
import { readFile } from "fs/promises";
import path from "path";

export async function serveFixture(
  fixtureName: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const html = await readFile(
    path.join(__dirname, `${fixtureName}.html`),
    "utf-8",
  );
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}
