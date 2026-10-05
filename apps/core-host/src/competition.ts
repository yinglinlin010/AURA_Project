import { createCabinCoordinator } from './cabin-coordinator.js';
import { SimulatedJourneyRecommendationEvidenceSource } from '../../../packages/core-runtime/src/journey-recommendation-fixture.js';
import { createJourneyAnalysis } from './journey-ai.js';
/** Disposable recording host. AI providers are explicit opt-in; trip evidence remains simulated. */
import { readFileSync } from 'node:fs';
import type { DisplayRegistry } from '../../../contracts/protocol/src/types.js';
import { CoreRuntime } from '../../../packages/core-runtime/src/core-runtime.js';
import { premiumJourneyPointSignal } from '../../../packages/core-domain/src/premium-journey.js';
import { HmiGateway } from './hmi-gateway.js';
const registry = JSON.parse(readFileSync('apps/core-host/config/display-registry.json', 'utf8')) as DisplayRegistry;
const runtime = new CoreRuntime({ registry, allowDemoReset: true });
const journeyAnalysis = createJourneyAnalysis();
const gateway = new HmiGateway({ runtime, registry, host: '127.0.0.1', port: Number(process.env.AURA_COMPETITION_PORT ?? 8081), path: '/ws', cabin: createCabinCoordinator(runtime, registry), ...(journeyAnalysis ? { journeyAnalysis, journeyRecommendations: new SimulatedJourneyRecommendationEvidenceSource() } : {}) });
await gateway.start();
const seedPoint = (id: string) => runtime.ingestSignal(premiumJourneyPointSignal(`competition:${id}:point`, Date.now()), `competition:${id}`);
seedPoint('initial');
runtime.ingestSignal({signalId:'cabin-default-load',type:'driver.cognitive_load',value:{level:'normal',confidence:1},source:'simulated',timestamp:Date.now(),confidence:1},'cabin-default-load');
runtime.updateConnectivity({mode:'online',source:'derived',evidence:'manual-connectivity-initialization',traceId:'cabin-initial-online'});
// Subscribe after the Gateway so RESET reaches clients before the new fixture signal.
runtime.eventBus.subscribe(event => { if (event.type === 'demo.reset') seedPoint(event.commandId!); });
process.stdout.write(`Competition fixture gateway: ${gateway.address()}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void gateway.close().then(() => process.exit(0)); });
