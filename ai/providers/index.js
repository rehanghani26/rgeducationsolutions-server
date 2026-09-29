import { NvidiaProvider } from "./nvidia.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { GeminiProvider } from "./gemini.provider.js";

// Singleton instances
let _primaryProvider = null;
let _fallbackProvider = null;

export function getProvider() {
  if (!_primaryProvider) {
    _primaryProvider = createProvider(process.env.AI_PROVIDER || "groq");
  }
  return _primaryProvider;
}

export function getFallbackProvider() {
  const primary = process.env.AI_PROVIDER || "groq";
  const fallback = process.env.AI_FALLBACK_PROVIDER || "gemini";

  // No fallback if same as primary or explicitly disabled
  if (!fallback || fallback === "none" || fallback === primary) {
    return null;
  }

  if (!_fallbackProvider) {
    try {
      _fallbackProvider = createProvider(fallback);
    } catch (err) {
      console.warn(
        `[AI] Fallback provider "${fallback}" could not be initialized: ${err.message}`
      );
      return null;
    }
  }

  return _fallbackProvider;
}

function createProvider(name) {
  switch (name.toLowerCase()) {
    case "nvidia":
      return new NvidiaProvider();
    case "groq":
      return new GroqProvider();
    case "gemini":
      return new GeminiProvider();
    default:
      throw new Error(
        `Unknown AI provider: "${name}". Valid options are: "nvidia", "groq", "gemini".`
      );
  }
}

/**
 * Reset cached singletons. Useful when env vars change in tests.
 */
export function resetProviders() {
  _primaryProvider = null;
  _fallbackProvider = null;
}
