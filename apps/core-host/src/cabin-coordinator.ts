import {
  along,
  distance,
  project,
  updateNavigation,
} from "./cabin-navigation.js";
import {
  normalizeChinese,
  traditional,
  resolveSpokenName,
} from "../../../adapters/local/cabin-place-ranking.js";
import { randomUUID } from "node:crypto";
import type {
  CabinBallot,
  CabinCommand,
  CabinPerson,
  CabinPlace,
  CabinRole,
  CabinSnapshot,
  CabinResultMessage,
  VotePolicy,
} from "../../../contracts/protocol/src/cabin.js";
import type {
  DisplayRegistry,
  DisplayRegistration,
  ClientMessage,
} from "../../../contracts/protocol/src/types.js";
import type { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import type { CabinMaps } from "../../../adapters/maps/cabin-maps.js";
import {
  MapboxCabinMaps,
  GoogleCabinMaps,
  OsmCabinMaps,
} from "../../../adapters/maps/cabin-maps.js";
import {
  CabinModelIntelligence,
  type CabinIntelligence,
} from "../../../adapters/voice/cabin-intelligence.js";
import {
  searchSimilarImageCandidates,
  type SimilarImage,
} from "../../../adapters/maps/similar-images.js";
export interface CabinCoordinatorOptions {
  initialTrip?: import("../../../contracts/protocol/src/cabin.js").CabinTrip;
  initialCount?: number;
  initialPlaces?: CabinPlace[];
  initialQueries?: Record<string, string[]>;
  savePlaces?: (
    places: CabinPlace[],
    queries: Record<string, string[]>,
  ) => void;
  checkpoint?: (state: CabinSnapshot) => void;
  runtime: CoreRuntime;
  registry: DisplayRegistry;
  maps?: CabinMaps;
  intelligence: CabinIntelligence;
  publicMapToken?: string;
  imageSearch?: (query: string) => Promise<SimilarImage[]>;
  now?: () => number;
  voteTimeoutMs?: number;
}
export class CabinCoordinator {
  private state: CabinSnapshot;
  private places = new Map<string, CabinPlace>();
  private queries = new Map<string, string[]>();
  private notificationTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tripBusy = false;
  private navigationTimer: ReturnType<typeof setInterval> | undefined;
  private checkpointKey = "";
  private readonly now: () => number;
  constructor(private readonly options: CabinCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.places = new Map((options.initialPlaces ?? []).map((p) => [p.id, p]));
    this.queries = new Map(
      Object.entries(options.initialQueries ?? {}).map(([query, ids]) => [
        normalizeChinese(query),
        ids,
      ]),
    );
    this.state = {
      revision: 0,
      people: people(options.initialCount ?? 3),
      policy: "majority_driver",
      trip: options.initialTrip
        ? structuredClone(options.initialTrip)
        : {
            version: 0,
            origin: null,
            destination: null,
            stops: [],
            route: null,
          },
      photos: [],
      captions: [],
      ballot: null,
      capabilities: {
        maps: options.maps?.provider ?? null,
        cloud: options.intelligence.cloudAvailable,
        localSpeech: options.intelligence.localSpeechAvailable,
        ...(options.publicMapToken?.startsWith("pk.")
          ? { publicMapToken: options.publicMapToken }
          : {}),
      },
    };
    this.state.capabilities.cachedPlaceCount = this.places.size;
    const tripPlaces = [
      this.state.trip.origin,
      ...this.state.trip.stops,
      this.state.trip.destination,
    ].filter((p): p is CabinPlace => !!p);
    if (tripPlaces.length) this.remember(tripPlaces);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(role: CabinRole): CabinSnapshot {
    const state = structuredClone(this.state);
    if (
      state.ballot &&
      ["passed", "failed", "cancelled", "expired"].includes(
        state.ballot.status,
      ) &&
      state.ballot.notificationUntil !== undefined &&
      this.now() >= state.ballot.notificationUntil
    )
      state.ballot = null;
    if (
      role !== "front_passenger" &&
      role !== "rear" &&
      role !== "interactive_window"
    )
      state.photos = [];
    const front =
      role === "center" || role === "cluster" || role === "front_passenger";
    state.captions = state.captions.filter((c) =>
      front ? c.seat === "rear" : c.seat !== "rear",
    );
    return state;
  }
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.navigationTimer) clearInterval(this.navigationTimer);
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.listeners.clear();
    this.state.photos = [];
  }
  private changed(): void {
    this.state.revision++;
    const ballot = this.state.ballot;
    if (
      ballot &&
      ["passed", "failed", "cancelled", "expired"].includes(ballot.status) &&
      ballot.notificationUntil === undefined
    ) {
      ballot.notificationUntil = this.now() + 5000;
      if (this.notificationTimer) clearTimeout(this.notificationTimer);
      this.notificationTimer = setTimeout(() => {
        if (this.state.ballot?.id === ballot.id) this.changed();
      }, 5000);
    }
    if (
      this.state.navigation?.status === "active" &&
      this.state.navigation.tripVersion !== this.state.trip.version
    ) {
      this.state.navigation.status = "stopped";
      this.state.navigation.instruction = "路線已更新，請重新開始導航";
      if (this.navigationTimer) clearInterval(this.navigationTimer);
    }
    const checkpointKey = `${this.state.trip.version}:${this.state.people.length}`;
    if (
      this.options.checkpoint &&
      (this.checkpointKey !== checkpointKey ||
        this.state.capabilities.tripSaved === false)
    ) {
      try {
        this.options.checkpoint(this.state);
        this.state.capabilities.tripSaved = true;
        this.checkpointKey = checkpointKey;
      } catch {
        this.state.capabilities.tripSaved = false;
      }
    }
    this.listeners.forEach((listener) => listener());
  }
  private actor(
    personId: string,
    registration: DisplayRegistration,
  ): CabinPerson {
    const p = this.state.people.find((p) => p.id === personId);
    if (!p) throw new Error("PERSON_NOT_PRESENT");
    const seat =
      registration.role === "center"
        ? "driver"
        : registration.role === "front_passenger"
          ? "front"
          : ["rear", "interactive_window"].includes(registration.role)
            ? "rear"
            : null;
    if (p.seat !== seat) throw new Error("PERSON_ROLE_MISMATCH");
    return p;
  }
  private driver(registration: DisplayRegistration): void {
    if (registration.role !== "center") throw new Error("DRIVER_ONLY");
  }
  private online(): boolean {
    return this.options.runtime.getState().connectivity.mode === "online";
  }
  private context(): string {
    return this.state.trip.origin && this.state.trip.destination
      ? `${this.state.trip.origin.name} → ${this.state.trip.stops.map((p) => p.name).join(" → ")} → ${this.state.trip.destination.name}`
      : "尚未設定行程；不要臆測目前位置";
  }
  private remember(places: CabinPlace[], query?: string): void {
    for (const place of places) {
      this.places.delete(place.id);
      this.places.set(place.id, place);
    }
    while (this.places.size > 500)
      this.places.delete(this.places.keys().next().value!);
    if (query) {
      const key = this.queryKey(query);
      this.queries.delete(key);
      this.queries.set(
        key,
        places.map((p) => p.id),
      );
    }
    while (this.queries.size > 200)
      this.queries.delete(this.queries.keys().next().value!);
    try {
      this.options.savePlaces?.(
        [...this.places.values()],
        Object.fromEntries(this.queries),
      );
      this.state.capabilities.placeCacheSaved = !!this.options.savePlaces;
    } catch {
      this.state.capabilities.placeCacheSaved = false;
    }
    this.state.capabilities.cachedPlaceCount = this.places.size;
    this.changed();
  }
  private queryKey(query: string): string {
    return normalizeChinese(query);
  }
  private cached(query: string): CabinPlace[] {
    const key = this.queryKey(query);
    if (!key)
      return [...this.places.values()]
        .reverse()
        .slice(0, 5)
        .map((p) => ({ ...p, fromCache: true }));
    const exact = (this.queries.get(key) ?? [])
      .map((id) => this.places.get(id))
      .filter((p): p is CabinPlace => !!p);
    if (exact.length)
      return exact.slice(0, 5).map((p) => ({ ...p, fromCache: true }));
    const spokenName = resolveSpokenName(
      query,
      [...this.places.values()].map((p) => p.name),
    );
    const searchKey = spokenName ? this.queryKey(spokenName) : key;
    return [...this.places.values()]
      .reverse()
      .filter(
        (p) =>
          this.queryKey(p.name).includes(searchKey) ||
          this.queryKey(p.address).includes(searchKey),
      )
      .slice(0, 5)
      .map((p) => ({ ...p, fromCache: true }));
  }
  private async search(query: string): Promise<CabinPlace[]> {
    if (!this.options.maps) throw new Error("MAP_SERVICE_REQUIRED");
    if (!this.online()) {
      const hits = this.cached(query);
      if (!hits.length) throw new Error("OFFLINE_PLACE_UNAVAILABLE");
      return hits;
    }
    try {
      const result = await this.options.maps.search(
        query,
        this.state.trip.origin ?? undefined,
      );
      this.remember(result, query);
      return result;
    } catch (error) {
      const hits = this.cached(query);
      if (hits.length) return hits;
      throw error;
    }
  }
  private async recommend(
    query: string,
  ): Promise<{ places: CabinPlace[]; text: string; provider: string }> {
    if (!this.online()) {
      const candidates = [...this.places.values()].map((p) => ({
        ...p,
        fromCache: true,
      }));
      if (!candidates.length)
        return {
          places: [],
          text: "目前沒有已儲存景點，請先連網查詢；離線不能查證新地點。",
          provider: "本機快取",
        };
      if (!this.options.intelligence.rankPlaces)
        return {
          places: candidates.slice(-5),
          text: "已儲存候選景點，尚未啟用本機推薦模型。",
          provider: "本機快取",
        };
      const ranked = await this.options.intelligence.rankPlaces(
        query,
        this.context(),
        candidates,
        false,
        this.state.trip,
      );
      return {
        places: ranked.ids
          .map((id) => candidates.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => !!p),
        text: ranked.reason,
        provider: ranked.provider + " · 本機已儲存資料",
      };
    }
    if (
      this.options.maps?.nearby &&
      this.state.trip.origin &&
      this.options.intelligence.rankPlaces
    ) {
      let candidates: CabinPlace[];
      try {
        candidates = this.online()
          ? await this.options.maps.nearby(this.state.trip.origin)
          : [...this.places.values()];
      } catch {
        const alternative = await this.options.intelligence.recommend(
          query,
          this.context(),
          this.online(),
        );
        return {
          places: await this.search(alternative.query),
          text: `附近景點服務暫忙，改用明確地名查詢。${alternative.reason}`,
          provider: `${alternative.provider}＋OpenStreetMap`,
        };
      }
      if (!candidates.length) throw new Error("NO_NEARBY_PLACES");
      this.remember(candidates);
      const ranked = await this.options.intelligence.rankPlaces(
        query,
        this.context(),
        candidates,
        this.online(),
        this.state.trip,
      );
      return {
        places: ranked.ids
          .map((id) => candidates.find((p) => p.id === id)!)
          .filter(Boolean),
        text: ranked.reason,
        provider: `${ranked.provider}＋OpenStreetMap`,
      };
    }
    const result = await this.options.intelligence.recommend(
      query,
      this.context(),
      this.online(),
    );
    return {
      places: await this.search(result.query),
      text: result.reason,
      provider: result.provider,
    };
  }
  async command(
    command: CabinCommand,
    registration: DisplayRegistration,
  ): Promise<
    Omit<CabinResultMessage, "kind" | "protocolVersion" | "requestId">
  > {
    if (registration.role === "cluster" && command.type !== "vote.cast") throw new Error("DISPLAY_READ_ONLY");
    switch (command.type) {
      case "place.cached":
        return {
          status: "ok",
          places: this.cached(command.query ?? ""),
          provider: "本機已儲存景點",
          source: "cache",
          text: `已儲存 ${this.places.size} 個景點，顯示最多5筆；資料非即時，可輸入名稱查詢。`,
        };
      case "navigation.start": {
        this.driver(registration);
        if (this.tripBusy) throw new Error("TRIP_BUSY");
        if (command.version !== this.state.trip.version)
          throw new Error("TRIP_CHANGED");
        if (this.state.navigation?.status === "active")
          throw new Error("NAVIGATION_ACTIVE");
        let route = this.state.trip.route;
        if (!route || route.coordinates.length < 2 || route.distanceMeters <= 0)
          throw new Error("TRIP_NOT_CONFIGURED");
        if (
          !route.steps?.length &&
          this.online() &&
          this.options.maps &&
          this.state.trip.origin &&
          this.state.trip.destination
        ) {
          this.tripBusy = true;
          try {
            route = await this.options.maps.route(
              this.state.trip.origin,
              this.state.trip.destination,
              this.state.trip.stops,
            );
            if (
              route.order.some((id, i) => id !== this.state.trip.stops[i]?.id)
            )
              throw new Error("ROUTE_ORDER_INVALID");
            this.state.trip.route = route;
          } finally {
            this.tripBusy = false;
          }
        }
        const now = this.now();
        this.state.navigation = {
          status: "active",
          mode: command.mode,
          tripVersion: command.version,
          startedAt: now,
          updatedAt: command.mode === "gps" ? 0 : now,
          position: command.mode === "demo" ? route.coordinates[0]! : null,
          traveledMeters: 0,
          remainingMeters: route.distanceMeters,
          remainingSeconds: route.durationSeconds,
          instruction:
            command.mode === "demo" ? "沿規劃路線前進" : "等待 GPS 定位",
          nextManeuverMeters: 0,
          speedKph: 0,
        };
        if (this.navigationTimer) clearInterval(this.navigationTimer);
        if (command.mode === "demo")
          this.navigationTimer = setInterval(() => {
            const nav = this.state.navigation,
              route = this.state.trip.route;
            if (!nav || nav.status !== "active" || !route) {
              if (this.navigationTimer) clearInterval(this.navigationTimer);
              return;
            }
            const meters =
              (route.distanceMeters *
                ((this.now() - nav.startedAt) / 1000) *
                20) /
              Math.max(1, route.durationSeconds);
            this.state.navigation = updateNavigation(
              nav,
              route,
              meters,
              along(route, meters),
              this.now(),
            );
            this.state.navigation.speedKph =
              this.state.navigation.status === "arrived"
                ? 0
                : (route.distanceMeters / Math.max(1, route.durationSeconds)) *
                  3.6;
            this.changed();
          }, 1000);
        this.changed();
        return {
          status: "ok",
          text:
            command.mode === "demo"
              ? "Demo 導航已開始（20倍速）"
              : "導航已開始，使用 GPS 定位",
        };
      }
      case "navigation.stop":
        this.driver(registration);
        if (this.navigationTimer) clearInterval(this.navigationTimer);
        if (this.state.navigation) {
          this.state.navigation.status = "stopped";
          this.state.navigation.instruction = "導航已結束";
          this.state.navigation.speedKph = 0;
        }
        this.changed();
        return { status: "ok", text: "導航已結束" };
      case "navigation.position": {
        this.driver(registration);
        const nav = this.state.navigation,
          route = this.state.trip.route;
        if (!nav || nav.status !== "active" || nav.mode !== "gps")
          throw new Error("NAVIGATION_NOT_ACTIVE");
        if (
          command.version !== nav.tripVersion ||
          command.version !== this.state.trip.version
        )
          throw new Error("TRIP_CHANGED");
        if (
          !route ||
          !Number.isFinite(command.longitude) ||
          !Number.isFinite(command.latitude) ||
          Math.abs(command.longitude) > 180 ||
          Math.abs(command.latitude) > 90 ||
          !Number.isFinite(command.accuracy) ||
          command.accuracy < 0
        )
          throw new Error("GPS_POSITION_INVALID");
        if (
          command.observedAt < nav.updatedAt ||
          Math.abs(this.now() - command.observedAt) > 60000
        )
          throw new Error("GPS_POSITION_STALE");
        nav.updatedAt = command.observedAt;
        nav.position = [command.longitude, command.latitude];
        if (command.accuracy > 100) {
          nav.instruction = "GPS 精度不足，等待較準確定位";
          nav.speedKph = 0;
          this.changed();
          return { status: "ok" };
        }
        const snapped = project(route, nav.position);
        if (snapped.offset > 100) {
          nav.instruction = "已偏離路線，請重新設定路線";
          nav.speedKph = 0;
          this.changed();
          return { status: "ok" };
        }
        const endDistance = distance(nav.position, route.coordinates.at(-1)!);
        const traveled =
          route.distanceMeters - snapped.meters <= 10 && endDistance > 25
            ? Math.max(0, route.distanceMeters - endDistance)
            : snapped.meters;
        this.state.navigation = updateNavigation(
          nav,
          route,
          traveled,
          nav.position,
          command.observedAt,
        );
        this.state.navigation.speedKph =
          this.state.navigation.status === "arrived"
            ? 0
            : Math.max(0, Math.min(100, command.speed)) * 3.6;
        this.changed();
        return { status: "ok" };
      }

      case "people.set":
        this.driver(registration);
        if (
          this.state.ballot &&
          ["scheduled", "pending", "optimizing", "error"].includes(
            this.state.ballot.status,
          )
        ) {
          this.state.ballot.status = "cancelled";
          this.state.ballot.reason = "乘員名單已變更，請重新發起投票";
          this.declineCore();
          if (this.timer) clearTimeout(this.timer);
        }
        this.state.people = people(command.count);
        this.state.policy = command.policy;
        this.state.photos = [];
        this.state.captions = [];
        this.changed();
        return { status: "ok" };
      case "photo.share": {
        const p = this.actor(command.personId, registration);
        if (p.seat !== "rear") throw new Error("REAR_PHOTO_ONLY");
        if (!this.state.people.some((p) => p.seat === "front"))
          throw new Error("FRONT_PASSENGER_NOT_PRESENT");
        this.state.photos = [
          ...this.state.photos.slice(-3),
          {
            id: randomUUID(),
            sender: p.name,
            dataUrl: command.dataUrl,
            createdAt: this.now(),
          },
        ];
        this.changed();
        return { status: "ok", text: "照片已送到前座媽媽的螢幕" };
      }
      case "photo.ack":
        if (registration.role !== "front_passenger")
          throw new Error("PHOTO_RECEIVER_ONLY");
        this.state.photos = this.state.photos.filter(
          (p) => p.id !== command.photoId,
        );
        this.changed();
        return { status: "ok" };
      case "image.search": {
        if (
          !["front_passenger", "rear", "interactive_window"].includes(
            registration.role,
          )
        )
          throw new Error("PHOTO_ROLE_REQUIRED");
        if (!this.online()) throw new Error("IMAGE_SEARCH_REQUIRES_NETWORK");
        const photo = this.state.photos.find((p) => p.id === command.photoId);
        if (!photo) throw new Error("PHOTO_EXPIRED");
        const identified = await this.options.intelligence.identify(
          photo.dataUrl,
          this.context(),
        );
        const images = await (
          this.options.imageSearch ?? searchSimilarImageCandidates
        )(identified.imageQuery ?? identified.query);
        const candidates: CabinPlace[] = images.map((i) => ({
          id: i.id,
          name: i.title,
          address: "",
          latitude: 0,
          longitude: 0,
          provider: "mapbox",
          observedAt: this.now(),
          mapsUrl: i.url,
          photo: i.dataUrl,
        }));
        const compared = await this.options.intelligence.matchImages(
          photo.dataUrl,
          candidates,
        );
        const ranked = images
          .flatMap((image) => {
            const match = compared.find((m) => m.id === image.id);
            return match
              ? [{ ...image, score: match.score, reason: match.reason }]
              : [];
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        let places: CabinPlace[] = [];
        if (this.options.maps) places = await this.search(identified.query);
        return {
          status: "ok",
          text: identified.description,
          images: ranked,
          places,
          provider: "Gemini＋Wikimedia Commons",
          source: "api",
        };
      }
      case "caption.send": {
        const person = this.actor(command.personId, registration);
        this.caption(person, command.text, "keyboard");
        return { status: "ok", text: command.text, source: "keyboard" };
      }
      case "speech.transcribe": {
        const person = this.actor(command.personId, registration);
        const tripVersion = command.tripVersion ?? this.state.trip.version;
        if (command.purpose === "trip_edit") {
          if (!["center", "front_passenger"].includes(registration.role))
            throw new Error("TRIP_EDIT_FORBIDDEN");
          if (tripVersion !== this.state.trip.version)
            throw new Error("TRIP_CHANGED");
        }
        if (
          command.purpose === "vote" &&
          this.state.ballot?.status === "scheduled"
        )
          throw new Error("BALLOT_NOT_PENDING");
        const ballotId = command.ballotId ?? this.state.ballot?.id;
        if (
          command.purpose === "vote" &&
          command.ballotId &&
          this.state.ballot?.id !== command.ballotId
        )
          throw new Error("BALLOT_CHANGED");
        const transcript = await this.options.intelligence.transcribe(
          command.data,
          command.mimeType,
          this.online(),
          command.purpose === "trip_edit"
            ? this.state.trip.stops.map((place) => place.name)
            : command.purpose === "vote"
              ? [this.state.ballot?.place.name ?? ""].filter(Boolean)
              : [...this.places.values()].slice(-20).map((place) => place.name),
          command.purpose,
        );
        this.actor(command.personId, registration);
        if (command.purpose === "trip_edit") {
          if (tripVersion !== this.state.trip.version)
            throw new Error("TRIP_CHANGED");
          const intent = parseTripEdit(transcript);
          if (!intent) throw new Error("VOICE_TRIP_EDIT_UNCLEAR");
          if (intent.type === "clear")
            return {
              ...(await this.command(
                { type: "trip.clear", version: tripVersion },
                registration,
              )),
              source: "voice",
            };
          const normalize = normalizeChinese;
          const spokenName = resolveSpokenName(
            intent.name,
            this.state.trip.stops.map((place) => place.name),
          );
          const targetName = spokenName ?? intent.name;
          const matches = this.state.trip.stops.filter(
            (p) => normalize(p.name) === normalize(targetName),
          );
          const candidates = matches.length
            ? matches
            : this.state.trip.stops.filter((p) =>
                normalize(p.name).includes(normalize(targetName)),
              );
          if (candidates.length !== 1)
            throw new Error(
              candidates.length
                ? "VOICE_TRIP_EDIT_AMBIGUOUS"
                : "JOURNEY_STOP_NOT_FOUND",
            );
          const result = await this.command(
            {
              type: "trip.remove",
              placeId: candidates[0]!.id,
              version: tripVersion,
            },
            registration,
          );
          return {
            ...result,
            text: `已刪除 ${candidates[0]!.name}，路線已更新。`,
            source: "voice",
          };
        }
        if (command.purpose === "caption") {
          this.caption(person, transcript, "voice");
          return { status: "ok", text: transcript, source: "voice" };
        }
        if (command.purpose === "vote") {
          if (person.seat !== "driver") throw new Error("DRIVER_VOICE_ONLY");
          const approve = parseVoiceVote(transcript);
          if (approve === null) throw new Error("VOICE_VOTE_UNCLEAR");
          if (this.state.ballot?.status === "pending") {
            if (this.state.ballot.id !== ballotId)
              throw new Error("BALLOT_CHANGED");
            await this.vote(person.id, this.state.ballot.id, approve);
          } else {
            if (ballotId) throw new Error("BALLOT_NOT_PENDING");
            const pending = [...this.options.runtime.getState().activeProposals]
              .reverse()
              .find(
                (p) =>
                  p.status === "awaiting_consent" &&
                  p.requiresConsent &&
                  !p.payload?.cabinBallot,
              );
            if (!pending) throw new Error("NO_PENDING_CONFIRMATION");
            this.submit(registration, {
              type: "action.consent",
              payload: {
                proposalId: pending.proposalId,
                decision: approve ? "approve" : "decline",
              },
            });
          }
          return { status: "ok", text: transcript, source: "voice" };
        }
        const destination = transcript
          .replace(
            /^(?:請|幫我|我要|我們想|我想)?\s*(?:加入|新增|導航到|去|到|推薦)?\s*/,
            "",
          )
          .trim();
        const recommend = /推薦|建議|附近|沿途/.test(transcript);
        let query = destination,
          reason = "";
        let provider = this.options.maps?.provider ?? "";
        if (recommend) {
          const result = await this.recommend(transcript);
          return {
            status: "ok",
            ...result,
            text: `聽到：${transcript} · ${result.text}`,
            source: "voice",
          };
        }
        const found = await this.search(query);
        return {
          status: "ok",
          text: `聽到：${transcript}${reason ? " · " + reason : ""}。請選擇正確景點後發起投票。`,
          places: found,
          provider,
          source: "voice",
        };
      }
      case "place.search": {
        let query = command.query;
        let reason = "";
        let provider = this.options.maps?.provider ?? "";
        if (command.recommend) {
          const result = await this.recommend(query);
          return {
            status: "ok",
            ...result,
            source:
              result.places.length && result.places.every((p) => p.fromCache)
                ? "cache"
                : this.online()
                  ? "api"
                  : "cache",
          };
        }
        let found: CabinPlace[];
        try {
          found = await this.search(query);
        } catch (error) {
          const hits = this.cached(query);
          if (!hits.length) throw error;
          return {
            status: "ok",
            places: hits,
            text: "地圖服務暫不可用，使用已儲存景點；資料非即時。",
            provider: "本機快取",
            source: "cache",
          };
        }
        return {
          status: "ok",
          places: found,
          text: found.some((p) => p.fromCache)
            ? `已儲存景點：${query}（非即時資料）`
            : reason || `搜尋：${query}`,
          provider:
            found.some((p) => p.fromCache) || !this.online()
              ? "本機快取（非即時）"
              : provider,
          source:
            found.some((p) => p.fromCache) || !this.online() ? "cache" : "api",
        };
      }
      case "trip.clear":
      case "trip.remove": {
        if (!["center", "front_passenger"].includes(registration.role))
          throw new Error("TRIP_EDIT_FORBIDDEN");
        if (command.version !== this.state.trip.version)
          throw new Error("TRIP_CHANGED");
        if (this.tripBusy || this.state.ballot?.status === "optimizing")
          throw new Error("TRIP_BUSY");
        const trip = this.state.trip;
        if (command.type === "trip.clear") {
          this.declineCore();
          if (this.timer) clearTimeout(this.timer);
          this.options.runtime.replaceCabinJourney([], randomUUID());
          this.state.trip = {
            version: trip.version + 1,
            origin: null,
            destination: null,
            stops: [],
            route: null,
          };
          this.state.ballot = null;
          this.changed();
          return { status: "ok", text: "共享行程已清空" };
        }
        if (
          this.state.ballot &&
          ["scheduled", "pending", "error"].includes(this.state.ballot.status)
        )
          throw new Error("TRIP_BUSY");
        if (!trip.stops.some((p) => p.id === command.placeId))
          throw new Error("JOURNEY_STOP_NOT_FOUND");
        if (!this.options.maps || !trip.origin || !trip.destination)
          throw new Error("MAP_SERVICE_REQUIRED");
        if (!this.online()) throw new Error("ROUTE_REQUIRES_NETWORK");
        this.tripBusy = true;
        try {
          const stops = trip.stops.filter((p) => p.id !== command.placeId);
          const route = await this.options.maps.route(
            trip.origin,
            trip.destination,
            stops,
          );
          if (
            route.order.length !== stops.length ||
            new Set(route.order).size !== stops.length ||
            route.order.some((id) => !stops.some((p) => p.id === id))
          )
            throw new Error("ROUTE_INVALID");
          const ordered = route.order.map((id) =>
            stops.find((p) => p.id === id)!,
          );
          this.options.runtime.replaceCabinJourney(
            ordered.map((p) => p.id),
            randomUUID(),
          );
          this.state.trip = {
            ...trip,
            version: trip.version + 1,
            stops: ordered,
            route,
          };
          this.state.ballot = null;
          this.changed();
          return { status: "ok", text: "景點已刪除，路線已更新" };
        } finally {
          this.tripBusy = false;
        }
      }
      case "trip.configure": {
        if (!["center", "front_passenger"].includes(registration.role))
          throw new Error("TRIP_EDIT_FORBIDDEN");
        if (this.tripBusy) throw new Error("TRIP_BUSY");
        if (!this.options.maps) throw new Error("MAP_SERVICE_REQUIRED");
        if (!this.online()) throw new Error("ROUTE_REQUIRES_NETWORK");
        if (
          this.state.ballot &&
          ["scheduled", "pending", "error"].includes(this.state.ballot.status)
        ) {
          this.state.ballot.status = "cancelled";
          this.state.ballot.reason = "行程正在重新設定";
          this.declineCore();
          if (this.timer) clearTimeout(this.timer);
          this.changed();
        }
        this.tripBusy = true;
        try {
          const origin = (await this.search(command.origin))[0];
          const destination = (await this.search(command.destination))[0];
          if (!origin || !destination) throw new Error("TRIP_PLACE_NOT_FOUND");
          const stops = this.state.trip.stops;
          const route = await this.options.maps.route(
            origin,
            destination,
            stops,
          );
          if (
            route.order.length !== stops.length ||
            new Set(route.order).size !== stops.length ||
            route.order.some((id) => !stops.some((p) => p.id === id))
          )
            throw new Error("ROUTE_ORDER_INVALID");
          const ordered = route.order.map((id) =>
            stops.find((p) => p.id === id)!,
          );
          if (
            this.state.ballot &&
            ["scheduled", "pending", "optimizing", "error"].includes(
              this.state.ballot.status,
            )
          ) {
            this.state.ballot.status = "cancelled";
            this.state.ballot.reason = "行程已重新設定";
          }
          if (this.timer) clearTimeout(this.timer);
          this.options.runtime.replaceCabinJourney(
            ordered.map((p) => p.id),
            randomUUID(),
          );
          this.state.trip = {
            version: this.state.trip.version + 1,
            origin,
            destination,
            stops: ordered,
            route,
          };
          this.state.ballot = null;
          this.changed();
          return {
            status: "ok",
            text: `已設定 ${origin.name} → ${destination.name}`,
          };
        } finally {
          this.tripBusy = false;
        }
      }
      case "trip.propose": {
        const actor = this.actor(command.personId, registration);
        if (this.tripBusy) throw new Error("TRIP_BUSY");
        if (!this.state.trip.origin || !this.state.trip.destination)
          throw new Error("TRIP_NOT_CONFIGURED");
        if (
          this.state.ballot &&
          ["scheduled", "pending", "optimizing"].includes(
            this.state.ballot.status,
          )
        )
          throw new Error("BALLOT_ALREADY_PENDING");
        const place = this.places.get(command.placeId);
        if (
          !place ||
          (this.online() && this.now() - place.observedAt > 60 * 60 * 1000)
        )
          throw new Error("PLACE_EXPIRED");
        if (
          this.state.trip.stops.some((p) => p.id === place.id) ||
          this.state.trip.destination.id === place.id
        )
          throw new Error("PLACE_ALREADY_IN_TRIP");
        if (this.state.trip.stops.length >= 8)
          throw new Error("TOO_MANY_STOPS");
        const votingEnabled = command.votingEnabled ?? true;
        const delay = command.startDelaySeconds ?? 0;
        if (
          !Number.isInteger(delay) ||
          delay < 0 ||
          delay > 3600 ||
          (command.voteDurationSeconds !== undefined &&
            (!Number.isInteger(command.voteDurationSeconds) ||
              command.voteDurationSeconds < 10 ||
              command.voteDurationSeconds > 300))
        )
          throw new Error("VOTE_TIMING_INVALID");
        if (!votingEnabled && delay > 0) throw new Error("VOTE_TIMING_INVALID");
        const duration =
          command.voteDurationSeconds !== undefined
            ? command.voteDurationSeconds * 1000
            : (this.options.voteTimeoutMs ?? 60000);
        const opensAt = this.now() + delay * 1000;
        const proposalId = randomUUID();
        this.submit(registration, {
          type: "action.propose",
          payload: {
            proposal: {
              proposalId,
              kind: "ADD_TRIP_STOP",
              summary: `加入 ${place.name} · ${votingEnabled ? "乘員投票" : "駕駛確認"}`,
              targetRole: "center",
              priority: "secondary",
              requiresConsent: true,
              payload: {
                placeId: place.id,
                label: place.name,
                source: "api",
                cabinBallot: true,
                provider: place.provider,
              },
            },
          },
        });
        this.state.ballot = {
          id: randomUUID(),
          proposer: actor.name,
          place,
          electorate: structuredClone(this.state.people),
          votes: {},
          status: delay > 0 ? "scheduled" : "pending",
          policy: this.state.policy,
          votingEnabled,
          opensAt,
          deadline: opensAt + duration,
          reason:
            delay > 0
              ? "等待投票開始"
              : votingEnabled
                ? "等待乘員投票與駕駛語音確認"
                : "不進行乘員投票，等待駕駛確認",
          tripVersion: this.state.trip.version,
          route: null,
          proposalId,
        };
        this.armBallotTimer();
        this.changed();
        return { status: "ok" };
      }
      case "vote.cast": {
        this.actor(command.personId, registration.role === "cluster" ? { ...registration, role: "center" } : registration);
        await this.vote(command.personId, command.ballotId, command.approve);
        return { status: "ok" };
      }
      case "vote.retry":
        this.driver(registration);
        if (
          this.state.ballot?.id !== command.ballotId ||
          this.state.ballot.status !== "error"
        )
          throw new Error("BALLOT_NOT_RETRYABLE");
        await this.finalize(this.state.ballot);
        return { status: "ok" };
    }
  }
  private armBallotTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    const b = this.state.ballot;
    if (!b || !["scheduled", "pending"].includes(b.status)) return;
    const waiting = b.status === "scheduled";
    const wake = waiting ? b.opensAt! : b.deadline;
    this.timer = setTimeout(
      () => {
        if (
          this.state.ballot?.id !== b.id ||
          !["scheduled", "pending"].includes(b.status)
        )
          return;
        if (this.now() >= b.deadline) {
          b.status = "expired";
          b.reason =
            b.votingEnabled === false
              ? "駕駛確認逾時，行程保持原樣"
              : "投票逾時，行程保持原樣";
          this.declineCore();
          this.changed();
          return;
        }
        if (waiting && this.now() >= (b.opensAt ?? 0)) {
          b.status = "pending";
          b.reason = "等待乘員投票與駕駛語音確認";
          this.changed();
        }
        this.armBallotTimer();
      },
      Math.max(1, wake - this.now()),
    );
  }
  private caption(
    person: CabinPerson,
    text: string,
    source: "voice" | "keyboard",
  ): void {
    this.state.captions = [
      ...this.state.captions.slice(-11),
      {
        id: randomUUID(),
        sender: person.name,
        seat: person.seat,
        text,
        source,
        createdAt: this.now(),
      },
    ];
    this.changed();
  }
  private async vote(
    personId: string,
    ballotId: string,
    approve: boolean,
  ): Promise<void> {
    const b = this.state.ballot;
    if (!b || b.id !== ballotId || b.status !== "pending")
      throw new Error("BALLOT_NOT_PENDING");
    if (this.now() >= b.deadline) throw new Error("BALLOT_EXPIRED");
    if (b.votingEnabled === false && personId !== "driver")
      throw new Error("DRIVER_CONFIRMATION_ONLY");
    if (!b.electorate.some((p) => p.id === personId))
      throw new Error("NOT_IN_ELECTORATE");
    if (Object.prototype.hasOwnProperty.call(b.votes, personId))
      throw new Error("ALREADY_VOTED");
    b.votes[personId] = approve;
    const decision = voteOutcome(b);
    if (decision === "failed") {
      b.status = "failed";
      b.reason =
        b.votingEnabled === false
          ? "駕駛未同意，行程保持原樣"
          : "投票未通過，行程保持原樣";
      if (this.timer) clearTimeout(this.timer);
      b.notificationUntil = this.now() + 5000;
      this.timer = setTimeout(() => {
        if (this.state.ballot?.id === b.id && b.status === "failed")
          this.changed();
      }, 5000);
      this.declineCore();
      this.changed();
      return;
    }
    this.changed();
    if (decision === "passed") {
      if (this.tripBusy) {
        b.status = "error";
        b.reason = "TRIP_BUSY · 路線計算中，請稍後重試";
        this.changed();
      } else await this.finalize(b);
    }
  }
  private async finalize(b: CabinBallot): Promise<void> {
    if (this.tripBusy) throw new Error("TRIP_BUSY");
    if (voteOutcome(b) !== "passed") throw new Error("VOTE_NOT_APPROVED");
    if (b.tripVersion !== this.state.trip.version) {
      b.status = "cancelled";
      b.reason = "行程已變更，請重新投票";
      this.changed();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    b.status = "optimizing";
    b.reason = "已同意，正在重新計算與最佳化路線";
    this.tripBusy = true;
    this.changed();
    try {
      if (
        !this.options.maps ||
        !this.state.trip.origin ||
        !this.state.trip.destination
      )
        throw new Error("TRIP_NOT_CONFIGURED");
      if (!this.online()) throw new Error("ROUTE_REQUIRES_NETWORK");
      const stops = [...this.state.trip.stops, b.place];
      const route = await this.options.maps.route(
        this.state.trip.origin,
        this.state.trip.destination,
        stops,
      );
      if (
        this.state.ballot?.id !== b.id ||
        b.status !== "optimizing" ||
        b.tripVersion !== this.state.trip.version
      )
        return;
      const ordered = route.order.map((id) => stops.find((p) => p.id === id)!);
      if (
        ordered.some((p) => !p) ||
        new Set(route.order).size !== stops.length ||
        ordered.length !== stops.length
      )
        throw new Error("ROUTE_ORDER_INVALID");
      const center = this.options.registry.displays.find(
        (d) => d.role === "center" && d.enabled,
      );
      if (!center || !b.proposalId) throw new Error("DRIVER_DISPLAY_REQUIRED");
      this.submit(center, {
        type: "action.consent",
        payload: { proposalId: b.proposalId, decision: "approve" },
      });
      const proposal = this.options.runtime
        .getState()
        .activeProposals.find((p) => p.proposalId === b.proposalId);
      if (!proposal || !["executing", "completed"].includes(proposal.status))
        throw new Error("CORE_CONSENT_NOT_APPLIED");
      this.state.trip = {
        ...this.state.trip,
        version: this.state.trip.version + 1,
        stops: ordered,
        route,
      };
      // A successful insertion continues an existing GPS session on the new route.
      const navigation = this.state.navigation;
      if (navigation?.status === "active" && navigation.mode === "gps") {
        this.state.navigation = {
          ...navigation,
          tripVersion: this.state.trip.version,
          traveledMeters: 0,
          remainingMeters: route.distanceMeters,
          remainingSeconds: route.durationSeconds,
          nextManeuverMeters: 0,
          instruction: "景點已加入，繼續導航 · 等待定位更新",
        };
      }
      b.route = route;
      b.status = "passed";
      b.reason =
        b.votingEnabled === false
          ? "駕駛已同意，景點已加入並完成路線最佳化"
          : "投票通過，景點已加入並完成路線最佳化";
      this.changed();
    } catch (error) {
      if (this.state.ballot?.id === b.id && b.status === "optimizing") {
        b.status = "error";
        b.reason = `${safeError(error)} · 尚未變更共享路線，可由駕駛重試`;
        this.changed();
      }
    } finally {
      this.tripBusy = false;
    }
  }
  private declineCore(): void {
    const b = this.state.ballot;
    const center = this.options.registry.displays.find(
      (d) => d.role === "center" && d.enabled,
    );
    if (center && b?.proposalId) {
      try {
        this.submit(center, {
          type: "action.consent",
          payload: { proposalId: b.proposalId, decision: "decline" },
        });
      } catch {
        /* State stays terminal even when consent is no longer pending. */
      }
    }
  }
  private submit(
    registration: DisplayRegistration,
    command: Extract<ClientMessage, { kind: "command" }>["envelope"]["command"],
  ): void {
    const id = randomUUID();
    const receipt = this.options.runtime.submitCommand({
      kind: "command",
      protocolVersion: 1,
      messageId: id,
      sentAt: this.now(),
      sessionId: this.options.runtime.sessionId,
      commandId: id,
      traceId: id,
      sender: {
        displayId: registration.displayId,
        deviceId: registration.deviceId,
      },
      command,
    });
    if (receipt.status === "REJECTED")
      throw new Error(receipt.reasonCode ?? "CORE_COMMAND_REJECTED");
  }
}
export function voteOutcome(
  ballot: Pick<
    CabinBallot,
    "electorate" | "votes" | "policy" | "votingEnabled"
  >,
): "pending" | "passed" | "failed" {
  if (ballot.votingEnabled === false)
    return ballot.votes.driver === true
      ? "passed"
      : ballot.votes.driver === false
        ? "failed"
        : "pending";
  const total = ballot.electorate.length;
  const votes = ballot.electorate.map((p) => ballot.votes[p.id]);
  const yes = votes.filter((v) => v === true).length;
  const no = votes.filter((v) => v === false).length;
  const needed =
    ballot.policy === "unanimous" ? total : Math.floor(total / 2) + 1;
  if (ballot.policy === "majority_driver" && ballot.votes.driver === false)
    return "failed";
  if (no > total - needed) return "failed";
  if (
    yes >= needed &&
    (ballot.policy !== "majority_driver" || ballot.votes.driver === true)
  )
    return "passed";
  return "pending";
}
export function parseTripEdit(
  text: string,
): { type: "clear" } | { type: "remove"; name: string } | null {
  const normalized = traditional(text).replace(/[\s，。！？,.!?]/g, "");
  if (/嗎|吗|不要|不想|不確定|如果|可能|也許|可以|能不能|是否/.test(normalized))
    return null;
  const command = normalized.replace(/^(?:麻煩|請)?(?:幫我|幫忙|我要|我想)?/, "").replace(/(?:謝謝|一下|吧|喔|哦)$/, "");
  if (
    /^(?:清空(?:全部|所有)?(?:行程|旅程)|刪除(?:全部|所有)(?:行程|景點))$/.test(
      command,
    )
  )
    return { type: "clear" };
  const match = command.match(/^(?:刪除|移除|取消)(?:行程中的|行程裡的|景點)?(.{1,100})$/) ?? command.match(/^(?:把|將)(.{1,100}?)(?:從行程(?:中|裡))?(?:刪掉|移除|刪除|取消)$/);
  if (!match || /行程|旅程|以及|還有|、|刪除|移除/.test(match[1]!)) return null;
  return { type: "remove", name: match[1]! };
}
export function parseVoiceVote(text: string): boolean | null {
  const normalized = traditional(text)
    .replace(/[\s，。！？,.!?]/g, "")
    .replace("將入形成", "加入行程")
    .replace("加入形成", "加入行程")
    .replace(/^(?:好的|好|嗯)[、]?/, "")
    .replace(/(?:謝謝|吧|喔|哦)$/, "");
  if (/嗎|吗|如果|也許|可能|考慮|不確定|没有|沒有|好像|應該|大概|可以嗎|是不是/.test(normalized))
    return null;
  if (
    /^(?:我)?(?:不同意|反對|拒絕|不要加入|維持原行程|不要更改行程|不要加|不加入|先不要|不用加入)(?:加入.*|這個.*|行程.*|提案.*)?$/.test(
      normalized,
    )
  )
    return false;
  if (/不同意|不要|反對/.test(normalized)) return null;
  if (
    /^(?:我)?(?:同意|接受|贊成|確認|確定加入|可以加入|加入)(?:加入.*|這個.*|此.*|行程.*|提案.*)?$/.test(
      normalized,
    )
  )
    return true;
  return null;
}
function people(count: number): CabinPerson[] {
  if (!Number.isInteger(count) || count < 1 || count > 6)
    throw new Error("PASSENGER_COUNT_INVALID");
  const result: CabinPerson[] = [
    { id: "driver", name: "駕駛", seat: "driver" },
  ];
  if (count >= 2)
    result.push({ id: "mother", name: "前座媽媽", seat: "front" });
  for (let i = 1; i <= count - 2; i++)
    result.push({
      id: `rear-${i}`,
      name: i === 1 ? "後座小孩" : `後座乘員 ${i}`,
      seat: "rear",
    });
  return result;
}
export function safeError(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message)
    ? error.message
    : "CABIN_REQUEST_FAILED";
}
export function createCabinCoordinator(
  runtime: CoreRuntime,
  registry: DisplayRegistry,
  env: NodeJS.ProcessEnv = process.env,
  persistence: Pick<
    CabinCoordinatorOptions,
    | "initialTrip"
    | "initialCount"
    | "checkpoint"
    | "initialPlaces"
    | "initialQueries"
    | "savePlaces"
  > = {},
): CabinCoordinator {
  if (!runtime.getState().driver.currentLoad)
    runtime.ingestSignal(
      {
        signalId: randomUUID(),
        type: "driver.cognitive_load",
        value: { level: "normal", confidence: 1 },
        source: "simulated",
        timestamp: Date.now(),
        confidence: 1,
      },
      "cabin-initial-state",
    );
  runtime.updateConnectivity({
    mode: env.AURA_START_OFFLINE === "true" ? "offline" : "online",
    source: "derived",
    evidence: "HOST_INITIAL_ROUTING_MODE",
    traceId: "cabin-initial-connectivity",
  });
  const token = env.MAPBOX_ACCESS_TOKEN?.trim();
  const key = env.GOOGLE_MAPS_API_KEY?.trim();
  const maps =
    env.AURA_MAP_PROVIDER === "mapbox" && token
      ? new MapboxCabinMaps(token)
      : env.AURA_MAP_PROVIDER === "google" && key
        ? new GoogleCabinMaps(key, env.GOOGLE_MAPS_EMBED_KEY)
        : new OsmCabinMaps({
            searchEndpoint: env.AURA_OSM_SEARCH_URL,
            routeEndpoint: env.AURA_OSRM_URL,
          });
  return new CabinCoordinator({
    ...persistence,
    runtime,
    registry,
    intelligence: new CabinModelIntelligence(env),
    ...(maps ? { maps } : {}),
    ...(env.MAPBOX_PUBLIC_TOKEN?.startsWith("pk.")
      ? { publicMapToken: env.MAPBOX_PUBLIC_TOKEN }
      : token?.startsWith("pk.")
        ? { publicMapToken: token }
        : {}),
  });
}
