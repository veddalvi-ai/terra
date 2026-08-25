export interface RollupTransaction {
  regionId: string;
  period: string;
  price: number;
}

export interface RegionParents {
  [regionId: string]: string | null;
}

export interface RollupResult {
  regionId: string;
  period: string;
  medianPrice: number;
  transactionCount: number;
}

function median(prices: number[]): number {
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Groups transactions by (region, period), then bubbles any group under
 * MIN_TRANSACTIONS up to its parent region's same-period group and merges —
 * repeating until every reported group clears the threshold or has no parent
 * left to bubble to (context.md §6: "a median from 2 sales is meaningless").
 */
export function rollup(
  transactions: RollupTransaction[],
  parents: RegionParents,
  minTransactions = 10
): RollupResult[] {
  const groups = new Map<string, number[]>();
  const keyOf = (regionId: string, period: string) => `${regionId}::${period}`;

  for (const t of transactions) {
    const key = keyOf(t.regionId, t.period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t.price);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, prices] of Array.from(groups.entries())) {
      if (prices.length >= minTransactions) continue;
      const [regionId, period] = key.split('::');
      const parentId = parents[regionId];
      if (!parentId) continue; // no parent left — report as-is, undersized

      const parentKey = keyOf(parentId, period);
      const parentPrices = groups.get(parentKey) ?? [];
      groups.set(parentKey, [...parentPrices, ...prices]);
      groups.delete(key);
      changed = true;
    }
  }

  return Array.from(groups.entries()).map(([key, prices]) => {
    const [regionId, period] = key.split('::');
    return {
      regionId,
      period,
      medianPrice: median(prices),
      transactionCount: prices.length,
    };
  });
}
