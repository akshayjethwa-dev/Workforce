// src/lib/firebase.ts
// This file is used on NATIVE (Android/iOS) only
// Expo auto-picks this for native builds

import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';

export { auth, firestore, storage };

// Also export 'db' alias so your existing service files work without changes
export const db = firestore();
