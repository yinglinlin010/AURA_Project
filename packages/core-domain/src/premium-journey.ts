import type { ActionProposalRequest, ContextSignal } from '../../../contracts/protocol/src/types.js';

/** Competition fixtures, not a POI/routing/cloud provider. */
export const PREMIUM_JOURNEY_POINT = {
  scenario: 'premium-journey', pointId: 'fixture-donghu', label: 'Donghu',
  category: 'Scenic Experience', description: 'Scenic lakeside stop', etaImpactMinutes: 12,
} as const;
export interface PremiumJourneyPoint {
  scenario: 'premium-journey'; pointId: string; label: string; category: string;
  description: string; etaImpactMinutes: number; revision: string;
}
export function premiumJourneyPointSignal(signalId: string, timestamp: number): ContextSignal {
  return { signalId, timestamp, type: 'journey.point', source: 'simulated', freshness: 'fresh', value: { ...PREMIUM_JOURNEY_POINT } };
}
export function readPremiumJourneyPoint(signal: ContextSignal | undefined): PremiumJourneyPoint | null {
  if (!signal || signal.type !== 'journey.point' || signal.source !== 'simulated' || signal.freshness !== 'fresh' || !signal.value || typeof signal.value !== 'object') return null;
  const v = signal.value as Record<string, unknown>;
  if (v.scenario !== 'premium-journey' || !['pointId', 'label', 'category', 'description'].every(k => typeof v[k] === 'string' && (v[k] as string).length > 0 && (v[k] as string).length <= 100) || typeof v.etaImpactMinutes !== 'number' || !Number.isFinite(v.etaImpactMinutes) || v.etaImpactMinutes < 0 || v.etaImpactMinutes > 120) return null;
  return { scenario: 'premium-journey', pointId: v.pointId as string, label: v.label as string, category: v.category as string, description: v.description as string, etaImpactMinutes: v.etaImpactMinutes, revision: signal.signalId };
}
export function premiumJourneyProposal(proposalId: string, point: PremiumJourneyPoint | typeof PREMIUM_JOURNEY_POINT): ActionProposalRequest {
  return { proposalId, kind: 'ADD_TRIP_STOP', summary: `${point.label} · +${point.etaImpactMinutes} min`, targetRole: 'center', priority: 'secondary', requiresConsent: true,
    payload: { placeId: point.pointId, label: point.label, competitionScenario: 'premium-journey', source: 'simulated', etaImpactMinutes: point.etaImpactMinutes } };
}
