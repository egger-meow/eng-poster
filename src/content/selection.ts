export function selectWeighted<T extends string>(
  weights: Record<T, number>,
  history: T[] = [],
  currentRunChoices: T[] = []
): T {
  const keys = Object.keys(weights) as T[];
  if (keys.length === 0) {
    throw new Error('Weighted selection requires at least one key');
  }
  if (keys.length === 1) {
    return keys[0]!;
  }

  const totalWeight = keys.reduce((sum, k) => sum + (weights[k] ?? 0), 0);
  if (totalWeight <= 0) {
    return keys[0]!;
  }

  const combinedHistory = [...history, ...currentRunChoices];
  const totalItems = combinedHistory.length + 1;

  const actualCounts: Record<string, number> = {};
  for (const k of keys) {
    actualCounts[k] = 0;
  }
  for (const item of combinedHistory) {
    if (actualCounts[item] !== undefined) {
      actualCounts[item]++;
    }
  }

  let bestKey = keys[0]!;
  let maxDeficit = -Infinity;

  for (const k of keys) {
    const normalizedWeight = (weights[k] ?? 0) / totalWeight;
    const targetCount = totalItems * normalizedWeight;
    const actualCount = actualCounts[k] ?? 0;
    const deficit = targetCount - actualCount;

    if (deficit > maxDeficit) {
      maxDeficit = deficit;
      bestKey = k;
    } else if (Math.abs(deficit - maxDeficit) < 1e-9) {
      // Tie-breaker 1: higher configured weight
      const bestWeight = weights[bestKey] ?? 0;
      const currentWeight = weights[k] ?? 0;
      if (currentWeight > bestWeight) {
        bestKey = k;
      }
      // Tie-breaker 2: stable defined object key order (preserved by remaining bestKey)
    }
  }

  return bestKey;
}

const archetypeMapping: Record<string, string> = {
  painPointOrOpinion: 'pain_point',
  educationalValue: 'educational_value',
  productProof: 'product_proof',
  timelyTopic: 'timely_topic',
  conversion: 'conversion_offer',
};

const reverseArchetypeMapping: Record<string, string> = {
  pain_point: 'painPointOrOpinion',
  educational_value: 'educationalValue',
  product_proof: 'productProof',
  timely_topic: 'timelyTopic',
  conversion_offer: 'conversion',
};

export function selectArchetype(
  mix: Record<string, number>,
  history: string[] = [],
  currentRunChoices: string[] = []
): string {
  const normalizedHistory = history.map((h) => reverseArchetypeMapping[h] ?? h);
  const normalizedCurrent = currentRunChoices.map((c) => reverseArchetypeMapping[c] ?? c);

  const selectedConfigKey = selectWeighted(mix, normalizedHistory, normalizedCurrent);
  return archetypeMapping[selectedConfigKey] ?? selectedConfigKey;
}

export function selectCtaMode(
  ctaMix: Record<string, number>,
  history: Array<'none' | 'soft' | 'direct'> = [],
  currentRunChoices: Array<'none' | 'soft' | 'direct'> = []
): 'none' | 'soft' | 'direct' {
  return selectWeighted(
    ctaMix as Record<'none' | 'soft' | 'direct', number>,
    history,
    currentRunChoices
  );
}
