import Constants from 'expo-constants';
import { supabase } from './supabase';

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Upload an avatar from a local URI to Supabase Storage, reporting real
 * progress via XHR so the caller can drive a progress ring.
 *
 * Returns the public URL of the uploaded file.
 */
export async function uploadAvatar(
  uri: string,
  userId: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();

  if (!ALLOWED_MIME.includes(blob.type)) {
    throw new Error('Only JPEG and PNG images are allowed');
  }
  if (blob.size > MAX_BYTES) {
    throw new Error('Image must be under 5 MB');
  }

  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}.${ext}`;
  const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
  const session = (await supabase.auth.getSession()).data.session;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/avatars/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.send(blob);
  });

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload any validated image blob to a given bucket/path.
 * Validates MIME type and file size before uploading.
 * Returns the public URL.
 */
export async function uploadImage(
  bucket: string,
  path: string,
  uri: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();

  if (!ALLOWED_MIME.includes(blob.type)) {
    throw new Error('Only JPEG and PNG images are allowed');
  }
  if (blob.size > MAX_BYTES) {
    throw new Error('Image must be under 5 MB');
  }

  const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
  const session = (await supabase.auth.getSession()).data.session;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.send(blob);
  });

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
