/**
 * @file index.js
 * @description AI Provider Factory.
 *
 * Reads AI_PROVIDER env var and returns the correct provider singleton.
 * Also handles failover: if primary provider fails, falls back to secondary.
 *
 * Usage:
 *   import { getProvider } from './ai/providers/index.js';
 *   const provider = getProvider(); // returns GroqProvider or GeminiProvider
 *
 * Env vars:
 *   AI_PROVIDER          - 'groq' | 'gemini'  (default: 'groq')
 *   AI_FALLBACK_PROVIDER - 'groq' | 'gemini' | 'none'  (default: 'gemini')
 */

import { NvidiaProvider } from './nvidia.provider.js';
import { GroqProvider } from './groq.provider.js';
import { GeminiProvider } from './gemini.provider.js';

// Singleton instances
let _primaryProvider = null;
let _fallbackProvider = null;

/**
 * Get (or initialize) the primary AI provider instance.
 * @returns {import('./base.provider.js').AIProvider}
 */
export function getProvider() {
  if (!_primaryProvider) {
    _primaryProvider = createProvider(process.env.AI_PROVIDER || 'groq');
  }
  return _primaryProvider;
}

/**
 * Get the fallback provider, if configured and different from primary.
 * @returns {import('./base.provider.js').AIProvider|null}
 */
export function getFallbackProvider() {
  const primary = process.env.AI_PROVIDER || 'groq';
  const fallback = process.env.AI_FALLBACK_PROVIDER || 'gemini';

  // No fallback if same as primary or explicitly disabled
  if (!fallback || fallback === 'none' || fallback === primary) {
    return null;
  }

  if (!_fallbackProvider) {
    try {
      _fallbackProvider = createProvider(fallback);
    } catch (err) {
      console.warn(`[AI] Fallback provider "${fallback}" could not be initialized: ${err.message}`);
      return null;
    }
  }

  return _fallbackProvider;
}

/**
 * Create a fresh provider instance by name.
 * @param {'nvidia'|'groq'|'gemini'} name
 * @returns {import('./base.provider.js').AIProvider}
 */
function createProvider(name) {
  switch (name.toLowerCase()) {
    case 'nvidia':
      return new NvidiaProvider();
    case 'groq':
      return new GroqProvider();
    case 'gemini':
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
