// Import Firebase SDK (Fix for Export Errors)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBhjXp0V9fchYZk_YfH-DgXr6EpIsPfBRg",
    authDomain: "barangaymanagementsystem-502d3.firebaseapp.com",
    projectId: "barangaymanagementsystem-502d3",
    storageBucket: "barangaymanagementsystem-502d3.firebasestorage.app",  // ✅ CHANGED THIS
    messagingSenderId: "189415666227",
    appId: "1:189415666227:web:129ee31ed070a16da86946",
    measurementId: "G-Y74X8R2ED6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

// Export Firebase services
export { db, auth, storage, secondaryAuth, secondaryApp };