import { fetchJson } from "../shared/http.js";
export interface SimilarImage {
  id: string;
  title: string;
  url: string;
  dataUrl: string;
  attribution: string;
  score?: number;
  reason?: string;
}
/** Public Commons image search. Original screenshots are never uploaded to Commons. */
export async function searchSimilarImageCandidates(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SimilarImage[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  const params = {
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "4",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "320",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  interface Page {
    pageid: number;
    title: string;
    imageinfo?: Array<{
      thumburl?: string;
      descriptionurl?: string;
      extmetadata?: Record<string, { value: string }>;
    }>;
  }
  const raw = (await fetchJson(
    url,
    {
      headers: {
        "User-Agent": "AURA-Cabin-Prototype/1.0 (image research; local demo)",
      },
    },
    { fetchImpl },
  )) as { query?: { pages?: Record<string, Page> } };
  const candidates = Object.values(raw.query?.pages ?? {});
  return (
    await Promise.all(
      candidates.map(async (page) => {
        const info = page.imageinfo?.[0];
        if (!info?.thumburl || !info.descriptionurl) return null;
        const imageUrl = new URL(info.thumburl);
        if (
          imageUrl.protocol !== "https:" ||
          !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(
            imageUrl.hostname,
          )
        )
          return null;
        try {
          const response = await fetchImpl(imageUrl, {
            signal: AbortSignal.timeout(10000),
            redirect: "error",
          });
          if (!response.ok) return null;
          const bytes = Buffer.from(await response.arrayBuffer());
          const mime = response.headers.get("content-type")?.split(";")[0];
          if (
            bytes.length > 350000 ||
            !mime ||
            !["image/jpeg", "image/png", "image/webp"].includes(mime)
          )
            return null;
          const plain = (value: string) =>
            value.replace(/<[^>]*>/g, "").slice(0, 250);
          const attribution = [
            info.extmetadata?.Artist?.value,
            info.extmetadata?.LicenseShortName?.value,
          ]
            .filter(Boolean)
            .map((v) => plain(v!))
            .join(" · ");
          return {
            id: String(page.pageid),
            title: page.title.replace(/^File:/, ""),
            url: info.descriptionurl,
            dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
            attribution: attribution || "Wikimedia Commons（詳見來源頁）",
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((value): value is SimilarImage => value !== null);
}
