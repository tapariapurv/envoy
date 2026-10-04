"use client";
import { getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Firebase web config is public by design; access is enforced by firestore.rules.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps()[0] ?? initializeApp(config);
export const auth = getAuth(app);
// Offline cache: pages load instantly from IndexedDB and writes made while closing the tab sync on the next visit.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
