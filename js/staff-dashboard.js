// staff-dashboard.js - Staff dashboard logic with real-time data
import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    orderBy, 
    limit,
    onSnapshot  
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { protectPage } from "./navigation-helper.js";
import { getUserData } from "./auth-helper.js";

let currentStaffUid = null;

// Authentication and page protection
onAuthStateChanged(auth, async (user) => {
    const authResult = await protectPage(auth);
    
    if (!authResult) return;
    
    const { role } = authResult;
    
    // Double-check that user is staff
    if (role !== 'staff') {
        alert('Access denied. This is the Staff dashboard.');
        window.location.href = 'dashboard-captain.html';
        return;
    }
    
    currentStaffUid = user.uid;
    
    // Get full user data and display name
    const userData = await getUserData(user);
    if (userData) {
        const welcomeMsg = document.getElementById("staff-welcome");
        if (welcomeMsg) {
            welcomeMsg.textContent = userData.fullName || 'Staff Member';
        }
    }
    
    // Setup logout button
    setupLogout();
    
    // Setup clickable stat cards
    setupStatCardLinks();
    
    // Load dashboard data
    await loadDashboardStats();
    await loadRecentActivity();
});

// Logout functionality
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

// Setup clickable stat cards
function setupStatCardLinks() {
    const statCards = document.querySelectorAll('.stat-card');
    
    statCards.forEach((card, index) => {
        card.style.cursor = 'pointer';
        
        card.addEventListener('click', () => {
            switch(index) {
                case 0: // Total Residents
                    window.location.href = 'residents.html';
                    break;
                case 1: // Pending Documents
                    window.location.href = 'document-requests.html';
                    break;
                case 2: // My Assigned Incidents
                    window.location.href = 'staff-incident-dashboard.html';
                    break;
                case 3: // Waiting Chats
                    window.location.href = 'staff-chat.html';
                    break;
            }
        });
        
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(-5px)';
        });
    });
}

// Load dashboard statistics from Firestore - REAL-TIME VERSION
async function loadDashboardStats() {
    try {
        // 1. Total Residents - Real-time
        onSnapshot(collection(db, "residents"), (snapshot) => {
            document.getElementById('total-residents').textContent = snapshot.size;
            document.getElementById('residents-change').textContent = `Total in system`;
        });

        // 2. Pending Document Requests - Real-time
        const pendingDocsQuery = query(
            collection(db, "documentRequests"),
            where("status", "==", "pending")
        );
        
        onSnapshot(pendingDocsQuery, (snapshot) => {
            const pendingDocs = snapshot.size;
            
            document.getElementById('pending-documents').textContent = pendingDocs;
            if (pendingDocs > 0) {
                document.getElementById('documents-change').textContent = `Requires attention`;
                document.getElementById('documents-change').classList.remove('positive');
            } else {
                document.getElementById('documents-change').textContent = `All caught up!`;
                document.getElementById('documents-change').classList.add('positive');
            }
        });

        // 3. Unassigned Incidents - Real-time
        onSnapshot(collection(db, "incidentReports"), (snapshot) => {
            let unassignedCount = 0;

            snapshot.forEach((doc) => {
                const data = doc.data();
                const isUnassigned = !data.assignedTo || data.assignedTo === null || data.assignedTo === "";
                const isNewSubmission = data.status === 'submitted';
                
                if (isUnassigned && isNewSubmission) {
                    unassignedCount++;
                }
            });

            console.log("🔢 Unassigned NEW Incidents:", unassignedCount);
            
            document.getElementById('my-incidents').textContent = unassignedCount;
            if (unassignedCount > 0) {
                document.getElementById('incidents-change').textContent = `Need assignment`;
                document.getElementById('incidents-change').classList.add('negative');
                document.getElementById('incidents-change').classList.remove('positive');
            } else {
                document.getElementById('incidents-change').textContent = `All assigned`;
                document.getElementById('incidents-change').classList.add('positive');
                document.getElementById('incidents-change').classList.remove('negative');
            }
        });

        // 4. Waiting Chats - Real-time
        const waitingChatsQuery = query(
            collection(db, "chats"),
            where("status", "==", "waiting"),
            where("unreadStaff", "==", true)
        );
        
        onSnapshot(waitingChatsQuery, (snapshot) => {
            const waitingChats = snapshot.size;
            
            document.getElementById('waiting-chats').textContent = waitingChats;
            if (waitingChats > 0) {
                document.getElementById('chats-change').textContent = `Need response`;
                document.getElementById('chats-change').classList.remove('positive');
            } else {
                document.getElementById('chats-change').textContent = `All caught up!`;
                document.getElementById('chats-change').classList.add('positive');
            }
        });

    } catch (error) {
        console.error("Error loading dashboard stats:", error);
        document.querySelectorAll('.stat-value').forEach(el => {
            if (el.querySelector('.loading-spinner')) {
                el.innerHTML = '<span style="font-size: 16px; color: #f5576c;">Error</span>';
            }
        });
    }
}

// Load recent activity feed (simplified to avoid complex indexes)
async function loadRecentActivity() {
    try {
        const activityList = document.getElementById('activity-list');
        activityList.innerHTML = '';

        const activities = [];

        // Fetch recent incidents assigned to this staff member
        // Using only assignedTo filter to avoid complex index requirement
        const myIncidentsQuery = query(
            collection(db, "incidentReports"),
            where("assignedTo", "==", currentStaffUid),
            limit(10)
        );
        const myIncidentsSnapshot = await getDocs(myIncidentsQuery);
        
        myIncidentsSnapshot.forEach(doc => {
            const data = doc.data();
            
            let title = 'Incident assigned';
            let color = '#4facfe';
            let icon = 'fa-exclamation-triangle';
            
            if (data.status === 'acknowledged') {
                title = 'Incident acknowledged';
                color = '#ffa726';
            } else if (data.status === 'in-progress') {
                title = 'Incident in progress';
                color = '#667eea';
            } else if (data.status === 'resolved') {
                title = 'Incident resolved';
                color = '#43e97b';
                icon = 'fa-check-circle';
            }
            
            const incidentType = formatIncidentType(data.incidentType);
            
            activities.push({
                type: 'incident',
                icon: icon,
                color: color,
                title: title,
                description: `${incidentType} - ${data.location || 'Unknown location'}`,
                timestamp: data.updatedAt || data.createdAt,
                status: data.status
            });
        });

        // Fetch recent chats (simplified query)
        const myChatsQuery = query(
            collection(db, "chats"),
            where("status", "in", ["active", "waiting"]),
            limit(10)
        );
        const myChatsSnapshot = await getDocs(myChatsQuery);
        
        myChatsSnapshot.forEach(doc => {
            const data = doc.data();
            
            activities.push({
                type: 'chat',
                icon: 'fa-comments',
                color: '#43e97b',
                title: data.status === 'waiting' ? 'New chat waiting' : 'Active chat',
                description: `From ${data.residentName || data.residentEmail}`,
                timestamp: data.lastMessage?.timestamp || data.createdAt,
                status: data.status
            });
        });

        // Sort by timestamp (most recent first)
        activities.sort((a, b) => {
            const timeA = a.timestamp?.seconds || 0;
            const timeB = b.timestamp?.seconds || 0;
            return timeB - timeA;
        });

        // Display top 10 activities
        const topActivities = activities.slice(0, 10);

        if (topActivities.length === 0) {
            activityList.innerHTML = `
                <div class="activity-item">
                    <div class="activity-icon" style="background: #718096;">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div class="activity-details">
                        <p class="activity-title">No recent activity</p>
                        <p class="activity-desc">Your activity will appear here</p>
                    </div>
                </div>
            `;
            return;
        }

        topActivities.forEach(activity => {
            const timeAgo = getTimeAgo(activity.timestamp);
            
            const activityItem = document.createElement('div');
            activityItem.className = 'activity-item';
            activityItem.innerHTML = `
                <div class="activity-icon" style="background: ${activity.color};">
                    <i class="fas ${activity.icon}"></i>
                </div>
                <div class="activity-details">
                    <p class="activity-title">${activity.title}</p>
                    <p class="activity-desc">${activity.description}</p>
                    <span class="activity-time">${timeAgo}</span>
                </div>
            `;
            
            activityList.appendChild(activityItem);
        });

    } catch (error) {
        console.error("Error loading recent activity:", error);
        document.getElementById('activity-list').innerHTML = `
            <div class="activity-item">
                <div class="activity-icon" style="background: #f5576c;">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="activity-details">
                    <p class="activity-title">Error loading activity</p>
                    <p class="activity-desc">Please refresh the page</p>
                </div>
            </div>
        `;
    }
}

// Helper: Format incident type
function formatIncidentType(type) {
    const types = {
        'noise': 'Noise Complaint',
        'dispute': 'Neighborhood Dispute',
        'vandalism': 'Vandalism',
        'theft': 'Theft',
        'public_safety': 'Public Safety',
        'infrastructure': 'Infrastructure Issue',
        'other': 'Other'
    };
    return types[type] || type;
}

// Helper: Get "time ago" text
function getTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    
    try {
        const now = new Date();
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
        const seconds = Math.floor((now - date) / 1000);

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
        
        return date.toLocaleDateString();
    } catch (error) {
        console.error('Error formatting timestamp:', error);
        return 'Recently';
    }
}