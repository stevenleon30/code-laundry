import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: "__SECRET_AWS_KEY_ID__",
    secretAccessKey: "__SECRET_AWS_SECRET__",
  },
});
