import { getStorage, ref, uploadBytes, getDownloadURL }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';

// Upload an image to a Storage folder and return its public download URL.
// Defaults to the research-images/ folder (whitelisted-write path).
export async function uploadImage(file, folder = 'research-images') {
  const storage = getStorage(getApp());
  const ext  = file.name.split('.').pop().toLowerCase() || 'png';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const r    = ref(storage, `${folder}/${name}`);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

export async function uploadResearchImage(file) {
  return uploadImage(file, 'research-images');
}
