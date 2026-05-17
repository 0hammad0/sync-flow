// Apply a CORS policy to the SyncFlow R2 bucket so browsers can fetch
// signed-URL objects (the encrypted-download path issues a `fetch()` to R2).
//
// Run: node --env-file=.env.local scripts/set-r2-cors.mjs

import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const {
  R2_ACCOUNT_ID,
  R2_ENDPOINT,
  R2_BUCKET,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  NEXT_PUBLIC_APP_URL,
} = process.env;

if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing R2_* env vars.');
  process.exit(1);
}

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
];
if (NEXT_PUBLIC_APP_URL) allowedOrigins.push(NEXT_PUBLIC_APP_URL.replace(/\/$/, ''));

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const corsRules = [
  {
    AllowedOrigins: allowedOrigins,
    AllowedMethods: ['GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Content-Disposition'],
    MaxAgeSeconds: 3600,
  },
];

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET,
      CORSConfiguration: { CORSRules: corsRules },
    })
  );
  console.log(`✓ CORS applied to bucket "${R2_BUCKET}"`);
  console.log('  Allowed origins:', allowedOrigins.join(', '));
  console.log('  Methods: GET, HEAD');
  console.log('  (Account ID: ' + R2_ACCOUNT_ID + ')');
} catch (err) {
  const status = err?.$metadata?.httpStatusCode;
  console.error(`✗ Failed (${status}): ${err?.message || err}`);
  if (status === 403) {
    console.error('\n  Token lacks bucket-admin permissions.');
    console.error('  Set CORS in the Cloudflare dashboard instead:');
    console.error('  https://dash.cloudflare.com/' + R2_ACCOUNT_ID + '/r2/default/buckets/' + R2_BUCKET);
    console.error('  → Settings → CORS Policy → paste:\n');
    console.error(JSON.stringify(corsRules, null, 2));
  }
  process.exit(1);
}
