// resident-history.js - Updated with Activity Logging & Document History
import { db, auth, secondaryAuth } from "../firebase-config.js";
import { 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc, 
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    limit,
    where,
    arrayUnion,
    serverTimestamp,
    Timestamp,
    addDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { 
    createUserWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { isCaptainOrStaff } from "./auth-helper.js";
import { goToDashboard } from "./navigation-helper.js";
import { getUserData } from "./auth-helper.js";

const backupRef = collection(db, "backupResidents");
let allArchivedResidents = [];
let currentUserRole = null;
let currentUserData = null;
let currentUser = null;

// ✅ Activity Logging (for analytics - no UI)
async function logActivity(action, details = {}) {
    if (!currentUser || !currentUserData) return;

    const userId = currentUser.email.toLowerCase();
    const fullName = currentUserData?.fullName || currentUser.email;

    try {
        const logRef = doc(db, 'activityLogs', userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: currentUserData?.role || 'staff',
            activities: arrayUnion({
                action: action,
                module: 'resident-history',
                details: details,
                timestamp: Timestamp.now()
            })
        }, { merge: true });
        
        console.log(`✅ Activity logged: ${action}`);
    } catch (error) {
        console.error('Error logging activity:', error);
        // Don't throw - allow operation to continue
    }
}

// ✅ Document History (for analytics - no UI)
async function logDocumentHistory(residentId, action, details = {}) {
    if (!currentUser || !currentUserData) return;

    try {
        const historyData = {
            action: action,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            userName: currentUserData?.fullName || currentUser.email,
            userRole: currentUserData?.role || 'staff',
            timestamp: serverTimestamp(),
            createdAt: Timestamp.now(),
            details: details
        };

        const historyRef = collection(db, 'documentHistory', residentId, 'logs');
        await addDoc(historyRef, historyData);
        
        console.log(`✅ Document history logged: ${action}`);
    } catch (error) {
        console.error('Error writing document history:', error);
        // Don't throw - allow operation to continue
    }
}

// Authentication and page protection
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("🚫 No user logged in. Redirecting to login.");
        window.location.href = "../index.html";
        return;
    }

    const accessCheck = await isCaptainOrStaff(user);

    if (!accessCheck.hasAccess) {
        console.warn("🚫 Unauthorized access. Redirecting...");
        alert("Access denied. Staff or Captain privileges required.");
        window.location.href = "../index.html";
        return;
    }

    console.log(`✅ User verified as ${accessCheck.role}`);
    currentUserRole = accessCheck.role;
    currentUser = user; // Store current user
    
    // Get full user data and display
    currentUserData = await getUserData(user);
    if (currentUserData) {
        const welcomeMsg = document.getElementById("user-welcome");
        const roleMsg = document.getElementById("user-role");
        if (welcomeMsg) {
            welcomeMsg.textContent = currentUserData.fullName || 'User';
        }
        if (roleMsg) {
            roleMsg.textContent = accessCheck.role.charAt(0).toUpperCase() + accessCheck.role.slice(1);
        }
    }
    
    setupBackButton();
    setupLogout();
    setupSearch();
    initializeRealTimeListener();
});

// Setup back button
function setupBackButton() {
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.onclick = (e) => {
            e.preventDefault();
            goToDashboard(currentUserRole);
        };
    }
}

// Setup logout button
function setupLogout() {
    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) {
        logoutBtn.onclick = async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                await auth.signOut();
                window.location.href = '../index.html';
            }
        };
    }
}

// Setup search functionality
function setupSearch() {
    const searchInput = document.getElementById("search-history");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const query = searchInput.value.trim().toLowerCase();
            const filtered = allArchivedResidents.filter(r => {
                const fullName = `${r.firstName} ${r.middleName || ""} ${r.lastName}`.toLowerCase();
                const email = (r.email || "").toLowerCase();
                const contact = (r.contactNumber || "").toLowerCase();
                return fullName.includes(query) || email.includes(query) || contact.includes(query);
            });

            renderHistoryRows(filtered);
        });
    }
}

// Initialize real-time listener for archived residents
function initializeRealTimeListener() {
    const historyBody = document.getElementById("history-body");

    onSnapshot(backupRef, (snapshot) => {
        allArchivedResidents = [];
        snapshot.forEach(doc => {
            allArchivedResidents.push(doc.data());
        });

        // Sort by archived date (most recent first)
        allArchivedResidents.sort((a, b) => {
            const timeA = a.archivedAt?.seconds || 0;
            const timeB = b.archivedAt?.seconds || 0;
            return timeB - timeA;
        });

        renderHistoryRows(allArchivedResidents);
        updateStats();
        loadRecentActivity(); // Update activity in real-time
    }, (error) => {
        console.error("Error loading archived residents:", error);
        historyBody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 40px;">
                    <div style="color: #f5576c;">
                        <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 15px;"></i>
                        <p style="font-size: 18px;">Error loading archived residents</p>
                        <p style="font-size: 14px; color: #a0aec0; margin-top: 10px;">Please refresh the page</p>
                    </div>
                </td>
            </tr>
        `;
    });
}

// Update statistics
function updateStats() {
    const totalArchived = allArchivedResidents.length;
    document.getElementById('total-archived').textContent = totalArchived;
    
    // Count recently archived (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentCount = allArchivedResidents.filter(r => {
        const archivedTime = r.archivedAt?.seconds * 1000 || 0;
        return archivedTime > thirtyDaysAgo;
    }).length;
    document.getElementById('recent-archived').textContent = recentCount;
    
    // All archived residents are restorable
    document.getElementById('restorable-count').textContent = totalArchived;
}

// Render archived residents table
function renderHistoryRows(residents) {
    const historyBody = document.getElementById("history-body");
    historyBody.innerHTML = "";

    if (residents.length === 0) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 60px;">
                    <div class="empty-state">
                        <i class="fas fa-archive"></i>
                        <p>No archived residents found</p>
                        <p style="font-size: 14px; margin-top: 10px;">Deleted residents will appear here</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    residents.forEach((resident, index) => {
        const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;
        
        // Format archived date
        let archivedDate = 'Unknown';
        console.log('Resident archivedAt:', resident.archivedAt, 'Type:', typeof resident.archivedAt);
        
        if (resident.archivedAt) {
            try {
                let date = null;
                
                // Check if it's a Firestore Timestamp object
                if (resident.archivedAt.toDate && typeof resident.archivedAt.toDate === 'function') {
                    date = resident.archivedAt.toDate();
                } 
                // Check if it has seconds property (Firestore timestamp format)
                else if (resident.archivedAt.seconds) {
                    date = new Date(resident.archivedAt.seconds * 1000);
                }
                // Check if it's already a Date object
                else if (resident.archivedAt instanceof Date) {
                    date = resident.archivedAt;
                }
                // Check if it's a string that can be parsed
                else if (typeof resident.archivedAt === 'string') {
                    date = new Date(resident.archivedAt);
                }
                
                if (date && !isNaN(date.getTime())) {
                    archivedDate = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                    console.log('Formatted date:', archivedDate);
                } else {
                    console.warn('Could not parse date for resident:', resident.id);
                }
            } catch (error) {
                console.error('Error formatting date:', error, resident.archivedAt);
                archivedDate = 'Invalid Date';
            }
        } else {
            console.warn('No archivedAt field for resident:', resident.id);
        }
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td><strong>${fullName}</strong></td>
            <td>${resident.email || "-"}</td>
            <td>${resident.contactNumber || "-"}</td>
            <td>${resident.address || "-"}</td>
            <td>${resident.age || "-"}</td>
            <td>${resident.gender || "-"}</td>
            <td>${resident.civilStatus || "-"}</td>
            <td>${resident.occupation || "-"}</td>
            <td>${archivedDate}</td>
            <td>
                <button class="btn-view-details" onclick="viewResidentDetails('${resident.id}')">
                    <i class="fas fa-eye"></i> View
                </button>
                <button class="btn-restore" onclick="showRestoreModal('${resident.id}')">
                    <i class="fas fa-undo"></i> Restore
                </button>
            </td>
        `;  
        historyBody.appendChild(tr);
    });
}

// Show restore confirmation modal
window.showRestoreModal = function(id) {
    const resident = allArchivedResidents.find(r => r.id === id);
    if (!resident) return;

    const modal = document.getElementById('restore-modal');
    const modalBody = document.getElementById('restore-modal-body');
    const confirmBtn = document.getElementById('confirm-restore-btn');
    const modalHeader = modal.querySelector('.modal-header h3');

    // Reset modal header and button
    modalHeader.innerHTML = '<i class="fas fa-undo"></i> Restore Resident';
    confirmBtn.style.display = 'block';
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="fas fa-undo"></i> Restore';

    const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;

    modalBody.innerHTML = `
        <div style="margin-bottom: 20px;">
            <p style="font-size: 16px; margin-bottom: 15px;">
                Are you sure you want to restore <strong>${fullName}</strong>?
            </p>
            <div style="background: #f7fafc; padding: 20px; border-radius: 12px; border-left: 4px solid #667eea;">
                <p style="margin-bottom: 10px;"><strong>Email:</strong> ${resident.email}</p>
                <p style="margin-bottom: 10px;"><strong>Contact:</strong> ${resident.contactNumber || 'N/A'}</p>
                <p><strong>Address:</strong> ${resident.address || 'N/A'}</p>
            </div>
            <div style="margin-top: 15px; padding: 15px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
                <p style="color: #92400e; font-size: 14px;">
                    <i class="fas fa-info-circle"></i> 
                    This will recreate their account and move them back to active residents.
                </p>
            </div>
        </div>
    `;

    confirmBtn.onclick = () => restoreResident(id);
    modal.classList.add('active');
};

// Close restore modal
window.closeRestoreModal = function() {
    const modal = document.getElementById('restore-modal');
    modal.classList.remove('active');
};

// Restore resident function - UPDATED WITH LOGGING
window.restoreResident = async function(id) {
    try {
        const backupDocRef = doc(db, "backupResidents", id);
        const backupSnap = await getDoc(backupDocRef);

        if (!backupSnap.exists()) {
            alert("❌ Backup data not found.");
            closeRestoreModal();
            return;
        }

        const data = backupSnap.data();
        const fullName = `${data.firstName} ${data.middleName || ''} ${data.lastName}`.trim();
        const confirmBtn = document.getElementById('confirm-restore-btn');

        // Show loading state
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';

        // Recreate Firebase Auth account
        try {
            await createUserWithEmailAndPassword(secondaryAuth, data.email, "Resident123");
            console.log("✅ Auth account restored.");
        } catch (authErr) {
            if (authErr.code === 'auth/email-already-in-use') {
                console.log("ℹ️ Email already exists in auth - proceeding");
            } else {
                console.warn("⚠️ Auth restore failed:", authErr.message);
            }
        }

        // Move data to 'residents' collection
        await setDoc(doc(db, "residents", id), {
            ...data,
            restoredAt: new Date(),
            restoredBy: auth.currentUser.uid,
            status: "Active" // Ensure status is active when restored
        });

        // Remove from backup
        await deleteDoc(backupDocRef);

        // ✅ Log activity (analytics)
        await logActivity('restored_resident', {
            residentId: id,
            residentName: fullName,
            residentEmail: data.email
        });
        
        // ✅ Log document history
        await logDocumentHistory(id, 'resident_restored', {
            residentName: fullName,
            email: data.email,
            restoredBy: auth.currentUser.email,
            restoredFrom: 'archive'
        });

        closeRestoreModal();
        
        // Show success message
        showSuccessNotification(`✅ ${fullName} has been restored successfully!`);

    } catch (err) {
        console.error("❌ Error restoring resident:", err);
        alert("❌ Failed to restore resident: " + err.message);
        
        // Re-enable button on error
        const confirmBtn = document.getElementById('confirm-restore-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-undo"></i> Restore';
        }
    }
};

// View resident details - UPDATED WITH LOGGING
window.viewResidentDetails = function(id) {
    const resident = allArchivedResidents.find(r => r.id === id);
    if (!resident) return;

    const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;
    
    // Format archived date properly
    let archivedDate = 'Unknown';
    console.log('ViewDetails - archivedAt:', resident.archivedAt);
    
    if (resident.archivedAt) {
        try {
            let date = null;
            
            if (resident.archivedAt.toDate && typeof resident.archivedAt.toDate === 'function') {
                date = resident.archivedAt.toDate();
            } else if (resident.archivedAt.seconds) {
                date = new Date(resident.archivedAt.seconds * 1000);
            } else if (resident.archivedAt instanceof Date) {
                date = resident.archivedAt;
            } else if (typeof resident.archivedAt === 'string') {
                date = new Date(resident.archivedAt);
            }
            
            if (date && !isNaN(date.getTime())) {
                archivedDate = date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (error) {
            console.error('Error formatting date:', error);
            archivedDate = 'Invalid Date';
        }
    }

    const modal = document.getElementById('restore-modal');
    const modalBody = document.getElementById('restore-modal-body');
    const modalHeader = modal.querySelector('.modal-header h3');
    const confirmBtn = document.getElementById('confirm-restore-btn');

    modalHeader.innerHTML = '<i class="fas fa-user"></i> Resident Details';
    confirmBtn.style.display = 'none';

    modalBody.innerHTML = `
        <div class="resident-details">
            <h4 style="margin-bottom: 20px; color: #1a202c; font-size: 20px;">${fullName}</h4>
            
            <div style="display: grid; gap: 15px; max-height: 400px; overflow-y: auto; padding-right: 10px;">
                <div class="detail-row">
                    <strong>Email:</strong> ${resident.email || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Contact Number:</strong> ${resident.contactNumber || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Address:</strong> ${resident.address || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Age:</strong> ${resident.age || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Birthdate:</strong> ${resident.birthdate || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Gender:</strong> ${resident.gender || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Civil Status:</strong> ${resident.civilStatus || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Occupation:</strong> ${resident.occupation || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Education:</strong> ${resident.education || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Special Categories:</strong> ${resident.specialCategories || 'N/A'}
                </div>
                <div class="detail-row">
                    <strong>Voter Info:</strong> ${resident.voterInfo || 'N/A'}
                </div>
                <div class="detail-row" style="padding-top: 15px; border-top: 2px solid #e2e8f0;">
                    <strong>Archived On:</strong> ${archivedDate}
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');
    
    // ✅ Log activity (analytics) - viewing archived resident details
    logActivity('viewed_archived_resident_details', {
        residentId: id,
        residentName: fullName
    });
};

// Load recent activity with real-time updates
function loadRecentActivity() {
    const activityList = document.getElementById('activity-list');
    
    if (!activityList) return;
    
    activityList.innerHTML = '';

    // Get recently archived residents (limit to 10 most recent)
    const recentArchived = allArchivedResidents.slice(0, 10);
    
    console.log('Loading activity for', recentArchived.length, 'residents');

    if (recentArchived.length === 0) {
        activityList.innerHTML = `
            <div class="activity-item">
                <div class="activity-icon" style="background: #718096;">
                    <i class="fas fa-info-circle"></i>
                </div>
                <div class="activity-details">
                    <p class="activity-title">No recent activity</p>
                    <p class="activity-desc">Archive activity will appear here</p>
                </div>
            </div>
        `;
        return;
    }

    recentArchived.forEach((resident, index) => {
        const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;
        
        console.log(`Activity #${index + 1} - ${fullName}:`, resident.archivedAt);
        const timeAgo = getTimeAgo(resident.archivedAt);
        console.log(`Time ago result: ${timeAgo}`);

        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        activityItem.innerHTML = `
            <div class="activity-icon" style="background: #f59e0b;">
                <i class="fas fa-archive"></i>
            </div>
            <div class="activity-details">
                <p class="activity-title">Resident Archived</p>
                <p class="activity-desc">${fullName} was moved to archive</p>
                <span class="activity-time">${timeAgo}</span>
            </div>
        `;

        activityList.appendChild(activityItem);
    });
}

// Helper: Get "time ago" text
function getTimeAgo(timestamp) {
    if (!timestamp) {
        console.warn('getTimeAgo: No timestamp provided');
        return 'Recently';
    }

    try {
        const now = new Date();
        let date = null;
        
        console.log('getTimeAgo input:', timestamp, 'Type:', typeof timestamp);
        
        // Handle Firestore Timestamp with toDate method
        if (timestamp.toDate && typeof timestamp.toDate === 'function') {
            date = timestamp.toDate();
            console.log('Converted with toDate():', date);
        } 
        // Handle Firestore timestamp with seconds
        else if (timestamp.seconds !== undefined) {
            date = new Date(timestamp.seconds * 1000);
            console.log('Converted from seconds:', date);
        }
        // Handle if it's already a Date object
        else if (timestamp instanceof Date) {
            date = timestamp;
            console.log('Already a Date:', date);
        }
        // Handle string dates
        else if (typeof timestamp === 'string') {
            date = new Date(timestamp);
            console.log('Parsed from string:', date);
        }
        
        if (!date || isNaN(date.getTime())) {
            console.warn('Invalid date parsed:', date);
            return 'Recently';
        }
        
        const seconds = Math.floor((now - date) / 1000);
        console.log('Time difference in seconds:', seconds);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
        }
        if (seconds < 86400) {
            const hours = Math.floor(seconds / 3600);
            return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
        }
        if (seconds < 604800) {
            const days = Math.floor(seconds / 86400);
            return `${days} ${days === 1 ? 'day' : 'days'} ago`;
        }

        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch (error) {
        console.error('Error in getTimeAgo:', error);
        return 'Recently';
    }
}

// Show success notification
function showSuccessNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        box-shadow: 0 8px 16px rgba(67, 233, 123, 0.3);
        z-index: 10000;
        font-weight: 600;
        animation: slideInRight 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    .detail-row {
        padding: 12px;
        background: #f7fafc;
        border-radius: 8px;
        font-size: 14px;
    }
    .detail-row strong {
        color: #2d3748;
        display: inline-block;
        min-width: 150px;
    }
`;
document.head.appendChild(style);