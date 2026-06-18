import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getAllowedEmails } from "./db.js";

let _auth = null;

export function initAuth(app) {
  _auth = getAuth(app);
  return _auth;
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(_auth, provider);
}

export async function signOutUser() {
  return signOut(_auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(_auth, async user => {
    if (!user) {
      callback({ user: null, isAdmin: false });
      return;
    }
    try {
      const allowed = await getAllowedEmails();
      const isAdmin = allowed.includes(user.email);
      callback({ user, isAdmin });
    } catch {
      callback({ user, isAdmin: false });
    }
  });
}

export async function getIdToken() {
  if (!_auth || !_auth.currentUser) return null;
  return _auth.currentUser.getIdToken();
}
