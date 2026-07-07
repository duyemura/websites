import { describe, test, expect } from "vitest";
import { parseArgs, type MiloCommand } from "../milo-args";

function parseArgsFrom(argv: string[]): MiloCommand {
  const saved = process.argv;
  process.argv = ["node", "milo.ts", ...argv];
  try { return parseArgs(); }
  finally { process.argv = saved; }
}

describe("milo parseArgs", () => {
  test("join routes correctly", () => {
    const cmd = parseArgsFrom(["join", "--url", "https://example.com"]);
    expect(cmd.cmd).toBe("join");
    expect((cmd as any).url).toBe("https://example.com");
    expect((cmd as any).tier).toBe("free");
  });

  test("join with tier flag", () => {
    const cmd = parseArgsFrom(["join", "--url", "https://example.com", "--tier", "paid"]);
    expect((cmd as any).tier).toBe("paid");
  });

  test("upgrade routes correctly", () => {
    const cmd = parseArgsFrom(["upgrade", "--site", "abc-123"]);
    expect(cmd.cmd).toBe("upgrade");
    expect((cmd as any).site).toBe("abc-123");
  });

  test("rebuild routes correctly", () => {
    const cmd = parseArgsFrom(["rebuild", "--site", "abc-123"]);
    expect(cmd.cmd).toBe("rebuild");
  });

  test("page requires both --site and --path", () => {
    expect(() => parseArgsFrom(["page", "--site", "abc-123"])).toThrow("--path");
    expect(() => parseArgsFrom(["page", "--path", "/about"])).toThrow("--site");
    const cmd = parseArgsFrom(["page", "--site", "abc-123", "--path", "/about"]);
    expect(cmd.cmd).toBe("page");
    expect((cmd as any).path).toBe("/about");
  });

  test("restore requires --version", () => {
    expect(() => parseArgsFrom(["restore", "--site", "abc-123"])).toThrow("--version");
    const cmd = parseArgsFrom(["restore", "--site", "abc-123", "--version", "3"]);
    expect((cmd as any).version).toBe(3);
  });

  test("restore --version rejects non-numeric value", () => {
    expect(() => parseArgsFrom(["restore", "--site", "abc-123", "--version", "abc"])).toThrow("positive integer");
  });

  test("--force and --verbose flags parsed", () => {
    const cmd = parseArgsFrom(["rebuild", "--site", "abc-123", "--force", "--verbose"]);
    expect((cmd as any).force).toBe(true);
    expect((cmd as any).verbose).toBe(true);
  });

  test("legacy --stages still works", () => {
    const cmd = parseArgsFrom(["--url", "https://example.com", "--stages", "enrich,clone"]);
    expect(cmd.cmd).toBe("stages");
    expect((cmd as any).stages).toEqual(["enrich", "clone"]);
  });

  test("unknown command throws", () => {
    expect(() => parseArgsFrom(["foo"])).toThrow("Unknown command");
  });

  test("join missing --url throws", () => {
    expect(() => parseArgsFrom(["join"])).toThrow("--url");
  });
});
