import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'admin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'password123';
const BUCKET_NAME = process.env.MINIO_BUCKET_NAME || 'uth-scientific-lakehouse';

const LOCAL_MINING_DIR = path.resolve(process.cwd(), '../data/gold/mining');

const s3Client = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: MINIO_REGION,
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

async function ensureBucketExists(): Promise<void> {
  console.log(`Checking bucket "${BUCKET_NAME}" on MinIO (${MINIO_ENDPOINT})...`);
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`Bucket "${BUCKET_NAME}" already exists.`);
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      console.log(`Bucket "${BUCKET_NAME}" does not exist. Creating...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`Bucket "${BUCKET_NAME}" created successfully.`);
    } else {
      throw error;
    }
  }
}

async function uploadMiningArtifacts(): Promise<void> {
  if (!fs.existsSync(LOCAL_MINING_DIR)) {
    console.warn(`Local directory not found: ${LOCAL_MINING_DIR}`);
    return;
  }

  const files = fs.readdirSync(LOCAL_MINING_DIR).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} mining artifacts to upload.`);

  for (const file of files) {
    const filePath = path.join(LOCAL_MINING_DIR, file);
    const fileContent = fs.readFileSync(filePath);
    const s3Key = `gold/mining/${file}`;

    console.log(`Uploading ${file} -> s3://${BUCKET_NAME}/${s3Key} (${(fileContent.length / 1024).toFixed(1)} KB)...`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'application/json',
      }),
    );
  }
}

async function verifyBucketContents(): Promise<void> {
  console.log(`Listing objects in s3://${BUCKET_NAME}/...`);
  const response = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'gold/mining/',
    }),
  );

  const objects = response.Contents || [];
  console.log(`Found ${objects.length} objects in s3://${BUCKET_NAME}/gold/mining/:`);
  for (const obj of objects) {
    console.log(`  - ${obj.Key} (${obj.Size} bytes, modified: ${obj.LastModified})`);
  }
}

async function main() {
  try {
    await ensureBucketExists();
    await uploadMiningArtifacts();
    await verifyBucketContents();
    console.log('MinIO synchronization completed successfully!');
  } catch (error) {
    console.error('MinIO sync error:', error);
    process.exit(1);
  }
}

main();
