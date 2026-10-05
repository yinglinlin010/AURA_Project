export type CabinRole =
  "center" | "cluster" | "front_passenger" | "rear" | "interactive_window";
export interface CabinPerson {
  id: string;
  name: string;
  seat: "driver" | "front" | "rear";
}
export interface CabinPlace {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  provider: "google" | "mapbox" | "osm";
  observedAt: number;
  mapsUrl: string;
  photo?: string;
  photoAttribution?: string;
  category?: string;
  fromCache?: boolean;
}
export interface CabinNavigation {
  status: "idle" | "active" | "arrived" | "stopped";
  mode: "gps" | "demo";
  tripVersion: number;
  startedAt: number;
  updatedAt: number;
  position: [number, number] | null;
  traveledMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  instruction: string;
  nextManeuverMeters: number;
  speedKph: number;
}
export interface CabinRoute {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: Array<[number, number]>;
  order: string[];
  provider: "google" | "mapbox" | "osm";
  observedAt: number;
  mapsUrl: string;
  embedUrl?: string;
  steps?: Array<{ offsetMeters: number; instruction: string; type: string }>;
}
export interface CabinTrip {
  version: number;
  origin: CabinPlace | null;
  destination: CabinPlace | null;
  stops: CabinPlace[];
  route: CabinRoute | null;
}
export interface CabinPhoto {
  id: string;
  sender: string;
  dataUrl: string;
  createdAt: number;
}
export interface CabinCaption {
  id: string;
  sender: string;
  seat: "driver" | "front" | "rear";
  text: string;
  source: "voice" | "keyboard";
  createdAt: number;
}
export type VotePolicy = "majority_driver" | "unanimous" | "majority";
export interface CabinBallot {
  id: string;
  proposer: string;
  place: CabinPlace;
  electorate: CabinPerson[];
  votes: Record<string, boolean>;
  status:
    | "scheduled"
    | "pending"
    | "optimizing"
    | "passed"
    | "failed"
    | "cancelled"
    | "expired"
    | "error";
  policy: VotePolicy;
  deadline: number;
  notificationUntil?: number;
  opensAt?: number;
  votingEnabled?: boolean;
  reason: string;
  tripVersion: number;
  route: CabinRoute | null;
  proposalId?: string;
}
export interface CabinSnapshot {
  revision: number;
  navigation?: CabinNavigation;
  people: CabinPerson[];
  policy: VotePolicy;
  trip: CabinTrip;
  photos: CabinPhoto[];
  captions: CabinCaption[];
  ballot: CabinBallot | null;
  capabilities: {
    maps: "google" | "mapbox" | "osm" | null;
    cloud: boolean;
    localSpeech: boolean;
    tripSaved?: boolean;
    cachedPlaceCount?: number;
    placeCacheSaved?: boolean;
    publicMapToken?: string;
  };
}
export type CabinCommand =
  | { type: "place.cached"; query?: string }
  | { type: "navigation.start"; mode: "gps" | "demo"; version: number }
  | { type: "navigation.stop" }
  | {
      type: "navigation.position";
      version: number;
      longitude: number;
      latitude: number;
      accuracy: number;
      speed: number;
      observedAt: number;
    }
  | { type: "people.set"; count: number; policy: VotePolicy }
  | { type: "photo.share"; dataUrl: string; personId: string }
  | { type: "photo.ack"; photoId: string }
  | { type: "image.search"; photoId: string }
  | { type: "caption.send"; personId: string; text: string }
  | {
      type: "speech.transcribe";
      personId: string;
      data: string;
      mimeType: string;
      purpose: "caption" | "journey" | "vote" | "trip_edit";
      ballotId?: string;
      tripVersion?: number;
    }
  | { type: "place.search"; query: string; recommend: boolean }
  | { type: "trip.remove"; placeId: string; version: number }
  | { type: "trip.clear"; version: number }
  | { type: "trip.configure"; origin: string; destination: string }
  | {
      type: "trip.propose";
      personId: string;
      placeId: string;
      votingEnabled?: boolean;
      startDelaySeconds?: number;
      voteDurationSeconds?: number;
    }
  | { type: "vote.cast"; personId: string; ballotId: string; approve: boolean }
  | { type: "vote.retry"; ballotId: string };
export interface CabinCommandMessage {
  kind: "cabin.command";
  protocolVersion: 1;
  requestId: string;
  command: CabinCommand;
}
export interface CabinStateMessage {
  kind: "cabin.state";
  protocolVersion: 1;
  state: CabinSnapshot;
}
export interface CabinResultMessage {
  kind: "cabin.result";
  protocolVersion: 1;
  requestId: string;
  status: "ok" | "error";
  errorCode?: string;
  text?: string;
  places?: CabinPlace[];
  images?: Array<{
    id: string;
    title: string;
    url: string;
    dataUrl: string;
    attribution: string;
    score?: number;
    reason?: string;
  }>;
  provider?: string;
  source?: "voice" | "keyboard" | "api" | "cache";
}
