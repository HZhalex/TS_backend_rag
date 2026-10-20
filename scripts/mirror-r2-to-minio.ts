import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const R2_ENDPOINT = process.env.R2_ENDPOINT_URL;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.MINIO_BUCKET_NAME || 'uth-scientific-lakehouse';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'admin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'password123';

if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('Missing Cloudflare R2 credentials in .env');
  process.exit(1);
}

const r2Client = new S3Client({
  endpoint: R2_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

const minioClient = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

const CONCURRENCY = 25;

async function ensureMinioBucket(): Promise<void> {
  console.log(`Checking bucket "${BUCKET_NAME}" on MinIO...`);
  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`Bucket "${BUCKET_NAME}" is ready.`);
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      console.log(`Bucket "${BUCKET_NAME}" does not exist. Creating...`);
      await minioClient.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`Bucket "${BUCKET_NAME}" created.`);
    } else {
      throw error;
    }
  }
}

async function getMinioExistingKeys(): Promise<Map<string, number>> {
  console.log('Scanning existing files in MinIO to enable fast resume/skip...');
  const existing = new Map<string, number>();
  let continuationToken: string | undefined = undefined;

  do {
    const res = await minioClient.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents || []) {
      if (obj.Key && obj.Size !== undefined) {
        existing.set(obj.Key, obj.Size);
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${existing.size} files already present in MinIO.`);
  return existing;
}

interface FileItem {
  key: string;
  size: number;
}

async function getAllR2Files(): Promise<FileItem[]> {
  console.log('Listing all files in Cloudflare R2 bucket...');
  const files: FileItem[] = [];
  let continuationToken: string | undefined = undefined;

  do {
    const res = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents || []) {
      if (obj.Key && obj.Size !== undefined) {
        files.push({ key: obj.Key, size: obj.Size });
      }
    }
    continuationToken = res.NextContinuationToken;
    process.stdout.write(`\rDiscovered ${files.length} files on R2...`);
  } while (continuationToken);

  console.log(`\nTotal files on R2: ${files.length}`);
  return files;
}

async function syncFileWithRetry(
  item: FileItem,
  retries = 3,
): Promise<{ success: boolean; transferredBytes: number }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const getRes = await r2Client.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: item.key,
        }),
      );

      if (!getRes.Body) {
        throw new Error('Empty body from R2');
      }

      const upload = new Upload({
        client: minioClient,
        params: {
          Bucket: BUCKET_NAME,
          Key: item.key,
          Body: getRes.Body as Readable,
          ContentType: getRes.ContentType || 'application/octet-stream',
          ContentLength: item.size,
        },
      });

      await upload.done();
      return { success: true, transferredBytes: item.size };
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`\nFailed to sync ${item.key} after ${retries} attempts: ${err.message}`);
        return { success: false, transferredBytes: 0 };
      }
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  return { success: false, transferredBytes: 0 };
}

async function main() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('   FULL LAKEHOUSE MIRROR: Cloudflare R2 -> MinIO    ');
  console.log('====================================================');
  console.log(`R2 Endpoint:    ${R2_ENDPOINT}`);
  console.log(`MinIO Endpoint: ${MINIO_ENDPOINT}`);
  console.log(`Bucket Name:    ${BUCKET_NAME}`);
  console.log(`Concurrency:    ${CONCURRENCY} parallel streams\n`);

  await ensureMinioBucket();
  const minioKeys = await getMinioExistingKeys();
  const allR2Files = await getAllR2Files();

  const toSync = allR2Files.filter((f) => {
    const existingSize = minioKeys.get(f.key);
    return existingSize === undefined || existingSize !== f.size;
  });

  const totalBytesToSync = toSync.reduce((acc, f) => acc + f.size, 0);
  console.log(`\nFiles to sync:   ${toSync.length} / ${allR2Files.length}`);
  console.log(`Total volume:    ${(totalBytesToSync / (1024 * 1024)).toFixed(2)} MB (${(totalBytesToSync / (1024 * 1024 * 1024)).toFixed(2)} GB)\n`);

  if (toSync.length === 0) {
    console.log('MinIO is already 100% up to date with Cloudflare R2!');
    return;
  }

  let completedCount = 0;
  let transferredBytes = 0;
  let failedCount = 0;

  let index = 0;
  async function worker() {
    while (index < toSync.length) {
      const currentIndex = index++;
      const item = toSync[currentIndex];
      const result = await syncFileWithRetry(item);

      if (result.success) {
        completedCount++;
        transferredBytes += result.transferredBytes;
      } else {
        failedCount++;
      }

      if (completedCount % 50 === 0 || completedCount === toSync.length) {
        const percent = ((completedCount / toSync.length) * 100).toFixed(1);
        const mbTransferred = (transferredBytes / (1024 * 1024)).toFixed(1);
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);
        const speedMbPerSec = (
          transferredBytes /
          (1024 * 1024) /
          Math.max(1, (Date.now() - startTime) / 1000)
        ).toFixed(2);

        process.stdout.write(
          `\r[Progress: ${percent}%] ${completedCount}/${toSync.length} files | ${mbTransferred} MB | ${speedMbPerSec} MB/s | ${elapsedSec}s elapsed`,
        );
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n====================================================');
  console.log('                 SYNC FINISHED                      ');
  console.log('====================================================');
  console.log(`Total time:      ${durationSec}s`);
  console.log(`Synced files:    ${completedCount}`);
  console.log(`Failed files:    ${failedCount}`);
  console.log(`Total volume:    ${(transferredBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log('MinIO is now an exact replica of Cloudflare R2!');
}

main().catch((err) => {
  console.error('Fatal error in mirror script:', err);
  process.exit(1);
});
