import { describe, expect, it } from "vitest";
import { nextPreference, THEME_INIT_SCRIPT, THEME_ORDER } from "./theme";

describe("theme preference cycling", () => {
  it("cycles system to light to dark and back", () => {
    expect(nextPreference("system")).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBe("system");
  });

  it("returns to the start after a full cycle", () => {
    const cycled = THEME_ORDER.reduce((current) => nextPreference(current), "system" as const);
    expect(cycled).toBe("system");
  });
});

describe("theme init script", () => {
  it("resolves a stored preference to an explicit attribute before paint", () => {
    // Executed in isolation with a fake window/localStorage, as the browser
    // would run it during HTML parse.
    function run(stored: string | null, systemPrefersDark: boolean): string {
      const documentStub = { documentElement: { dataset: {} as Record<string, string> } };
      const windowStub = { matchMedia: () => ({ matches: systemPrefersDark }) };
      const localStorageStub = { getItem: () => stored };
      new Function("document", "window", "localStorage", THEME_INIT_SCRIPT)(
        documentStub,
        windowStub,
        localStorageStub,
      );
      return documentStub.documentElement.dataset.theme;
    }

    expect(run("dark", false)).toBe("dark");
    expect(run("light", true)).toBe("light");
    expect(run("system", true)).toBe("dark");
    expect(run("system", false)).toBe("light");
    expect(run(null, true)).toBe("dark");
  });

  it("falls back to light when storage throws", () => {
    const documentStub = { documentElement: { dataset: {} as Record<string, string> } };
    const localStorageStub = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    new Function("document", "window", "localStorage", THEME_INIT_SCRIPT)(
      documentStub,
      { matchMedia: () => ({ matches: true }) },
      localStorageStub,
    );
    expect(documentStub.documentElement.dataset.theme).toBe("light");
  });
});
