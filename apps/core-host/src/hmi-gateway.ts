import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { default as Ajv, type AnySchemaObject, type ValidateFunction } from "ajv";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  assertDisplayRegistry,
  findRegisteredSender,
} from "../../../contracts/protocol/src/registry.js";
import { PROTOCOL_VERSION } from "../../../contracts/protocol/src/types.js";
import type {
  ClientMessage,
  DisplayRegistration,
  DisplayRegistry,
  JourneyRecommendationMessage,
  JourneyRecommendationResultMessage,
  JourneyRoutePreviewMessage,
  PlacesSearchMessage,
  ServerMessage,
} from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";
import type { VoiceRuntime } from "../../../packages/core-runtime/src/voice-runtime.js";
import type { MapboxDirectionsAdapter } from "../../../adapters/maps/mapbox-directions-adapter.js";
import type { MapboxSearchBoxAdapter } from "../../../adapters/maps/mapbox-search-box-adapter.js";
import { recommendWholeJourney, type JourneyRecommendationEvidenceSource } from "../../../packages/core-runtime/src/journey-recommender.js";
import { GatewayVoiceOutput } from "./gateway-voice-output.js";

interface ClientSession {
  socket: WebSocket;
  registration?: DisplayRegistration;
  voiceTraceId?: string;
}

export interface HmiGatewayOptions {
  runtime: CoreRuntime;
  registry: DisplayRegistry;
  host?: string;
  port?: number;
  path?: string;
  protocolSchemaPath?: string;
  voice?: VoiceRuntime;
  voiceOutput?: GatewayVoiceOutput;
  places?: MapboxSearchBoxAdapter;
  routing?: MapboxDirectionsAdapter;
  journeyRecommendations?: JourneyRecommendationEvidenceSource;
}

export class HmiGateway {
  private readonly runtime: CoreRuntime;
  private readonly registry: DisplayRegistry;
  private readonly host: string;
  private readonly port: number;
  private readonly path: string;
  private readonly validator: ValidateFunction;
  private readonly outboundValidator: ValidateFunction;
  private readonly clients = new Set<ClientSession>();
  private readonly voice: VoiceRuntime | undefined;
  private readonly voiceOutput: GatewayVoiceOutput | undefined;
  private readonly places: MapboxSearchBoxAdapter | undefined;
  private readonly routing: MapboxDirectionsAdapter | undefined;
  private readonly journeyRecommendations: JourneyRecommendationEvidenceSource | undefined;
  private voiceOwner: ClientSession | undefined;
  private readonly server: WebSocketServer;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeVoice: (() => void) | undefined;

  constructor(options: HmiGatewayOptions) {
    assertDisplayRegistry(options.registry);
    this.runtime = options.runtime;
    this.voice = options.voice;
    this.voiceOutput = options.voiceOutput;
    this.places = options.places;
    this.routing = options.routing;
    this.journeyRecommendations = options.journeyRecommendations;
    this.registry = structuredClone(options.registry);
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8765;
    this.path = normalizeWebSocketPath(options.path ?? "/ws");

    const schemaPath = options.protocolSchemaPath ??
      resolve(process.cwd(), "contracts/protocol/schemas/protocol.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as AnySchemaObject;
    const ajv = new Ajv.default({ allErrors: true, strict: false });
    ajv.addSchema(schema);
    const schemaId = typeof schema.$id === "string" ? schema.$id : "";
    const clientValidator = ajv.getSchema(`${schemaId}#/definitions/clientMessage`);
    const serverValidator = ajv.getSchema(`${schemaId}#/definitions/serverMessage`);
    if (!clientValidator) throw new Error("CLIENT_MESSAGE_SCHEMA_NOT_FOUND");
    if (!serverValidator) throw new Error("SERVER_MESSAGE_SCHEMA_NOT_FOUND");
    this.validator = clientValidator;
    this.outboundValidator = serverValidator;

    this.server = new WebSocketServer({
      host: this.host,
      port: this.port,
      path: this.path,
      maxPayload: 256 * 1024,
      perMessageDeflate: false,
    });
    this.server.on("connection", (socket) => this.accept(socket));
    this.unsubscribe = this.runtime.eventBus.subscribe((event) => {
      const message: ServerMessage = { kind: "event", event };
      for (const client of this.clients) {
        if (client.registration) this.send(client.socket, message);
      }
    });
    this.unsubscribeVoice = this.voice?.subscribe((event) => {
      const owner = this.voiceOwner;
      if (!owner?.registration) return;
      if (event.type === "state") {
        this.send(owner.socket, { kind: "voice.status", protocolVersion: PROTOCOL_VERSION, traceId: event.traceId, state: event.state });
      } else {
        this.send(owner.socket, { kind: "voice.transcript", protocolVersion: PROTOCOL_VERSION, traceId: event.traceId, direction: event.direction, text: event.text.slice(0, 4000), isFinal: event.isFinal });
      }
    });
  }

  start(): Promise<void> {
    return new Promise((resolveStart, rejectStart) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        rejectStart(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolveStart();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
    });
  }

  address(): string | null {
    const address = this.server.address();
    if (!address) return null;
    if (typeof address === "string") return address;
    return `ws://${address.address}:${address.port}${this.path}`;
  }

  close(): Promise<void> {
    this.unsubscribe();
    this.unsubscribeVoice?.();
    this.voice?.close();
    for (const client of this.clients) client.socket.close(1001, "server shutdown");
    return new Promise((resolveClose, rejectClose) => {
      this.server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }

  private accept(socket: WebSocket): void {
    const client: ClientSession = { socket };
    this.clients.add(client);
    socket.on("message", (raw, isBinary) => this.handleMessage(client, raw, isBinary));
    socket.on("close", () => this.handleClose(client));
    socket.on("error", () => socket.terminate());
  }

  private handleMessage(client: ClientSession, raw: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.handleAudioFrame(client, raw);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      this.sendError(client.socket, "INVALID_JSON", "Message must be valid JSON.");
      return;
    }

    if (!this.validator(value)) {
      this.sendError(client.socket, "INVALID_MESSAGE", "Message does not match protocol v1.");
      return;
    }
    const message = value as ClientMessage;
    switch (message.kind) {
      case "register":
        this.register(client, message);
        break;
      case "command":
        this.command(client, message);
        break;
      case "resync":
        this.resync(client, message);
        break;
      case "ping":
        this.send(client.socket, {
          kind: "pong",
          protocolVersion: PROTOCOL_VERSION,
          pingId: message.pingId,
          serverTime: Date.now(),
        });
        break;
      case "places.search":
        void this.searchPlaces(client, message);
        break;
      case "journey.route.preview":
        void this.previewJourneyRoute(client, message);
        break;
      case "journey.recommendation.request":
        void this.recommendJourney(client, message);
        break;
      case "voice.start":
        void this.startVoice(client, message.traceId);
        break;
      case "voice.stop":
        void this.stopVoice(client, message.traceId);
        break;
      case "voice.text":
        void this.sendVoiceText(client, message.text, message.traceId);
        break;
    }
  }

  /** Request-scoped response only: result content stays out of shared state/storage; adapter observability is metadata-only. */
  private async searchPlaces(client: ClientSession, message: PlacesSearchMessage): Promise<void> {
    const registration = client.registration;
    if (!registration) return this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before searching places.", message.traceId);
    if (registration.role !== "front_passenger") return this.sendError(client.socket, "DISCOVERY_ROLE_NOT_ALLOWED", "Place discovery is available from the passenger display.", message.traceId);
    const observedAt = Date.now();
    if (!this.places) {
      this.send(client.socket, {
        kind: "places.search.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId, slot: message.slot,
        status: "unavailable", provider: "mapbox-search-box", source: "unknown",
        observedAt, freshness: "unknown", results: [], errorCode: "MAPBOX_PROVIDER_UNAVAILABLE",
      });
      return;
    }
    try {
      const results = await this.places.search({ query: message.query, maxResults: 5, traceId: message.traceId });
      this.send(client.socket, {
        kind: "places.search.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId, slot: message.slot,
        status: "available", provider: "mapbox-search-box", source: "api",
        observedAt: results[0]?.observedAt ?? Date.now(), freshness: results.length > 0 ? "fresh" : "unknown",
        results: results.slice(0, 5).map((place) => ({
          provider: place.provider, placeId: place.placeId, displayName: place.displayName,
          ...(place.formattedAddress === undefined ? {} : { formattedAddress: place.formattedAddress }),
          ...(place.location === undefined ? {} : { location: place.location }),
          types: place.types, attribution: place.attribution, source: place.source,
          observedAt: place.observedAt, freshness: place.freshness, use: "temporary" as const,
        })),
      });
    } catch (error) {
      this.send(client.socket, {
        kind: "places.search.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId, slot: message.slot,
        status: "error", provider: "mapbox-search-box", source: "unknown",
        observedAt: Date.now(), freshness: "unknown", results: [],
        errorCode: safeProviderError(error, "MAPBOX_SEARCH_FAILED"),
      });
    }
  }

  /** Route preview is returned directly to the requesting passenger and never persisted as a journey. */
  private async previewJourneyRoute(client: ClientSession, message: JourneyRoutePreviewMessage): Promise<void> {
    const registration = client.registration;
    if (!registration) return this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before requesting route impact.", message.traceId);
    if (registration.role !== "front_passenger") return this.sendError(client.socket, "DISCOVERY_ROLE_NOT_ALLOWED", "Route discovery is available from the passenger display.", message.traceId);
    if (!this.routing) {
      this.send(client.socket, {
        kind: "journey.route.preview.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId, status: "unavailable",
        provider: "mapbox-directions-v5", source: "unknown", observedAt: Date.now(),
        freshness: "unknown", attribution: "", attributionUrl: "", routes: [],
        errorCode: "MAPBOX_PROVIDER_UNAVAILABLE",
      });
      return;
    }
    try {
      const routes = await this.routing.computeRoute({ origin: message.origin, destination: message.destination, traceId: message.traceId });
      this.send(client.socket, {
        kind: "journey.route.preview.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId,
        status: routes.length > 0 ? "available" : "error", provider: "mapbox-directions-v5", source: "api",
        observedAt: routes[0]?.observedAt ?? Date.now(), freshness: routes.length > 0 ? "fresh" : "unknown",
        attribution: routes[0]?.attribution ?? "© Mapbox", attributionUrl: routes[0]?.attributionUrl ?? "https://www.mapbox.com/about/maps/",
        routes: routes.slice(0, 3).map((route) => ({
          distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, observedAt: route.observedAt,
        })),
        ...(routes.length > 0 ? {} : { errorCode: "MAPBOX_ROUTE_UNAVAILABLE" }),
      });
    } catch (error) {
      this.send(client.socket, {
        kind: "journey.route.preview.results", protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId, traceId: message.traceId, status: "error",
        provider: "mapbox-directions-v5", source: "unknown", observedAt: Date.now(),
        freshness: "unknown", attribution: "", attributionUrl: "", routes: [],
        errorCode: safeProviderError(error, "MAPBOX_DIRECTIONS_FAILED"),
      });
    }
  }

  /** A recommendation request is Center-only and remains ephemeral until Center submits its consent proposal. */
  private async recommendJourney(client: ClientSession, message: JourneyRecommendationMessage): Promise<void> {
    if (!client.registration) {
      this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before requesting a journey recommendation.", message.traceId);
      return;
    }
    if (client.registration.role !== "center") {
      this.sendError(client.socket, "JOURNEY_RECOMMENDATION_ROLE_NOT_ALLOWED", "Whole-journey recommendations are delivered only to the Center display.", message.traceId);
      return;
    }

    let result: JourneyRecommendationResultMessage;
    try {
      result = await recommendWholeJourney({
        message,
        state: this.runtime.getState(),
        ...(this.journeyRecommendations === undefined ? {} : { source: this.journeyRecommendations }),
      });
    } catch {
      result = {
        kind: "journey.recommendation.result" as const,
        protocolVersion: PROTOCOL_VERSION,
        requestId: message.requestId,
        traceId: message.traceId,
        status: "abstained" as const,
        reasonCode: "WHOLE_JOURNEY_RECOMMENDATION_UNAVAILABLE",
      };
    }
    this.send(client.socket, result);
  }

  private async startVoice(client: ClientSession, traceId: string): Promise<void> {
    if (!client.registration) return this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before starting voice.", traceId);
    if (!this.voice || !this.voiceOutput) return this.sendError(client.socket, "VOICE_UNAVAILABLE", "Voice streaming is not configured on this host.", traceId);
    if (this.voiceOwner && this.voiceOwner !== client) return this.sendError(client.socket, "VOICE_SESSION_BUSY", "Another display owns the active voice stream.", traceId);
    this.voiceOwner = client;
    client.voiceTraceId = traceId;
    this.voiceOutput.bind(client.socket, traceId);
    try {
      await this.voice.start(traceId);
    } catch (error) {
      this.voiceOutput.bind(undefined);
      this.voiceOwner = undefined;
      this.sendError(client.socket, error instanceof Error ? error.message : "VOICE_CONNECT_FAILED", "Voice connection could not be opened.", traceId);
    }
  }

  private async stopVoice(client: ClientSession, traceId: string): Promise<void> {
    if (!client.registration) return this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before stopping voice.", traceId);
    if (this.voiceOwner !== client || !this.voice) return this.sendError(client.socket, "VOICE_SESSION_NOT_OWNED", "This display does not own the active voice stream.", traceId);
    await this.voice.stop(traceId);
    this.voiceOwner = undefined;
    this.voiceOutput?.bind(undefined);
  }

  private async sendVoiceText(client: ClientSession, text: string, traceId: string): Promise<void> {
    if (!client.registration) return this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before sending voice text.", traceId);
    if (!this.voice || !this.voiceOutput) return this.sendError(client.socket, "VOICE_UNAVAILABLE", "Voice streaming is not configured on this host.", traceId);
    if (this.voiceOwner && this.voiceOwner !== client) return this.sendError(client.socket, "VOICE_SESSION_BUSY", "Another display owns the active voice stream.", traceId);
    this.voiceOwner = client;
    client.voiceTraceId = traceId;
    this.voiceOutput.bind(client.socket, traceId);
    try { await this.voice.sendText(text, traceId); }
    catch (error) { this.sendError(client.socket, error instanceof Error ? error.message : "VOICE_TEXT_FAILED", "Voice text could not be submitted.", traceId); }
  }

  private handleAudioFrame(client: ClientSession, raw: RawData): void {
    if (!client.registration || this.voiceOwner !== client || !this.voice) {
      this.sendError(client.socket, "VOICE_SESSION_NOT_OWNED", "Start a registered voice session before sending PCM frames.");
      return;
    }
    const data = rawToBuffer(raw);
    if (data.length < 2 || data.length > 64 * 1024 || data.length % 2 !== 0) {
      this.sendError(client.socket, "INVALID_PCM_FRAME", "PCM frames must contain 1 to 32768 signed 16-bit mono samples.");
      return;
    }
    void this.voice.sendAudioChunk(data, "audio/pcm;rate=16000", client.voiceTraceId ?? "voice-stream")
      .catch((error: unknown) => this.sendError(client.socket, error instanceof Error ? error.message : "VOICE_AUDIO_FAILED", "PCM frame could not be submitted."));
  }

  private register(
    client: ClientSession,
    message: Extract<ClientMessage, { kind: "register" }>,
  ): void {
    if (client.registration) {
      this.sendError(client.socket, "ALREADY_REGISTERED", "Connection already has a display registration.", message.traceId);
      return;
    }
    const registration = findRegisteredSender(this.registry, message.displayId, message.deviceId);
    if (!registration || registration.protocolVersion !== message.protocolVersion) {
      this.sendError(client.socket, "DISPLAY_REGISTRATION_REJECTED", "Display is not enabled in the registry.", message.traceId);
      return;
    }

    this.runtime.setDisplayConnection(message.displayId, true, message.traceId);
    client.registration = registration;
    this.send(client.socket, {
      kind: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.runtime.sessionId,
      sequence: this.runtime.eventBus.sequence,
      displayId: registration.displayId,
      role: registration.role,
    });
    this.send(client.socket, {
      kind: "snapshot",
      snapshot: this.runtime.createSnapshot(registration.displayId),
    });
  }

  private command(
    client: ClientSession,
    message: Extract<ClientMessage, { kind: "command" }>,
  ): void {
    const registration = client.registration;
    if (!registration) {
      this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before sending commands.", message.envelope.traceId);
      return;
    }
    const envelope = message.envelope;
    const sender = findRegisteredSender(
      this.registry,
      envelope.sender.displayId,
      envelope.sender.deviceId,
    );
    if (
      envelope.sessionId !== this.runtime.sessionId ||
      envelope.sender.displayId !== registration.displayId ||
      envelope.sender.deviceId !== registration.deviceId ||
      !sender
    ) {
      this.sendError(client.socket, "COMMAND_SENDER_MISMATCH", "Command sender does not match this connection.", envelope.traceId);
      return;
    }

    const receipt = this.runtime.submitCommand(envelope);
    this.send(client.socket, {
      kind: "ack",
      protocolVersion: PROTOCOL_VERSION,
      receipt,
    });
  }

  private resync(
    client: ClientSession,
    message: Extract<ClientMessage, { kind: "resync" }>,
  ): void {
    if (!client.registration) {
      this.sendError(client.socket, "REGISTRATION_REQUIRED", "Register a display before requesting a snapshot.", message.traceId);
      return;
    }
    if (message.sessionId !== this.runtime.sessionId) {
      this.sendError(client.socket, "SESSION_MISMATCH", "Reconnect to the current runtime session.", message.traceId);
      return;
    }
    this.send(client.socket, {
      kind: "snapshot",
      snapshot: this.runtime.createSnapshot(client.registration.displayId),
    });
  }

  private handleClose(client: ClientSession): void {
    this.clients.delete(client);
    if (this.voiceOwner === client) {
      this.voiceOwner = undefined;
      this.voiceOutput?.bind(undefined);
      void this.voice?.stop(`voice-disconnect:${randomUUID()}`, "VOICE_CLIENT_DISCONNECTED");
    }
    const displayId = client.registration?.displayId;
    if (!displayId) return;
    const anotherConnection = [...this.clients].some(
      (candidate) => candidate.registration?.displayId === displayId,
    );
    const traceId = `gateway-disconnect:${randomUUID()}`;
    this.runtime.setDisplayConnection(displayId, anotherConnection, traceId);
  }

  private sendError(
    socket: WebSocket,
    code: string,
    message: string,
    traceId?: string,
  ): void {
    this.send(socket, {
      kind: "error",
      protocolVersion: PROTOCOL_VERSION,
      code,
      message,
      ...(traceId === undefined ? {} : { traceId }),
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!this.outboundValidator(message)) {
      socket.close(1011, "Server protocol validation failed");
      return;
    }
    socket.send(JSON.stringify(message), (error) => {
      if (error) socket.terminate();
    });
  }
}

function normalizeWebSocketPath(path: string): string {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("INVALID_WEBSOCKET_PATH");
  }
  return path;
}

function rawToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

function safeProviderError(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : "";
  return /^[A-Z0-9_:-]{1,96}$/.test(code) ? code : fallback;
}
