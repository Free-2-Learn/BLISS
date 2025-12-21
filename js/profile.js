import { db, auth } from "../firebase-config.js";
import {
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    signOut
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import {
    doc,
    getDoc,
    updateDoc,
    serverTimestamp,
    setDoc,
    arrayUnion,
    Timestamp,
    addDoc,
    collection
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// Global variable to store user data
let currentUserData = null;

// ========== LOGGING FUNCTIONS ==========

// Log activity to activityLogs collection
async function logActivity(action, details = {}) {
    if (!auth.currentUser || !currentUserData) return;

    const userId = auth.currentUser.email.toLowerCase();
    const fullName = currentUserData?.fullName || auth.currentUser.email;

    try {
        const logRef = doc(db, 'activityLogs', userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: 'resident',
            activities: arrayUnion({
                action: action,
                module: 'profile',
                details: details,
                timestamp: Timestamp.now()
            })
        }, { merge: true });
        
        console.log(`✅ Activity logged: ${action}`);
    } catch (error) {
        console.error("Error logging activity:", error);
    }
}

// Log to document history
async function logDocumentHistory(action, details = {}) {
    if (!auth.currentUser || !currentUserData) return;

    try {
        const historyData = {
            action: action,
            module: 'profile',
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email,
            userName: currentUserData?.fullName || auth.currentUser.email,
            userRole: 'resident',
            timestamp: Timestamp.now(),
            details: details
        };

        const historyRef = collection(db, 'documentHistory', auth.currentUser.email.toLowerCase(), 'logs');
        await addDoc(historyRef, historyData);
        
        console.log(`✅ Document history logged: ${action}`);
    } catch (error) {
        console.error('Error logging document history:', error);
    }
}

// ========== AUTHENTICATION ==========

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadUserProfile();
    } else {
        window.location.replace("../index.html");
    }
});

// ========== LOAD USER PROFILE ==========

async function loadUserProfile() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const userDocRef = doc(db, "residents", user.email.toLowerCase());
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            console.error("User document not found");
            return;
        }

        const userData = userDoc.data();
        currentUserData = userData;

        // Update header
        document.getElementById("user-name").textContent = `${userData.firstName} ${userData.lastName}`;
        document.getElementById("profile-full-name").textContent = `${userData.firstName} ${userData.middleName || ''} ${userData.lastName}`;
        document.getElementById("profile-email").textContent = userData.email;

        // ✅ FIXED: Display full address correctly
        // The address field should already contain the complete address from the database
        const fullAddress = userData.address || 'Barangay Lipay, Villasis, Pangasinan';
        
        // Display information
        document.getElementById("resident-first-name").textContent = userData.firstName || "-";
        document.getElementById("resident-middle-name").textContent = userData.middleName || "-";
        document.getElementById("resident-last-name").textContent = userData.lastName || "-";
        document.getElementById("resident-email").textContent = userData.email || "-";
        document.getElementById("resident-contact-number").textContent = userData.contactNumber || "-";
        document.getElementById("resident-gender").textContent = userData.gender || "-";
        document.getElementById("resident-address").textContent = fullAddress; // ✅ Show complete address
        document.getElementById("resident-occupation").textContent = userData.occupation || "-";
        document.getElementById("resident-education").textContent = userData.education || "-";
        document.getElementById("resident-special-categories").textContent = userData.specialCategories || "None";

        // Fill edit form with current values
        fillEditForm(userData);

        // Check if password change is required
        const hasChangedOnce = userData.hasChangedPasswordOnce;
        const shouldForceChange = !hasChangedOnce;

        if (shouldForceChange) {
            openPasswordModal();
        }
    } catch (error) {
        console.error("Error loading user profile:", error);
        alert("Failed to load profile data");
    }
}

// Fill edit form with current data
function fillEditForm(userData) {
    document.getElementById("edit-first-name").value = userData.firstName || "";
    document.getElementById("edit-middle-name").value = userData.middleName || "";
    document.getElementById("edit-last-name").value = userData.lastName || "";
    document.getElementById("edit-contact-number").value = userData.contactNumber || "";
    document.getElementById("edit-gender").value = userData.gender || "";
    
    // ✅ FIXED: Extract house/purok number from complete address
    const baseAddress = "Barangay Lipay, Villasis, Pangasinan";
    let houseNumber = "";
    
    if (userData.address && userData.address !== baseAddress) {
        // Extract house number (everything before the base address)
        houseNumber = userData.address.replace(`, ${baseAddress}`, '').trim();
    }
    
    // Set only the house/purok number in the edit field
    document.getElementById("edit-address").value = houseNumber;
    
    document.getElementById("edit-occupation").value = userData.occupation || "";
    document.getElementById("edit-education").value = userData.education || "";
    document.getElementById("edit-special-categories").value = userData.specialCategories || "None";
}

// ========== MODAL CONTROLS ==========

// Edit Profile Modal
document.getElementById("edit-profile-btn").addEventListener("click", () => {
    // Reset form with current data when opening
    if (currentUserData) {
        fillEditForm(currentUserData);
    }
    document.getElementById("edit-profile-modal").classList.add("show");
});

document.getElementById("close-edit-modal").addEventListener("click", closeEditModal);
document.getElementById("cancel-edit-btn").addEventListener("click", closeEditModal);

function closeEditModal() {
    document.getElementById("edit-profile-modal").classList.remove("show");
    // Reset form to original values when closing
    if (currentUserData) {
        fillEditForm(currentUserData);
    }
}

// Change Password Modal
document.getElementById("change-password-btn").addEventListener("click", () => {
    // Check if 24 hours have passed since last change
    if (currentUserData && currentUserData.lastPasswordChange) {
        const lastChange = currentUserData.lastPasswordChange.toDate();
        const hoursSinceChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceChange < 24) {
            const hoursLeft = Math.ceil(24 - hoursSinceChange);
            alert(`⏳ You can change your password again in ${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}. Password changes are limited to once every 24 hours for security.`);
            return;
        }
    }
    
    openPasswordModal();
});

document.getElementById("close-change-password-modal").addEventListener("click", closePasswordModal);
document.getElementById("cancel-password-btn").addEventListener("click", closePasswordModal);

function openPasswordModal() {
    document.getElementById("change-password-modal").classList.add("show");
}

function closePasswordModal() {
    document.getElementById("change-password-modal").classList.remove("show");
    document.getElementById("change-password-form").reset();
}

// Close modals on outside click
window.addEventListener("click", function (event) {
    if (event.target.classList.contains("modal")) {
        event.target.classList.remove("show");
        // Reset forms when closing
        if (event.target.id === "edit-profile-modal" && currentUserData) {
            fillEditForm(currentUserData);
        } else if (event.target.id === "change-password-modal") {
            document.getElementById("change-password-form").reset();
        }
    }
});

// ========== EDIT PROFILE FORM ==========

document.getElementById("edit-profile-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const nameRegex = /^[A-Za-z\s]+$/;
    const phoneRegex = /^\+63\d{10}$/;

    const firstName = document.getElementById("edit-first-name").value.trim();
    const middleName = document.getElementById("edit-middle-name").value.trim();
    const lastName = document.getElementById("edit-last-name").value.trim();
    const rawContact = document.getElementById("edit-contact-number").value.replace(/\s+/g, '');
    const gender = document.getElementById("edit-gender").value;
    const houseNumber = document.getElementById("edit-address").value.trim(); // ✅ This is house/purok only
    const occupation = document.getElementById("edit-occupation").value.trim();
    const education = document.getElementById("edit-education").value;
    const specialCategories = document.getElementById("edit-special-categories").value;

    // Validation
    if (!nameRegex.test(firstName)) {
        alert("❌ First name must only contain letters and spaces (no special characters).");
        return;
    }
    
    if (!nameRegex.test(middleName)) {
        alert("❌ Middle name must only contain letters and spaces (no special characters).");
        return;
    }
    
    if (!nameRegex.test(lastName)) {
        alert("❌ Last name must only contain letters and spaces (no special characters).");
        return;
    }

    if (!phoneRegex.test(rawContact)) {
        alert("❌ Contact number must be in the format +63 followed by 10 digits.");
        return;
    }

    if (!houseNumber) {
        alert("❌ Please enter your house number or purok.");
        return;
    }

    const user = auth.currentUser;
    if (!user) return;

    try {
        const fullName = `${firstName} ${middleName} ${lastName}`.trim();
        
        // ✅ FIXED: Build complete address with house/purok + base address
        const baseAddress = "Barangay Lipay, Villasis, Pangasinan";
        const completeAddress = `${houseNumber}, ${baseAddress}`;
        
        // Store old data for comparison
        const oldData = { ...currentUserData };
        
        await updateDoc(doc(db, "residents", user.email.toLowerCase()), {
            firstName,
            middleName,
            lastName,
            contactNumber: rawContact,
            gender,
            address: completeAddress, // ✅ Save complete address
            occupation,
            education,
            specialCategories,
            fullName: fullName
        });

        // Log activity
        await logActivity('profile_updated', {
            changes: {
                name: fullName,
                contact: rawContact,
                address: completeAddress,
                occupation: occupation
            }
        });
        
        // Log document history
        await logDocumentHistory('profile_updated', {
            oldData: {
                name: oldData.fullName,
                contact: oldData.contactNumber,
                address: oldData.address
            },
            newData: {
                name: fullName,
                contact: rawContact,
                address: completeAddress
            }
        });

        alert("✅ Profile updated successfully!");
        await loadUserProfile();
        closeEditModal();
    } catch (error) {
        console.error("Error updating profile:", error);
        alert("❌ Failed to update profile: " + error.message);
    }
});

// ========== CHANGE PASSWORD FORM ==========

document.getElementById("change-password-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (newPassword !== confirmPassword) {
        alert("❌ New passwords do not match.");
        return;
    }

    if (newPassword.length < 6) {
        alert("❌ Password must be at least 6 characters long.");
        return;
    }

    const user = auth.currentUser;
    if (!user) return;

    // Check 24-hour limit again before proceeding
    if (currentUserData && currentUserData.lastPasswordChange) {
        const lastChange = currentUserData.lastPasswordChange.toDate();
        const hoursSinceChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceChange < 24) {
            const hoursLeft = Math.ceil(24 - hoursSinceChange);
            alert(`⏳ You can change your password again in ${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}. Password changes are limited to once every 24 hours for security.`);
            return;
        }
    }

    try {
        // Re-authenticate user
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        // Update password
        await updatePassword(user, newPassword);

        // Update Firestore
        await updateDoc(doc(db, "residents", user.email.toLowerCase()), {
            lastPasswordChange: serverTimestamp(),
            hasChangedPasswordOnce: true
        });

        // Log activity
        await logActivity('password_changed', {
            message: 'User changed their password'
        });
        
        // Log document history
        await logDocumentHistory('password_changed', {
            message: 'Password successfully updated'
        });

        alert("✅ Password changed successfully! You can change it again after 24 hours.");
        closePasswordModal();
        
        // Reload user data to update the lastPasswordChange timestamp
        await loadUserProfile();
    } catch (error) {
        console.error("Password change error:", error);
        if (error.code === "auth/wrong-password") {
            alert("❌ Current password is incorrect.");
        } else if (error.code === "auth/invalid-credential") {
            alert("❌ Current password is incorrect.");
        } else {
            alert("❌ Error: " + error.message);
        }
    }
});

// ========== INPUT VALIDATION ==========

// Auto-format contact number
const contactInput = document.getElementById("edit-contact-number");

contactInput.addEventListener("input", function () {
    let digits = this.value.replace(/\D/g, "");

    if (digits === "") {
        this.value = "";
        return;
    }

    if (!digits.startsWith("63")) {
        digits = "63" + digits.replace(/^6*/, "");
    }

    digits = digits.slice(0, 12);
    const formatted = `+${digits.slice(0, 2)} ${digits.slice(2)}`;
    this.value = formatted;
});

contactInput.addEventListener("keydown", function (e) {
    if (["e", "E", "+", "-"].includes(e.key)) {
        e.preventDefault();
    }
});

// Prevent numbers and special characters in name fields
document.querySelectorAll("#edit-first-name, #edit-middle-name, #edit-last-name").forEach(input => {
    input.addEventListener("input", function () {
        // Remove numbers and special characters, keep only letters and spaces
        this.value = this.value.replace(/[^A-Za-z\s]/g, "");
    });
});

// Prevent numbers in occupation field
document.getElementById("edit-occupation").addEventListener("input", function () {
    this.value = this.value.replace(/[0-9]/g, "");
});

// ========== LOGOUT ==========

document.getElementById("logout-button").addEventListener("click", async (e) => {
    e.preventDefault();
    if (confirm("Are you sure you want to logout?")) {
        try {
            await signOut(auth);
            window.location.href = "../index.html";
        } catch (error) {
            console.error("Logout error:", error);
            alert("Failed to logout");
        }
    }
});

// ========== SMOOTH SCROLL FOR NAVIGATION ==========

document.querySelectorAll('.nav-item[href^="#"]').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);
        
        if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth' });
            
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            this.classList.add('active');
        }
    });
});
