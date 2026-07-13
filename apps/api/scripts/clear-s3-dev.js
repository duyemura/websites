require("dotenv").config();

const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

const bucket = process.env.S3_ASSETS_BUCKET;

async function deletePrefix(prefix) {
  let deletedCount = 0;
  let listedCount = 0;
  let continuationToken;
  const start = Date.now();

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    const keys = (list.Contents ?? [])
      .map((item) => item.Key)
      .filter((key) => Boolean(key));

    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deletedCount += keys.length;
    }

    listedCount += keys.length;
    continuationToken = list.NextContinuationToken;

    const elapsedMin = ((Date.now() - start) / 1000 / 60).toFixed(1);
    process.stdout.write(
      `\r${prefix} listed ${listedCount.toLocaleString()}, deleted ${deletedCount.toLocaleString()} in ${elapsedMin}m`,
    );
  } while (continuationToken);

  console.log(`\n${prefix} done. Total deleted: ${deletedCount}`);
}

async function main() {
  if (!bucket) {
    console.error("S3_ASSETS_BUCKET is not set");
    process.exit(1);
  }
  console.log(`Clearing bucket: ${bucket}`);
  await deletePrefix("sites/");
  await deletePrefix("workspaces/");
  console.log("Finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
