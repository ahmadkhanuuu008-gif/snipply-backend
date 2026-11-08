const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'snipply-videos';

async function getPresignedUploadUrl(fileKey, contentType) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(fileKey);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function getPresignedDownloadUrl(fileKey) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileKey, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function uploadFile(fileKey, fileBuffer, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileKey, fileBuffer, {
      contentType,
      upsert: true
    });
  if (error) throw new Error(error.message);
  return fileKey;
}

async function deleteFile(fileKey) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([fileKey]);
  if (error) throw new Error(error.message);
}

module.exports = {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  uploadFile,
  deleteFile
};