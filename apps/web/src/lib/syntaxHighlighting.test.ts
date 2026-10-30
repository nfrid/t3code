import { describe, expect, it } from "vite-plus/test";

import { resolveDiffThemeName } from "./diffRendering";
import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

describe("syntax palettes", () => {
  it("switches an existing highlighter to Dracula and back without losing syntax colors", async () => {
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    const code = 'const greeting = "hello";';
    const highlight = (appearance: "light" | "dark", preference: "default" | "dracula") =>
      highlighter.codeToTokens(code, {
        lang: "typescript",
        theme: resolveDiffThemeName(appearance, preference),
      });
    const original = highlight("dark", "default");
    const dracula = highlight("dark", "dracula");
    const stringToken = dracula.tokens.flat().find((token) => token.content.includes("hello"));
    expect(stringToken?.color?.toLowerCase()).toBe("#f1fa8c");
    expect(dracula.tokens).not.toEqual(original.tokens);
    expect(highlight("dark", "default")).toEqual(original);
    expect(highlight("light", "dracula")).toEqual(highlight("light", "default"));
  });
});
