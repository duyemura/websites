import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveHtmlFile } from "../eval-loop";

describe("resolveHtmlFile", () => {
  it("resolves root to dist/index.html", () => {
    expect(resolveHtmlFile("/tmp/dist", "/")).toBe("/tmp/dist/index.html");
  });

  it("resolves directory routes to dist/{path}/index.html", () => {
    expect(resolveHtmlFile("/tmp/dist", "/about")).toBe("/tmp/dist/about/index.html");
  });

  it("resolves file-like routes to dist/{path}.html directly", () => {
    expect(resolveHtmlFile("/tmp/dist", "/pushpress-site-modern/index.html")).toBe(
      "/tmp/dist/pushpress-site-modern/index.html",
    );
  });
});

// ---------------------------------------------------------------------------
// runEvalLoop — mocked integration tests
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd, _opts, cb) => {
    // promisify passes the callback as the last argument
    const callback = typeof _opts === "function" ? _opts : cb;
    if (typeof callback === "function") callback(null, "", "");
  }),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn(),
        goto: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-full-page-png")),
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-element-png")),
        }),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn().mockReturnValue("---\n---\n<div/>"),
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false),
    },
    readFileSync: vi.fn().mockReturnValue("---\n---\n<div/>"),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

vi.mock("../visual-diff", () => ({
  visionDiff: vi.fn(),
}));

// Lazy imports after mocks are hoisted
const getFs = async () => (await import("node:fs")).default;
const getVisionDiff = async () => (await import("../visual-diff")).visionDiff;
const getRunEvalLoop = async () => (await import("../eval-loop")).runEvalLoop;

const fakeTarget = {
  name: "HeroSection",
  filePath: "/fake/renderer/src/components/HeroSection.astro",
  originalCropDesktop: "https://s3.example.com/crop.png",
  pagePath: "/",
};

const fakeRendererDir = "/fake/renderer";

const fakeLoadImageFn = vi.fn().mockResolvedValue(
  "data:image/png;base64,ZmFrZQ==",
);

const fakeChatFn = vi.fn().mockResolvedValue("---\n---\n<div>fixed</div>");

describe("runEvalLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults cleared by clearAllMocks
    fakeLoadImageFn.mockResolvedValue("data:image/png;base64,ZmFrZQ==");
    fakeChatFn.mockResolvedValue("---\n---\n<div>fixed</div>");
  });

  it("diff.failed=true skips agentFix and does not write to disk", async () => {
    const visionDiff = await getVisionDiff();
    const fs = await getFs();
    const runEvalLoop = await getRunEvalLoop();

    vi.mocked(visionDiff).mockResolvedValue({ score: 0, issues: [], failed: true });

    const result = await runEvalLoop(fakeTarget, fakeRendererDir, fakeLoadImageFn, fakeChatFn);

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
  });

  it("diff.failed=true on every iteration exhausts MAX_ITERATIONS and returns passed:false with score 0", async () => {
    const visionDiff = await getVisionDiff();
    const runEvalLoop = await getRunEvalLoop();

    vi.mocked(visionDiff).mockResolvedValue({ score: 0, issues: [], failed: true });

    const result = await runEvalLoop(fakeTarget, fakeRendererDir, fakeLoadImageFn, fakeChatFn);

    expect(result.passed).toBe(false);
    expect(result.finalScore).toBe(0);
    expect(result.iterations).toBe(5); // exhausted MAX_ITERATIONS
  });

  it("attribute not found falls back to full-page screenshot without throwing", async () => {
    const { chromium } = await import("playwright");
    const visionDiff = await getVisionDiff();
    const runEvalLoop = await getRunEvalLoop();

    // Score passes on first iteration so the loop exits after one round
    vi.mocked(visionDiff).mockResolvedValue({ score: 90, issues: [], failed: false });

    const mockPage = {
      setViewportSize: vi.fn(),
      goto: vi.fn(),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("full-page-fallback")),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0), // attribute NOT found
        screenshot: vi.fn(),
      }),
    };

    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    } as never);

    const result = await runEvalLoop(fakeTarget, fakeRendererDir, fakeLoadImageFn, fakeChatFn);

    // full-page screenshot was taken (page.screenshot called with fullPage:true)
    expect(mockPage.screenshot).toHaveBeenCalledWith({ fullPage: true });
    // element screenshot was NOT taken
    expect(mockPage.locator("*").screenshot).not.toHaveBeenCalled();
    expect(result.passed).toBe(true);
  });
});
