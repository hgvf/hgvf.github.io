import { getStorage, ref, uploadBytes, getDownloadURL }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';

export async function uploadResearchImage(file) {
  const storage = getStorage(getApp());
  const ext  = file.name.split('.').pop().toLowerCase() || 'png';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const r    = ref(storage, `research-images/${name}`);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}
