// Diagnostic: print the R2 bucket's current CORS configuration.
// Usage: node scripts/check-r2-cors.mjs
import { S3Client, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

// Minimal .env.local loader (no dotenv dependency)
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

try {
  const res = await client.send(new GetBucketCorsCommand({ Bucket: process.env.R2_BUCKET }));
  console.log('CORS rules:', JSON.stringify(res.CORSRules, null, 2));
} catch (err) {
  console.log('GetBucketCors failed:', err.name, '-', err.message);
}
