const cache = new Map<string, { lng: number; lat: number }>();

/** Nominatim usage policy: max 1 req/sec, identify the app. Only used for the
 * small, fixed set of place names we need centroids for — never per-transaction. */
export async function geocodePlace(query: string): Promise<{ lng: number; lat: number }> {
  if (cache.has(query)) return cache.get(query)!;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'terra-dev/0.1 (property data app)' } });
  const json = await res.json();
  if (!json[0]) throw new Error(`Nominatim found no result for "${query}"`);

  const coords = { lng: Number(json[0].lon), lat: Number(json[0].lat) };
  cache.set(query, coords);
  await new Promise((r) => setTimeout(r, 1100)); // respect 1 req/sec
  return coords;
}
