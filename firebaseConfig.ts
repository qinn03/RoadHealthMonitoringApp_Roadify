import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from "firebase/app";
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// https://firebase.google.com/docs/web/setup#available-libraries

const firebaseConfig = {
  apiKey: "AIzaSyAlAPsIXIEanJCTqRae19UuIVN9iPeGbk4",
  authDomain: "aiot-road-app.firebaseapp.com",
  projectId: "aiot-road-app",
  storageBucket: "aiot-road-app.firebasestorage.app",
  messagingSenderId: "805902624375",
  appId: "1:805902624375:web:6dd6a71c64b4bc83910872",
  measurementId: "G-KPDGYKK8JR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

export { auth };
