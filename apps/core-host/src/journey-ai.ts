import { ModelJourneyAnalysis } from '../../../adapters/local/journey-analysis.js';

/** Explicit opt-in. Constructors make no provider requests or model downloads. */
export function createJourneyAnalysis(env: NodeJS.ProcessEnv = process.env): ModelJourneyAnalysis | undefined {
  const mode = env.AURA_JOURNEY_AI?.trim();
  if (!mode || mode === 'off') return undefined;
  if (!['local', 'gemini', 'hybrid'].includes(mode)) throw new Error('AURA_JOURNEY_AI_INVALID');
  return new ModelJourneyAnalysis({ mode: mode as 'local' | 'gemini' | 'hybrid',
    ...(env.AURA_LOCAL_MODEL?.trim() ? { localModel: env.AURA_LOCAL_MODEL.trim() } : {}),
    ...(env.GEMINI_JOURNEY_MODEL?.trim() ? { geminiModel: env.GEMINI_JOURNEY_MODEL.trim() } : {}),
    ...(env.GEMINI_API_KEY?.trim() ? { apiKey: env.GEMINI_API_KEY.trim() } : {}),
    ...(env.OLLAMA_HOST?.trim() ? { ollamaHost: env.OLLAMA_HOST.trim() } : {}),
  });
}
