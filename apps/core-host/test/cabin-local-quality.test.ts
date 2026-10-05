import test from "node:test";
import assert from "node:assert/strict";
import { CabinModelIntelligence } from "../../../adapters/voice/cabin-intelligence.js";
import {
  normalizeChinese,
  correctKnownPlaceNames,
  prepareCandidates,
  resolveSpokenName,
} from "../../../adapters/local/cabin-place-ranking.js";
import type { CabinPlace } from "../../../contracts/protocol/src/cabin.js";
const place = (id: string, name: string, category: string): CabinPlace => ({
  id,
  name,
  category,
  address: "test fixture",
  latitude: 24,
  longitude: 121,
  provider: "osm",
  mapsUrl: "https://www.openstreetmap.org",
  observedAt: Date.now(),
});
test("traditional conversion and full-tone homophones resolve known names only", () => {
  assert.equal(normalizeChinese("鲤鱼潭"), "鯉魚潭");
  assert.equal(resolveSpokenName("禮魚潭", ["鯉魚潭"]), "鯉魚潭");
  assert.equal(resolveSpokenName("禮魚潭", ["鯉魚潭", "禮魚壇"]), null);
  assert.equal(resolveSpokenName("未知景點", ["鯉魚潭"]), null);
});
test("retrieval excludes unrelated transport and prioritizes explicit lake intent", () => {
  const ranked = prepareCandidates("不要爬山，想看湖景", [
    place("station", "車站", "transport"),
    place("hill", "高山步道", "hiking"),
    place("lake", "湖畔景觀區", "lake"),
  ]);
  assert.equal(ranked[0]?.place.id, "lake");
  assert.ok(!ranked.some((p) => p.place.id === "hill"));
});
test("local output uses compact whitelist choices and maps to actual cached IDs", async () => {
  let body: Record<string, any> | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        done: true,
        response: JSON.stringify({
          choices: ["0"],
          reason: "名稱符合看湖的需求。",
        }),
      }),
      { status: 200 },
    );
  };
  const ai = new CabinModelIntelligence({ GEMINI_API_KEY: "" }, fetchImpl);
  const r = await ai.rankPlaces(
    "看湖景",
    "test",
    [place("lake", "湖畔景觀區", "lake")],
    false,
  );
  assert.deepEqual(r.ids, ["lake"]);
  assert.equal(body?.model, "qwen3:8b");
  assert.equal(body?.keep_alive, "10m");
  assert.match(r.reason, /需確認/);
});
test("unverified mandatory facilities yield an explanation instead of fake recommendations", async () => {
  let calls = 0;
  const ai = new CabinModelIntelligence({ GEMINI_API_KEY: "" }, async () => {
    calls++;
    throw Error("not expected");
  });
  const r = await ai.rankPlaces(
    "一定要保證免費、24小時開放且有座椅",
    "test",
    [place("lake", "湖畔景觀區", "lake")],
    false,
  );
  assert.deepEqual(r.ids, []);
  assert.equal(calls, 0);
  assert.match(r.reason, /無法保證/);
});
test("unavailable local model falls back transparently to catalog candidates", async () => {
  const ai = new CabinModelIntelligence(
    { GEMINI_API_KEY: "" },
    async () => new Response("{}", { status: 503 }),
  );
  const r = await ai.rankPlaces(
    "看湖景",
    "test",
    [place("lake", "湖畔景觀區", "lake")],
    false,
  );
  assert.deepEqual(r.ids, ["lake"]);
  assert.equal(r.provider, "本機資料篩選備援");
  assert.match(r.reason, /尚未經模型推荐|尚未經模型推薦/);
});

test("preferences exclude unwanted categories without inventing unrelated alternatives", () => {
  const places=[place("cafe","咖啡館","cafe"),place("restaurant","餐廳","restaurant"),place("park","公園","park")];
  assert.deepEqual(prepareCandidates("不要咖啡，想吃飯",places).map(x=>x.place.id),["restaurant"]);
  assert.deepEqual(prepareCandidates("不去公園，想喝咖啡",places).map(x=>x.place.id),["cafe"]);
  assert.deepEqual(prepareCandidates("想看動物",places),[]);
});
test("malformed and out-of-whitelist model outputs return transparent grounded backup", async () => {
  for (const response of [{choices:["999"],reason:"假的景點"},{choices:"0",reason:"bad"}]) {
    const ai=new CabinModelIntelligence({GEMINI_API_KEY:""},async()=>new Response(JSON.stringify({response:JSON.stringify(response)})));
    const result=await ai.rankPlaces("喝咖啡","test",[place("cafe","咖啡館","cafe")],false);
    assert.deepEqual(result.ids,["cafe"]);
    assert.equal(result.provider,"本機資料篩選備援");
  }
});

test("user-confirmed misrecognition is corrected only against known place names", () => {
  assert.equal(resolveSpokenName("李魚殘",["鯉魚潭"]),"鯉魚潭");
  assert.equal(resolveSpokenName("李魚殘",["七星潭"]),null);
  assert.equal(correctKnownPlaceNames("不要刪除李魚殘",["鯉魚潭"]),"不要刪除鯉魚潭");
  assert.equal(correctKnownPlaceNames("不同意去李魚殘",[]),"不同意去李魚殘");
});
