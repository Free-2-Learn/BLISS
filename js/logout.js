import { auth } from "../firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// 🔐 Logout handler
document.getElementById("logout-button")?.addEventListener("click", async (event) => {
    event.preventDefault();

    try {
        await signOut(auth);
        console.log("✅ Logged out successfully.");
    } catch (error) {
        console.error("❌ Logout Error:", error.message);
    }

    // Optional: Clear session/local storage (if you use it)
    sessionStorage.clear();
    localStorage.clear();

    // Redirect to login
    window.location.href = "../index.html";
});

// Clean up real-time listener on logout
window.addEventListener('beforeunload', () => {
    if (window.reportsUnsubscribe) {
        window.reportsUnsubscribe();
    }
});