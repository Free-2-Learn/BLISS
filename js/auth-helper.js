// auth-helper.js - Reusable authentication helper functions
// Place this file in: js/auth-helper.js

import { db } from "../firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

/**
 * Check if user is Captain
 */
export async function isCaptain(user) {
    if (!user) return false;

    try {
        const captainRef = doc(db, "config", "admin");
        const captainSnap = await getDoc(captainRef);
        return captainSnap.exists() && captainSnap.data().email === user.email;
    } catch (error) {
        console.error("Error checking captain status:", error);
        return false;
    }
}

/**
 * Check if user is Staff
 */
export async function isStaff(user) {
    if (!user) return false;

    try {
        const staffRef = doc(db, "staff", user.email);
        const staffSnap = await getDoc(staffRef);
        
        if (staffSnap.exists()) {
            const staffData = staffSnap.data();
            return staffData.isActive === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking staff status:", error);
        return false;
    }
}

/**
 * Check if user is Captain OR Staff (has access to staff pages)
 */
export async function isCaptainOrStaff(user) {
    if (!user) return { hasAccess: false, role: null };

    const userIsCaptain = await isCaptain(user);
    if (userIsCaptain) {
        return { hasAccess: true, role: 'captain' };
    }

    const userIsStaff = await isStaff(user);
    if (userIsStaff) {
        return { hasAccess: true, role: 'staff' };
    }

    return { hasAccess: false, role: null };
}

/**
 * Get user data (captain or staff)
 */
export async function getUserData(user) {
    if (!user) return null;

    // Check if captain
    if (await isCaptain(user)) {
        const captainRef = doc(db, "config", "admin");
        const captainSnap = await getDoc(captainRef);
        
        if (captainSnap.exists()) {
            const captainData = captainSnap.data();
            return {
                uid: user.uid,
                email: user.email,
                fullName: captainData.name || "Barangay Captain",
                role: 'captain'
            };
        }
    }

    // Check if staff
    const staffRef = doc(db, "staff", user.email);
    const staffSnap = await getDoc(staffRef);
    
    if (staffSnap.exists()) {
        const staffData = staffSnap.data();
        return {
            uid: user.uid,
            email: staffData.email,
            fullName: `${staffData.firstName} ${staffData.lastName}`,
            role: 'staff',
            isActive: staffData.isActive
        };
    }

    return null;
}