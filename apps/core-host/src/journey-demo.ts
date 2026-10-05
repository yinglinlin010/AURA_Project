/** Explicit hybrid journey demo: fixture evidence, real model calls, no persistence. */
process.env.AURA_JOURNEY_AI ??= 'hybrid';
process.env.AURA_LOCAL_MODEL ??= 'qwen3:4b';
await import('./competition.js');
