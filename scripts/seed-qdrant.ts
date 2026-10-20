/**
 * Seeds a small TEST collection (200 random 768-D chunks, payload as in API_DESIGN §7).
 * Refuses any collection whose name does not end in `_test`: the real collection
 * `scientific_papers_gold` belongs to the UTH pipeline and is never written by RAG_TS.
 *
 *   QDRANT_URL=http://localhost:6333 QDRANT_COLLECTION=rag_ts_test npx ts-node scripts/seed-qdrant.ts
 */
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'crypto';

export const DIM = 768;
export const SEED_CHUNKS = 200;
export const SEED_PAPERS = 40;

export function assertTestCollection(name: string): void {
  if (!/_test$/.test(name)) {
    throw new Error(
      `refusing to seed "${name}": only collections ending in "_test" may be written`,
    );
  }
}

/** Deterministic PRNG so every run seeds the same data. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function unitVector(rand: () => number): number[] {
  const v = Array.from({ length: DIM }, () => rand() * 2 - 1);
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

const CATEGORIES = ['cs.LG', 'cs.CL', 'cs.CV', 'cs.AI', 'stat.ML'];
const SECTIONS: Array<[string, string]> = [
  ['Abstract', 'abstract'],
  ['Introduction', 'introduction'],
  ['Method', 'method'],
  ['Experiments', 'experiments'],
  ['Conclusion', 'conclusion'],
];

export interface SeedPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export function seedPoints(seed = 7): SeedPoint[] {
  const rand = mulberry32(seed);
  return Array.from({ length: SEED_CHUNKS }, (_, i) => {
    const p = i % SEED_PAPERS;
    const s = Math.floor(i / SEED_PAPERS) % SECTIONS.length;
    const paperId = `2400.${String(10000 + p)}`;
    return {
      id: randomUUID(),
      vector: unitVector(rand),
      payload: {
        chunk_id: s === 0 ? `${paperId}_abs` : `${paperId}_sec${s}`,
        paper_id: paperId,
        title: `Seed paper ${p}`,
        authors: [`Author ${p % 7}`, `Author ${(p + 3) % 7}`],
        primary_category: CATEGORIES[p % CATEGORIES.length],
        year: 2018 + (p % 8),
        section_title: SECTIONS[s][0],
        section_type: SECTIONS[s][1],
        text: `Seed text ${i} of paper ${p}, section ${SECTIONS[s][0]}.`,
      },
    };
  });
}

export async function seed(
  client: QdrantClient,
  collection: string,
): Promise<number> {
  assertTestCollection(collection);
  const exists = (await client.getCollections()).collections.some(
    (c) => c.name === collection,
  );
  if (exists) await client.deleteCollection(collection);
  await client.createCollection(collection, {
    vectors: { size: DIM, distance: 'Cosine' },
  });
  for (const field of ['paper_id', 'primary_category', 'section_type']) {
    await client.createPayloadIndex(collection, {
      field_name: field,
      field_schema: 'keyword',
    });
  }
  await client.createPayloadIndex(collection, {
    field_name: 'year',
    field_schema: 'integer',
  });
  const points = seedPoints();
  await client.upsert(collection, { wait: true, points });
  return points.length;
}

if (require.main === module) {
  const collection = process.env.QDRANT_COLLECTION ?? '';
  try {
    assertTestCollection(collection);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const client = new QdrantClient({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || undefined,
    checkCompatibility: false,
  });
  seed(client, collection)
    .then((n) => console.log(`seeded ${n} chunks into ${collection}`))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
