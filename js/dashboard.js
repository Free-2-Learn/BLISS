import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Check authentication and authorization
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.log("❌ No user logged in. Redirecting to login...");
        window.location.href = "../index.html";
        return;
    }

    console.log("✅ User authenticated:", user.email);

    try {
        const userEmail = user.email;
        let userRole = null;
        let isAuthorized = false;

        // Check if user is captain/admin
        const adminRef = doc(db, "config", "admin");
        const adminSnap = await getDoc(adminRef);

        if (adminSnap.exists() && adminSnap.data().email === userEmail) {
            userRole = "captain";
            isAuthorized = true;
            console.log("✅ Captain/Admin access granted");
        }

        // If not captain, check if user is staff
        if (!isAuthorized) {
            const staffRef = doc(db, "staff", userEmail);
            const staffSnap = await getDoc(staffRef);

            if (staffSnap.exists()) {
                const staffData = staffSnap.data();
                
                // Check if staff account is active
                if (staffData.isActive === true) {
                    userRole = "staff";
                    isAuthorized = true;
                    console.log("✅ Staff access granted");
                } else {
                    console.warn("❌ Staff account is inactive");
                    alert("Your account has been disabled. Contact the administrator.");
                    await signOut(auth);
                    window.location.href = "../index.html";
                    return;
                }
            }
        }

        // If not captain or staff, check if resident trying to access (block them)
        if (!isAuthorized) {
            console.warn("❌ Unauthorized access attempt");
            alert("Unauthorized access. This dashboard is for staff and administrators only.");
            await signOut(auth);
            window.location.href = "../index.html";
            return;
        }

        // Store user role in sessionStorage for later use
        sessionStorage.setItem("userRole", userRole);
        sessionStorage.setItem("userEmail", userEmail);

        console.log(`✅ Access granted as ${userRole}`);

    } catch (error) {
        console.error("❌ Error checking authorization:", error);
        alert("Error verifying access. Please try again.");
        await signOut(auth);
        window.location.href = "../index.html";
    }
});

// Logout handler
const logoutButton = document.getElementById("logout-button");
if (logoutButton) {
    logoutButton.addEventListener("click", async (e) => {
        e.preventDefault();
        if (confirm("Are you sure you want to logout?")) {
            await signOut(auth);
            sessionStorage.clear();
            window.location.href = "../index.html";
        }
    });
}