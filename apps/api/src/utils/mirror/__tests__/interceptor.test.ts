// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from "vitest";
import { INTERCEPTOR_SCRIPT } from "../interceptor";

function evalInPage(siteUuid: string, extraHtml = ""): void {
  // Set up the script tag the interceptor reads to find siteUuid
  const scriptEl = document.createElement("script");
  scriptEl.src = "/_assets/milo-forms.js";
  scriptEl.dataset.siteUuid = siteUuid;
  document.head.appendChild(scriptEl);
  if (extraHtml) document.body.innerHTML = extraHtml;
  // eval the interceptor
  // eslint-disable-next-line no-new-func
  new Function(INTERCEPTOR_SCRIPT)();
}

describe("milo-forms interceptor", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });

  test("intercepts a lead form and posts JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form id="lead">
        <input name="email" type="email" value="jane@gym.com" />
        <input name="name" type="text" value="Jane" />
        <input name="_hp" type="text" value="" />
        <button type="submit">Submit</button>
      </form>
    `);

    const form = document.getElementById("lead") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 0)); // flush microtasks

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/api\/forms\/site-123\//);
    const body = JSON.parse(opts.body as string) as Record<string, string>;
    expect(body["email"]).toBe("jane@gym.com");
    expect(body["name"]).toBe("Jane");
  });

  test("skips forms with a password field", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form>
        <input name="username" type="text" value="user" />
        <input name="password" type="password" value="secret" />
        <button type="submit">Login</button>
      </form>
    `);

    const form = document.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("skips search forms", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form role="search">
        <input name="q" type="text" value="yoga" />
        <button type="submit">Search</button>
      </form>
    `);

    const form = document.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("includes utm params from sessionStorage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("milo_utm", JSON.stringify({ utm_source: "instagram" }));

    evalInPage("site-123", `
      <form>
        <input name="email" type="email" value="x@x.com" />
        <button type="submit">Go</button>
      </form>
    `);

    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, string>;
    expect(body["utm_source"]).toBe("instagram");
  });

  test("same form always produces same formId", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      document.body.innerHTML = `
        <form>
          <input name="email" type="email" value="a@b.com" />
          <button type="submit">Go</button>
        </form>
      `;
      document.head.innerHTML = "";
      evalInPage("site-xyz");
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      const url = (fetchMock.mock.calls[0] as [string, RequestInit])[0] as string;
      ids.push(url.split("/").pop()!);
    }
    expect(ids[0]).toBe(ids[1]);
  });
});
