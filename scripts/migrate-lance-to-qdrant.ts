import * as lancedb from '@lancedb/lancedb';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';
import * as path from 'path';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'scientific_papers_gold';
const BATCH_SIZE = 1000;

function chunkIdToUuid(chunkId: string): string {
  const hash = crypto.createHash('md5').update(chunkId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('   MIGRATION: LanceDB -> Qdrant Vector Database    ');
  console.log('====================================================');
  console.log(`Qdrant URL:      ${QDRANT_URL}`);
  console.log(`Collection:      ${COLLECTION_NAME}`);
  console.log(`Batch Size:      ${BATCH_SIZE}\n`);

  const qdrant = new QdrantClient({ url: QDRANT_URL });

  // 1. Ensure collection exists with 768-D Cosine
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);

  if (!exists) {
    console.log(`Creating collection "${COLLECTION_NAME}"...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 768,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
      },
    });
  }

  // Ensure payload indexes for filtering
  try {
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'primary_category',
      field_schema: 'keyword',
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'paper_id',
      field_schema: 'keyword',
    });
  } catch {
    // Indexes may already exist
  }

  // 2. Connect to local LanceDB table
  const lancedbPath = path.resolve(process.cwd(), '../data/gold/lancedb');
  console.log(`Connecting to LanceDB at: ${lancedbPath}`);
  const db = await lancedb.connect(lancedbPath);
  const table = await db.openTable('scientific_papers_gold');
  const totalRows = await table.countRows();
  console.log(`Total rows in LanceDB to migrate: ${totalRows.toLocaleString()}`);

  // 3. Stream and upsert in batches
  const queryStream = await (table.query() as any).execute();
  let migratedCount = 0;
  let batchBuffer: any[] = [];

  for await (const batch of queryStream) {
    const rows = batch.toArray();

    for (const row of rows) {
      const pointId = chunkIdToUuid(row.chunk_id);
      const authors = Array.isArray(row.authors)
        ? row.authors
        : Array.from(row.authors || []);

      batchBuffer.push({
        id: pointId,
        vector: Array.from(row.vector),
        payload: {
          chunk_id: String(row.chunk_id),
          paper_id: String(row.paper_id),
          title: String(row.title || ''),
          authors: authors.map((a: any) => String(a)),
          primary_category: String(row.primary_category || ''),
          section_title: String(row.section_title || ''),
          section_type: String(row.section_type || ''),
          text: String(row.text || ''),
          context_text: String(row.context_text || ''),
          word_count: Number(row.word_count || 0),
        },
      });

      if (batchBuffer.length >= BATCH_SIZE) {
        await qdrant.upsert(COLLECTION_NAME, {
          wait: false,
          points: batchBuffer,
        });

        migratedCount += batchBuffer.length;
        batchBuffer = [];

        const percent = ((migratedCount / totalRows) * 100).toFixed(1);
        const elapsedSec = Math.max(1, (Date.now() - startTime) / 1000);
        const rate = (migratedCount / elapsedSec).toFixed(0);

        process.stdout.write(
          `\r[Progress: ${percent}%] ${migratedCount.toLocaleString()} / ${totalRows.toLocaleString()} points | ${rate} pts/s | ${elapsedSec.toFixed(0)}s elapsed`,
        );
      }
    }
  }

  // Flush remaining points
  if (batchBuffer.length > 0) {
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: batchBuffer,
    });
    migratedCount += batchBuffer.length;
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n====================================================');
  console.log('            MIGRATION TO QDRANT FINISHED            ');
  console.log('====================================================');
  console.log(`Total time:         ${durationSec}s`);
  console.log(`Migrated points:    ${migratedCount.toLocaleString()}`);

  const info = await qdrant.getCollection(COLLECTION_NAME);
  console.log(`Qdrant confirmed:   ${info.points_count?.toLocaleString()} points in collection.`);
  console.log('Qdrant Vector Database is now fully populated and ready for ultra-fast queries!');
}

main().catch((err) => {
  console.error('\nFatal migration error:', err);
  process.exit(1);
});
