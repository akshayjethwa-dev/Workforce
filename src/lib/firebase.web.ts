import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Prevent duplicate app initialization
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const storage = getStorage(app);

// Safely initialize Firestore with caching
let dbInstance;
try {
  // Try to initialize it with the persistent cache (works on first load)
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache()
  });
} catch (error) {
  // If it throws an error (e.g., during Fast Refresh because it's already initialized),
  // fallback to grabbing the existing instance
  dbInstance = getFirestore(app);
}

// Export the single, safely initialized instance. 
// (Exported as both 'db' and 'firestore' just in case you import it differently across your app)
export const db = dbInstance;
export const firestore = dbInstance;