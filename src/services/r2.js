const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET_NAME;

// Get presigned URL for uploading
async function getPresignedUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 });
}

// Get presigned URL for downloading
async function getPresignedDownloadUrl(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 });
}

// Delete file from R2
async function deleteFile(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key
  });
  return r2.send(command);
}

module.exports = { getPresignedUploadUrl, getPresignedDownloadUrl, deleteFile };