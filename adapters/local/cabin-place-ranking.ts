import { pinyin } from "pinyin-pro";
import OpenCC from "opencc-js";
import type {
  CabinPlace,
  CabinTrip,
} from "../../contracts/protocol/src/cabin.js";
const convert = OpenCC.Converter({ from: "cn", to: "tw" });
export const traditional = (text: string): string => convert(text);
export const normalizeChinese = (text: string): string =>
  traditional(text).replace(/\s/g, "").replace(/臺/g, "台").toLowerCase();
const categories: [string, RegExp][] = [
  ["lake", /湖|潭|lake|water/],
  ["museum", /博物館|展覽|展館|museum/],
  ["zoo", /動物|zoo/],
  ["cafe", /咖啡|cafe|coffee/],
  ["restaurant", /餐|吃|飯|餓|麥當勞|restaurant|fast_food/],
  ["park", /公園|park/],
  ["hiking", /爬山|登山|步道|山|hiking/],
  ["viewpoint", /海|景觀|風景|拍照|viewpoint/],
  ["transport", /車站|搭車|轉運|station|transport/],
];
function kilometers(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = Math.PI / 180,
    lat = ((a.latitude + b.latitude) * radians) / 2;
  return (
    Math.hypot(
      (a.longitude - b.longitude) * Math.cos(lat),
      a.latitude - b.latitude,
    ) *
    radians *
    6371
  );
}
export interface RankedCandidate {
  place: CabinPlace;
  distanceKm: number | null;
  score: number;
  nameHints?: string[];
}
export function prepareCandidates(
  query: string,
  places: CabinPlace[],
  trip?: CabinTrip,
): RankedCandidate[] {
  const q = normalizeChinese(query);
  let positive = q;
  const excluded = new Set<string>();
  for (const [type, pattern] of categories) {
    const negative = new RegExp(`(?:不要|不想|避免|別去|不去)(?:再|去|看|喝|吃|逛)?(?:${pattern.source})`, "g");
    if (negative.test(q)) excluded.add(type);
    positive = positive.replace(negative, "");
  }
  const intent = categories.filter(([, pattern]) => pattern.test(positive)).map(([category]) => category);
  const desiredSpecific = intent.filter(type => type !== "hiking");
  const ranked = places
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .map((place) => {
      const text = normalizeChinese(`${place.name} ${place.category ?? ""}`),
        types = categories
          .filter(([, pattern]) => pattern.test(text))
          .map(([category]) => category);
      const distanceKm = trip?.origin ? kilometers(place, trip.origin) : null;
      let score = types.filter((type) => intent.includes(type)).length * 8;
      if(/小孩|孩子|親子|兒童/.test(q) && types.some(type=>['park','zoo','museum'].includes(type)))score+=4;
      if(/休息|累|坐著|坐一下/.test(q) && types.some(type=>['cafe','restaurant','park'].includes(type)))score+=8;
      if (distanceKm !== null) score -= Math.min(20, distanceKm / 3);
      if (trip?.origin && trip.destination) {
        const detour =
          kilometers(place, trip.origin) +
          kilometers(place, trip.destination) -
          kilometers(trip.origin, trip.destination);
        score -= Math.min(20, detour / 3);
      }
      if (types.some(type => excluded.has(type))) score = -100;
      if (
        /導覽圖|標示|里程牌|材料行|企業社|公司|銀行|修理廠|platform|路線圖/.test(
          text,
        ) &&
        !/車站|搭車|導覽圖|銀行|修車/.test(q)
      )
        score -= 50;
      if (types.includes("transport") && !intent.includes("transport"))
        score -= 25;
      return { place, distanceKm, score, types };
    });
  const matching = ranked.filter(
    (p) =>
      !desiredSpecific.length ||
      desiredSpecific.some((type) => p.types.includes(type)),
  );
  const pool = desiredSpecific.length ? matching : ranked;
  return pool
    .filter((p) => p.score > -25)
    .sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id))
    .slice(0, 12)
    .filter(
      (candidate, index, items) =>
        !items
          .slice(0, index)
          .some(
            (other) =>
              normalizeChinese(other.place.name) ===
                normalizeChinese(candidate.place.name) &&
              kilometers(other.place, candidate.place) < 0.2,
          ),
    )
    .map(({ types, ...p }) => ({ ...p, nameHints: types }));
}
export function unverifiedHardRequirement(query: string): boolean {
  return (
    /一定|必須|保證|只要|限定/.test(query) &&
    /免費|票價|24\s*小時|開放|營業|座椅|座位|停車|無障礙|步行|走路.{0,8}分鐘/.test(
      query,
    )
  );
}
export function groundedReason(reason: string, places: CabinPlace[]): string {
  const normalized = traditional(reason).trim().slice(0, 180);
  if (
    /免費|24.{0,2}小時|有座椅|有座位|有停車|無障礙|步行.{0,10}分鐘|室內.*動物園|動物園.*室內|保證|一定適合/.test(
      normalized,
    )
  )
    return `可先考慮${places.map((p) => p.name).join("、")}；設施、票價、開放時間與步行距離尚未查證。`;
  return normalized + " 設施與實際步行距離仍需確認。";
}

// Explicitly confirmed by the user; apply only when the canonical place is known.
const spokenAliases: Record<string, string> = { "李魚殘": "鯉魚潭" };
export function correctKnownPlaceNames(text: string, names: string[]): string {
  let corrected = traditional(text);
  for (const [spoken, canonical] of Object.entries(spokenAliases)) {
    if (names.some(name => normalizeChinese(name) === normalizeChinese(canonical)))
      corrected = corrected.replaceAll(spoken, canonical);
  }
  return corrected;
}

/** Resolve only exact full-name homophones, including tones; ambiguous names are never corrected. */
export function resolveSpokenName(
  text: string,
  names: string[],
): string | null {
  names = [
    ...new Map(names.map((name) => [normalizeChinese(name), name])).values(),
  ];
  text = correctKnownPlaceNames(text, names);
  const normalized = normalizeChinese(text);
  const exact = [
    ...new Set(names.filter((name) => normalizeChinese(name) === normalized)),
  ];
  if (exact.length === 1) return exact[0]!;
  if (!/^[\u3400-\u9fff]{2,30}$/.test(normalized)) return null;
  const key = pinyin(traditional(text), { toneType: "num" });
  const matches = [
    ...new Set(
      names.filter(
        (name) => pinyin(traditional(name), { toneType: "num" }) === key,
      ),
    ),
  ];
  return matches.length === 1 ? matches[0]! : null;
}
