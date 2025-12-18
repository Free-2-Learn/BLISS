import { auth, db } from "../firebase-config.js";
import { 
    collection, getDocs, query, where, orderBy, limit, doc, getDoc, setDoc, arrayUnion, Timestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// Global variables
let latestAnnouncementId = null;
let latestRequestId = null;
let latestIncidentId = null;
let currentUser = null;
let currentUserData = null;
let notifications = [];
let dashboardCache = {
    lastLoaded: null,
    data: null
};

// ========== ACTIVITY LOGGING ==========

async function logActivity(action, details = {}) {
    if (!currentUser || !currentUserData) return;

    const userId = currentUser.email.toLowerCase();
    const fullName = `${currentUserData.firstName} ${currentUserData.lastName}`;

    try {
        const logRef = doc(db, 'activityLogs', userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: 'resident',
            activities: arrayUnion({
                action: action,
                module: 'resident-dashboard',
                details: details,
                timestamp: Timestamp.now()
            })
        }, { merge: true });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

// ========== AUTHENTICATION ==========

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../index.html";
        return;
    }

    currentUser = user;
    
    // Load user profile and make UI interactive immediately
    await loadUserProfile(user);
    
    // Load everything else in PARALLEL (much faster!)
    Promise.all([
        loadLatestAnnouncement(),
        loadLatestRequest(user),
        loadLatestIncident(user),
        loadRecentActivity(user),
        loadNotifications(user)
    ]).catch(error => {
        console.error("Error loading dashboard data:", error);
    });
});

// ========== LOAD USER PROFILE ==========

async function loadUserProfile(user) {
    try {
        const userEmail = user.email.toLowerCase();
        const residentRef = doc(db, "residents", userEmail);
        const residentSnap = await getDoc(residentRef);
        
        if (residentSnap.exists()) {
            currentUserData = residentSnap.data();
            const fullName = `${currentUserData.firstName} ${currentUserData.lastName}`;
            
            const welcomeText = document.getElementById("welcome-text");
            if (welcomeText) {
                welcomeText.textContent = fullName;
            }
        } else {
            const welcomeText = document.getElementById("welcome-text");
            if (welcomeText) {
                welcomeText.textContent = user.email;
            }
        }
        
        // Make UI interactive immediately
        setupCardClickHandlers();
        setupNotificationButton();
        setupLogout();
    } catch (error) {
        console.error("Error loading user profile:", error);
    }
}

// ========== LOAD LATEST ANNOUNCEMENT ==========

async function loadLatestAnnouncement() {
    try {
        const announcementsRef = collection(db, "announcements");
        const q = query(announcementsRef, orderBy("date", "desc"), limit(1));
        const querySnapshot = await getDocs(q);
        
        const titleEl = document.getElementById("latest-announcement-title");
        const dateEl = document.getElementById("latest-announcement-date");
        
        if (!querySnapshot.empty) {
            const announcement = querySnapshot.docs[0].data();
            latestAnnouncementId = querySnapshot.docs[0].id;
            
            // Show title or first 50 chars of text
            const title = announcement.title || announcement.text.substring(0, 50) + '...';
            const date = formatDate(announcement.date);
            
            titleEl.textContent = title;
            dateEl.textContent = date;
        } else {
            titleEl.textContent = "No announcements yet";
            dateEl.textContent = "Check back later for updates";
            latestAnnouncementId = null;
        }
    } catch (error) {
        console.error("Error loading latest announcement:", error);
        const titleEl = document.getElementById("latest-announcement-title");
        const dateEl = document.getElementById("latest-announcement-date");
        if (titleEl) titleEl.textContent = "Error loading announcement";
        if (dateEl) dateEl.textContent = "Please refresh the page";
    }
}

// ========== LOAD LATEST REQUEST ==========

async function loadLatestRequest(user) {
    try {
        const userEmail = user.email.toLowerCase();
        const requestsRef = collection(db, "documentRequests");
        
        // OPTIMIZED: Only fetch user's requests with query
        const q = query(
            requestsRef, 
            where("residentId", "in", [userEmail, userEmail.replace('@bms.com', '@BMS.com')]),
            orderBy("requestedAt", "desc"),
            limit(1)
        );
        
        const querySnapshot = await getDocs(q);
        
        const titleEl = document.getElementById("latest-request-title");
        const statusEl = document.getElementById("latest-request-status");
        
        if (!querySnapshot.empty) {
            const latestRequest = querySnapshot.docs[0].data();
            latestRequestId = querySnapshot.docs[0].id;
            
            titleEl.textContent = latestRequest.documentType || "Document Request";
            
            const statusIcon = latestRequest.status === 'approved' ? '✓' : 
                             latestRequest.status === 'rejected' ? '✗' : '⏳';
            statusEl.textContent = `${statusIcon} ${latestRequest.status.charAt(0).toUpperCase() + latestRequest.status.slice(1)}`;
        } else {
            titleEl.textContent = "No requests yet";
            statusEl.textContent = "Click to create your first request";
            latestRequestId = null;
        }
    } catch (error) {
        console.error("Error loading latest request:", error);
        const titleEl = document.getElementById("latest-request-title");
        const statusEl = document.getElementById("latest-request-status");
        if (titleEl) titleEl.textContent = "Error loading requests";
        if (statusEl) statusEl.textContent = "Please refresh the page";
    }
}

// ========== LOAD LATEST INCIDENT ==========

async function loadLatestIncident(user) {
    try {
        const incidentsRef = collection(db, "incidentReports");
        
        // OPTIMIZED: Only fetch user's incidents with query
        const q = query(
            incidentsRef,
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc"),
            limit(1)
        );
        
        const querySnapshot = await getDocs(q);
        
        const titleEl = document.getElementById("latest-incident-title");
        const statusEl = document.getElementById("latest-incident-status");
        
        if (!querySnapshot.empty) {
            const latestIncident = querySnapshot.docs[0].data();
            latestIncidentId = querySnapshot.docs[0].id;
            
            titleEl.textContent = latestIncident.incidentType || "Incident Report";
            
            const statusIcon = latestIncident.status === 'resolved' ? '✓' : 
                             latestIncident.status === 'investigating' ? '🔍' : '📝';
            statusEl.textContent = `${statusIcon} ${latestIncident.status.charAt(0).toUpperCase() + latestIncident.status.slice(1)}`;
        } else {
            titleEl.textContent = "No incidents reported";
            statusEl.textContent = "Click to report your first incident";
            latestIncidentId = null;
        }
    } catch (error) {
        console.error("Error loading latest incident:", error);
        const titleEl = document.getElementById("latest-incident-title");
        const statusEl = document.getElementById("latest-incident-status");
        if (titleEl) titleEl.textContent = "Error loading incidents";
        if (statusEl) statusEl.textContent = "Please refresh the page";
    }
}

// ========== LOAD RECENT ACTIVITY ==========

async function loadRecentActivity(user) {
    try {
        const userEmail = user.email.toLowerCase();
        const activityList = document.getElementById("activity-list");
        
        if (!activityList) return;
        
        activityList.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">Loading...</div>';
        
        const activities = [];
        
        // OPTIMIZED: Only fetch user's requests (limit 10)
        const requestsRef = collection(db, "documentRequests");
        const requestsQuery = query(
            requestsRef,
            where("residentId", "in", [userEmail, userEmail.replace('@bms.com', '@BMS.com')]),
            orderBy("requestedAt", "desc"),
            limit(10)
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        
        requestsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const timestamp = data.requestedAt?.toDate?.() || 
                            (data.requestedAt?.seconds ? new Date(data.requestedAt.seconds * 1000) : new Date());
            
            activities.push({
                type: 'request',
                icon: 'fa-file-alt',
                iconBg: '#f5576c',
                title: `Document Request: ${data.documentType || 'Unknown'}`,
                desc: `Status: ${data.status || 'Pending'}`,
                time: formatDate(timestamp),
                timestamp: timestamp
            });
        });
        
        // OPTIMIZED: Only fetch user's incidents (limit 10)
        const incidentsRef = collection(db, "incidentReports");
        const incidentsQuery = query(
            incidentsRef,
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc"),
            limit(10)
        );
        const incidentsSnapshot = await getDocs(incidentsQuery);
        
        incidentsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const timestamp = data.createdAt?.toDate?.() || 
                            (data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000) : new Date());
            
            activities.push({
                type: 'incident',
                icon: 'fa-exclamation-triangle',
                iconBg: '#4facfe',
                title: `Incident Report: ${data.incidentType || 'Unknown'}`,
                desc: `Status: ${data.status || 'Submitted'}`,
                time: formatDate(timestamp),
                timestamp: timestamp
            });
        });
        
        activities.sort((a, b) => b.timestamp - a.timestamp);
        
        if (activities.length > 0) {
            activityList.innerHTML = '';
            
            activities.slice(0, 10).forEach(activity => {
                const activityHTML = `
                    <div class="activity-item">
                        <div class="activity-icon" style="background: ${activity.iconBg};">
                            <i class="fas ${activity.icon}"></i>
                        </div>
                        <div class="activity-details">
                            <p class="activity-title">${activity.title}</p>
                            <p class="activity-desc">${activity.desc}</p>
                            <p class="activity-time">${activity.time}</p>
                        </div>
                    </div>
                `;
                activityList.insertAdjacentHTML('beforeend', activityHTML);
            });
        } else {
            activityList.innerHTML = `
                <div class="activity-item">
                    <div class="activity-icon" style="background: #667eea;">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div class="activity-details">
                        <p class="activity-title">Welcome to the Resident Portal!</p>
                        <p class="activity-desc">Start by exploring the quick actions above</p>
                        <p class="activity-time">Just now</p>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error("Error loading recent activity:", error);
    }
}

// ========== CARD CLICK HANDLERS ==========

function setupCardClickHandlers() {
    const announcementCard = document.getElementById('latest-announcement-card');
    if (announcementCard) {
        announcementCard.style.cursor = 'pointer';
        announcementCard.addEventListener('click', () => {
            if (latestAnnouncementId) {
                openAnnouncementModal(latestAnnouncementId);
            } else {
                window.location.href = 'residents-announcement.html';
            }
        });
    }
    
    const requestCard = document.getElementById('latest-request-card');
    if (requestCard) {
        requestCard.style.cursor = 'pointer';
        requestCard.addEventListener('click', () => {
            if (latestRequestId) {
                openRequestModal(latestRequestId);
            } else {
                window.location.href = 'request-document.html';
            }
        });
    }
    
    const incidentCard = document.getElementById('latest-incident-card');
    if (incidentCard) {
        incidentCard.style.cursor = 'pointer';
        incidentCard.addEventListener('click', () => {
            if (latestIncidentId) {
                openIncidentModal(latestIncidentId);
            } else {
                window.location.href = 'resident-incident-report.html';
            }
        });
    }
}

// ========== MODAL FUNCTIONS ==========

async function openAnnouncementModal(announcementId) {
    const modal = document.getElementById('announcement-modal');
    const content = document.getElementById('announcement-detail-content');
    
    // Show modal immediately with loading state
    content.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #667eea;"></i><p style="margin-top: 15px; color: #718096;">Loading...</p></div>';
    modal.classList.add('show');
    
    try {
        const docRef = doc(db, "announcements", announcementId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            let imagesHTML = '';
            if (data.images && data.images.length > 0) {
                imagesHTML = `
                    <div class="detail-section">
                        <h4>Images</h4>
                        <div class="announcement-images">
                            ${data.images.map(img => `<img src="${img}" alt="Announcement image" style="max-width: 100%; border-radius: 8px; margin: 10px 0;">`).join('')}
                        </div>
                    </div>
                `;
            }
            
            content.innerHTML = `
                ${data.title ? `
                    <div class="detail-section">
                        <h4>Title</h4>
                        <p style="font-size: 18px; font-weight: 600;">${data.title}</p>
                    </div>
                ` : ''}
                <div class="detail-section">
                    <h4>Message</h4>
                    <p>${data.text.replace(/\n/g, '<br>')}</p>
                </div>
                ${imagesHTML}
                <div class="detail-section">
                    <h4>Posted By</h4>
                    <p>${data.postedBy || 'Barangay Office'}</p>
                </div>
                <div class="detail-section">
                    <h4>Date Posted</h4>
                    <p>${formatDetailDate(data.date)}</p>
                </div>
            `;
            
            logActivity('viewed_announcement_details', {
                announcementId: announcementId,
                announcementTitle: data.title || 'Untitled'
            });
        }
    } catch (error) {
        console.error("Error loading announcement:", error);
        content.innerHTML = '<div style="text-align: center; padding: 40px; color: #f5576c;"><i class="fas fa-exclamation-circle" style="font-size: 32px;"></i><p style="margin-top: 15px;">Failed to load announcement</p></div>';
    }
}

async function openRequestModal(requestId) {
    const modal = document.getElementById('request-modal');
    const content = document.getElementById('request-detail-content');
    
    // Show modal immediately with loading state
    content.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #667eea;"></i><p style="margin-top: 15px; color: #718096;">Loading...</p></div>';
    modal.classList.add('show');
    
    try {
        const docRef = doc(db, "documentRequests", requestId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            const statusClass = `status-${data.status.toLowerCase().replace(' ', '-')}`;
            
            let requestDate = formatDetailDate(new Date());
            if (data.requestedAt) {
                if (data.requestedAt.toDate && typeof data.requestedAt.toDate === 'function') {
                    requestDate = formatDetailDate(data.requestedAt.toDate());
                } else if (data.requestedAt.seconds) {
                    requestDate = formatDetailDate(new Date(data.requestedAt.seconds * 1000));
                }
            }
            
            content.innerHTML = `
                <div class="detail-section">
                    <h4>Document Type</h4>
                    <p style="font-size: 18px; font-weight: 600;">${data.documentType}</p>
                </div>
                <div class="detail-section">
                    <h4>Current Status</h4>
                    <p><span class="status-badge ${statusClass}">${data.status}</span></p>
                </div>
                <div class="detail-section">
                    <h4>Request Date</h4>
                    <p>${requestDate}</p>
                </div>
                ${data.purpose ? `
                    <div class="detail-section">
                        <h4>Purpose</h4>
                        <p>${data.purpose}</p>
                    </div>
                ` : ''}
                ${data.documentUrl ? `
                    <div class="detail-section">
                        <h4>Document</h4>
                        <button onclick="window.open('${data.documentUrl}', '_blank')" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">
                            <i class="fas fa-download"></i> View/Download Document
                        </button>
                    </div>
                ` : ''}
                <div class="detail-section">
                    <h4>Progress Timeline</h4>
                    <div style="padding: 15px; background: var(--light); border-radius: 8px; margin-top: 10px;">
                        <p style="font-size: 13px; color: var(--gray); margin-bottom: 10px;">
                            Your request is currently <strong>${data.status}</strong>.
                        </p>
                        ${getProgressMessage(data.status)}
                    </div>
                </div>
            `;
            
            logActivity('viewed_request_details', {
                requestId: requestId,
                documentType: data.documentType,
                status: data.status
            });
        }
    } catch (error) {
        console.error("Error loading request:", error);
        content.innerHTML = '<div style="text-align: center; padding: 40px; color: #f5576c;"><i class="fas fa-exclamation-circle" style="font-size: 32px;"></i><p style="margin-top: 15px;">Failed to load request</p></div>';
    }
}

async function openIncidentModal(incidentId) {
    const modal = document.getElementById('incident-modal');
    const content = document.getElementById('incident-detail-content');
    
    // Show modal immediately with loading state
    content.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #667eea;"></i><p style="margin-top: 15px; color: #718096;">Loading...</p></div>';
    modal.classList.add('show');
    
    try {
        const docRef = doc(db, "incidentReports", incidentId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            const statusClass = `status-${data.status.toLowerCase().replace(' ', '-')}`;
            
            let createdDate = formatDetailDate(new Date());
            if (data.createdAt) {
                if (data.createdAt.toDate && typeof data.createdAt.toDate === 'function') {
                    createdDate = formatDetailDate(data.createdAt.toDate());
                } else if (data.createdAt.seconds) {
                    createdDate = formatDetailDate(new Date(data.createdAt.seconds * 1000));
                }
            }
            
            content.innerHTML = `
                <div class="detail-section">
                    <h4>Incident Type</h4>
                    <p style="font-size: 18px; font-weight: 600;">${data.incidentType}</p>
                </div>
                <div class="detail-section">
                    <h4>Current Status</h4>
                    <p><span class="status-badge ${statusClass}">${data.status}</span></p>
                </div>
                <div class="detail-section">
                    <h4>Description</h4>
                    <p>${data.description}</p>
                </div>
                <div class="detail-section">
                    <h4>Date Reported</h4>
                    <p>${createdDate}</p>
                </div>
                ${data.location ? `
                    <div class="detail-section">
                        <h4>Location</h4>
                        <p>${data.location}</p>
                    </div>
                ` : ''}
                ${data.investigationNotes && data.investigationNotes.length > 0 ? `
                    <div class="detail-section">
                        <h4>Investigation Updates</h4>
                        ${data.investigationNotes.map(note => {
                            const noteTimestamp = note.timestamp?.toDate?.() || 
                                                (note.timestamp?.seconds ? new Date(note.timestamp.seconds * 1000) : new Date());
                            return `
                                <div style="padding: 12px; background: #f7fafc; border-left: 3px solid #667eea; margin: 10px 0; border-radius: 4px;">
                                    <p style="font-size: 13px; margin-bottom: 5px;">${note.note || 'No note provided'}</p>
                                    <p style="font-size: 11px; color: #718096;">- ${note.addedBy || 'Staff'} on ${formatDate(noteTimestamp)}</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                <div class="detail-section">
                    <h4>Progress Update</h4>
                    <div style="padding: 15px; background: var(--light); border-radius: 8px; margin-top: 10px;">
                        <p style="font-size: 13px; color: var(--gray);">
                            Your incident report is currently <strong>${data.status}</strong>.
                        </p>
                    </div>
                </div>
            `;
            
            logActivity('viewed_incident_details', {
                incidentId: incidentId,
                incidentType: data.incidentType,
                status: data.status
            });
        }
    } catch (error) {
        console.error("Error loading incident:", error);
        content.innerHTML = '<div style="text-align: center; padding: 40px; color: #f5576c;"><i class="fas fa-exclamation-circle" style="font-size: 32px;"></i><p style="margin-top: 15px;">Failed to load incident</p></div>';
    }
}

// Close modal functions
window.closeAnnouncementModal = function() {
    document.getElementById('announcement-modal').classList.remove('show');
};

window.closeRequestModal = function() {
    document.getElementById('request-modal').classList.remove('show');
};

window.closeIncidentModal = function() {
    document.getElementById('incident-modal').classList.remove('show');
};

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
});

// ========== HELPER FUNCTIONS ==========

function formatDate(dateInput) {
    if (!dateInput) return 'Unknown date';
    
    let date;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
        date = dateInput.toDate();
    } else if (dateInput.seconds) {
        date = new Date(dateInput.seconds * 1000);
    } else if (typeof dateInput === 'string') {
        date = new Date(dateInput);
    } else {
        date = dateInput;
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatDetailDate(dateInput) {
    if (!dateInput) return 'Unknown date';
    
    let date;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
        date = dateInput.toDate();
    } else if (dateInput.seconds) {
        date = new Date(dateInput.seconds * 1000);
    } else if (typeof dateInput === 'string') {
        date = new Date(dateInput);
    } else {
        date = dateInput;
    }
    
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getProgressMessage(status) {
    const messages = {
        'pending': '<p style="font-size: 13px;">⏳ Your request has been received and is waiting to be processed.</p>',
        'approved': '<p style="font-size: 13px;">✅ Your request has been approved! Document is being generated.</p>',
        'rejected': '<p style="font-size: 13px;">❌ Your request was not approved. Please check the rejection reason.</p>',
        'completed': '<p style="font-size: 13px;">✅ This request has been completed. You can download your document.</p>'
    };
    
    return messages[status.toLowerCase()] || '<p style="font-size: 13px;">Processing your request...</p>';
}

// ========== LOGOUT ==========

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

// ========== LOAD NOTIFICATIONS ==========

async function loadNotifications(user) {
    try {
        const userEmail = user.email.toLowerCase();
        notifications = [];
        
        const dismissedNotifs = JSON.parse(localStorage.getItem('dismissedNotifications') || '[]');
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        // OPTIMIZED: Fetch only recent announcements
        const announcementsRef = collection(db, "announcements");
        const announcementsQuery = query(
            announcementsRef,
            orderBy("date", "desc"),
            limit(5)
        );
        const announcementsSnapshot = await getDocs(announcementsQuery);
        
        announcementsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (dismissedNotifs.includes(`announcement-${docSnap.id}`)) return;
            
            let announcementDate = new Date();
            if (data.date) {
                if (typeof data.date === 'string') {
                    announcementDate = new Date(data.date);
                } else if (data.date.toDate) {
                    announcementDate = data.date.toDate();
                } else if (data.date.seconds) {
                    announcementDate = new Date(data.date.seconds * 1000);
                }
            }
            
            if (announcementDate > sevenDaysAgo) {
                notifications.push({
                    id: docSnap.id,
                    notifId: `announcement-${docSnap.id}`,
                    type: 'announcement',
                    icon: 'fa-bullhorn',
                    iconBg: '#667eea',
                    title: 'New Announcement',
                    message: data.title || data.text.substring(0, 50) + '...',
                    date: announcementDate,
                    action: () => openAnnouncementModal(docSnap.id)
                });
            }
        });
        
        // OPTIMIZED: Only fetch user's approved/rejected requests
        const requestsRef = collection(db, "documentRequests");
        const requestsQuery = query(
            requestsRef,
            where("residentId", "in", [userEmail, userEmail.replace('@bms.com', '@BMS.com')]),
            where("status", "in", ["approved", "rejected"]),
            orderBy("reviewedAt", "desc"),
            limit(5)
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        
        requestsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (dismissedNotifs.includes(`request-${docSnap.id}`)) return;
            
            let reviewedDate = new Date();
            if (data.reviewedAt) {
                if (data.reviewedAt.toDate) {
                    reviewedDate = data.reviewedAt.toDate();
                } else if (data.reviewedAt.seconds) {
                    reviewedDate = new Date(data.reviewedAt.seconds * 1000);
                }
            }
            
            if (reviewedDate > sevenDaysAgo) {
                notifications.push({
                    id: docSnap.id,
                    notifId: `request-${docSnap.id}`,
                    type: 'request',
                    icon: data.status === 'approved' ? 'fa-check-circle' : 'fa-times-circle',
                    iconBg: data.status === 'approved' ? '#43e97b' : '#f5576c',
                    title: `Request ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}`,
                    message: `Your ${data.documentType} request has been ${data.status}`,
                    date: reviewedDate,
                    action: () => openRequestModal(docSnap.id)
                });
            }
        });
        
        // OPTIMIZED: Only fetch user's updated incidents
        const incidentsRef = collection(db, "incidentReports");
        const incidentsQuery = query(
            incidentsRef,
            where("userId", "==", user.uid),
            orderBy("updatedAt", "desc"),
            limit(5)
        );
        const incidentsSnapshot = await getDocs(incidentsQuery);
        
        incidentsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (dismissedNotifs.includes(`incident-${docSnap.id}`)) return;
            if (data.status === 'submitted') return; // Skip submitted ones
            
            let updatedDate = new Date();
            if (data.updatedAt) {
                if (data.updatedAt.toDate) {
                    updatedDate = data.updatedAt.toDate();
                } else if (data.updatedAt.seconds) {
                    updatedDate = new Date(data.updatedAt.seconds * 1000);
                }
            }
            
            if (updatedDate > sevenDaysAgo) {
                notifications.push({
                    id: docSnap.id,
                    notifId: `incident-${docSnap.id}`,
                    type: 'incident',
                    icon: 'fa-exclamation-triangle',
                    iconBg: '#4facfe',
                    title: 'Incident Update',
                    message: `Your ${data.incidentType} report is now ${data.status}`,
                    date: updatedDate,
                    action: () => openIncidentModal(docSnap.id)
                });
            }
        });
        
        notifications.sort((a, b) => b.date - a.date);
        updateNotificationBadge();
    } catch (error) {
        console.error("Error loading notifications:", error);
    }
}

function updateNotificationBadge() {
    const badge = document.querySelector('.notification-dot');
    if (badge) {
        if (notifications.length > 0) {
            badge.style.display = 'block';
            badge.textContent = notifications.length > 9 ? '9+' : notifications.length;
        } else {
            badge.style.display = 'none';
        }
    }
}

// ========== NOTIFICATION BUTTON ==========

function setupNotificationButton() {
    const notificationBtn = document.querySelector('.btn-icon');
    if (!notificationBtn) return;
    
    notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotificationPanel();
    });
    
    // Close notification panel when clicking outside
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notification-panel');
        if (panel && !panel.contains(e.target) && !e.target.closest('.btn-icon')) {
            panel.classList.remove('show');
        }
    });
}

function toggleNotificationPanel() {
    let panel = document.getElementById('notification-panel');
    
    if (!panel) {
        createNotificationPanel();
        panel = document.getElementById('notification-panel');
    }
    
    if (panel.classList.contains('show')) {
        panel.classList.remove('show');
    } else {
        renderNotifications();
        panel.classList.add('show');
    }
}

function createNotificationPanel() {
    const panel = document.createElement('div');
    panel.id = 'notification-panel';
    panel.className = 'notification-panel';
    panel.innerHTML = `
        <div class="notification-header">
            <h3><i class="fas fa-bell"></i> Notifications</h3>
            <button class="clear-all-btn" onclick="clearAllNotifications()">
                <i class="fas fa-check-double"></i> Clear All
            </button>
        </div>
        <div class="notification-body" id="notification-body">
            <!-- Notifications will be loaded here -->
        </div>
    `;
    
    document.body.appendChild(panel);
}

function renderNotifications() {
    const notificationBody = document.getElementById('notification-body');
    if (!notificationBody) return;
    
    if (notifications.length === 0) {
        notificationBody.innerHTML = `
            <div class="empty-notifications">
                <i class="fas fa-bell-slash"></i>
                <p>No new notifications</p>
                <span>You're all caught up!</span>
            </div>
        `;
        return;
    }
    
    notificationBody.innerHTML = '';
    
    notifications.forEach(notification => {
        const notifItem = document.createElement('div');
        notifItem.className = 'notification-item';
        notifItem.innerHTML = `
            <div class="notification-icon" style="background: ${notification.iconBg};">
                <i class="fas ${notification.icon}"></i>
            </div>
            <div class="notification-content">
                <h4>${notification.title}</h4>
                <p>${notification.message}</p>
                <span class="notification-time">${formatDate(notification.date)}</span>
            </div>
        `;
        
        notifItem.addEventListener('click', () => {
            // Dismiss this notification
            dismissNotification(notification.notifId);
            // Execute action
            notification.action();
            // Close panel
            toggleNotificationPanel();
        });
        
        notificationBody.appendChild(notifItem);
    });
}

function dismissNotification(notifId) {
    const dismissedNotifs = JSON.parse(localStorage.getItem('dismissedNotifications') || '[]');
    if (!dismissedNotifs.includes(notifId)) {
        dismissedNotifs.push(notifId);
        localStorage.setItem('dismissedNotifications', JSON.stringify(dismissedNotifs));
    }
    
    // Remove from current notifications array
    notifications = notifications.filter(n => n.notifId !== notifId);
    updateNotificationBadge();
    renderNotifications();
}

window.clearAllNotifications = function() {
    // Save all current notification IDs as dismissed
    const dismissedNotifs = JSON.parse(localStorage.getItem('dismissedNotifications') || '[]');
    notifications.forEach(notif => {
        if (!dismissedNotifs.includes(notif.notifId)) {
            dismissedNotifs.push(notif.notifId);
        }
    });
    localStorage.setItem('dismissedNotifications', JSON.stringify(dismissedNotifs));
    
    notifications = [];
    updateNotificationBadge();
    renderNotifications();
    
    const notificationBody = document.getElementById('notification-body');
    if (notificationBody) {
        notificationBody.innerHTML = `
            <div class="empty-notifications">
                <i class="fas fa-check-circle" style="color: #43e97b;"></i>
                <p>All cleared!</p>
                <span>You've cleared all notifications</span>
            </div>
        `;
    }
};