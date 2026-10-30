import { resolveDiffThemeName } from "../lib/diffRendering";
import { useRenderedAppearance } from "./useTheme";
import { useClientSettings } from "./useSettings";

export function useSyntaxTheme(appearanceOverride?: "light" | "dark") {
  const appearance = useRenderedAppearance();
  const syntaxHighlightTheme = useClientSettings((settings) => settings.syntaxHighlightTheme);
  return resolveDiffThemeName(appearanceOverride ?? appearance, syntaxHighlightTheme);
}
