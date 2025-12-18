// captain-dashboard.js - Dashboard logic with real-time data
import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    orderBy, 
    limit,
    Timestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { protectPage } from "./navigation-helper.js";
import { getUserData } from "./auth-helper.js";

// Authentication and page protection
onAuthStateChanged(auth, async (user) => {
    const authResult = await protectPage(auth);
    
    if (!authResult) return;
    
    const { role } = authResult;
    
    // Double-check that user is captain
    if (role !== 'captain') {
        alert('Access denied. This is the Captain dashboard.');
        window.location.href = 'dashboard-staff.html';
        return;
    }
    
    // Get full user data and display name
    const userData = await getUserData(user);
    if (userData) {
        const welcomeMsg = document.getElementById("captain-welcome");
        if (welcomeMsg) {
            welcomeMsg.textContent = userData.fullName || 'Captain';
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

// Setup clickable stat cards
function setupStatCardLinks() {
    // Make all stat cards clickable
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
                case 2: // Active Incidents
                    window.location.href = 'staff-incident-dashboard.html';
                    break;
                case 3: // Unread Chats
                    window.location.href = 'staff-chat.html';
                    break;
            }
        });
        
        // Add hover effect
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(-5px)';
        });
    });
}

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

async function loadDashboardStats() {
    try {
        // 1. Total Residents - REAL-TIME
        onSnapshot(collection(db, "residents"), (snapshot) => {
            document.getElementById('total-residents').textContent = snapshot.size;
            document.getElementById('residents-change').textContent = `Total in system`;
        });

        // 2. Pending Documents - REAL-TIME
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

        // 3. Unassigned Incidents - REAL-TIME
        onSnapshot(collection(db, "incidentReports"), (snapshot) => {
            let unassignedCount = 0;
            snapshot.forEach(doc => {
                const data = doc.data();
                const isUnassigned = !data.assignedTo || data.assignedTo === null || data.assignedTo === '';
                const isActive = data.status === 'submitted' || data.status === 'acknowledged';
                
                if (isUnassigned && isActive) {
                    unassignedCount++;
                }
            });
            
            document.getElementById('active-incidents').textContent = unassignedCount;
            
            if (unassignedCount > 0) {
                document.getElementById('incidents-change').textContent = `Unassigned reports`;
                document.getElementById('incidents-change').classList.add('negative');
                document.getElementById('incidents-change').classList.remove('positive');
            } else {
                document.getElementById('incidents-change').textContent = `All assigned`;
                document.getElementById('incidents-change').classList.add('positive');
                document.getElementById('incidents-change').classList.remove('negative');
            }
        });

        // 4. Unread Chats - REAL-TIME
        const unreadChatsQuery = query(
            collection(db, "chats"),
            where("status", "==", "waiting"),
            where("unreadStaff", "==", true)
        );
        onSnapshot(unreadChatsQuery, (snapshot) => {
            const unreadChats = snapshot.size;
            document.getElementById('unread-chats').textContent = unreadChats;
            
            if (unreadChats > 0) {
                document.getElementById('chats-change').textContent = `Waiting for response`;
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

// Load recent activity feed
async function loadRecentActivity() {
    try {
        const activityList = document.getElementById('activity-list');
        activityList.innerHTML = ''; // Clear loading state

        const activities = [];

        // Fetch recent document requests (last 10)
        const docsQuery = query(
            collection(db, "documentRequests"),
            orderBy("requestDate", "desc"),
            limit(10)
        );
        const docsSnapshot = await getDocs(docsQuery);
        
        docsSnapshot.forEach(doc => {
            const data = doc.data();
            
            let title = 'Document request';
            let icon = 'fa-file-alt';
            let color = '#667eea';
            
            if (data.status === 'pending') {
                title = 'New document request';
                color = '#f093fb';
            } else if (data.status === 'approved') {
                title = 'Document approved';
                icon = 'fa-check-circle';
                color = '#43e97b';
            } else if (data.status === 'rejected') {
                title = 'Document rejected';
                icon = 'fa-times-circle';
                color = '#f5576c';
            }
            
            activities.push({
                type: 'document',
                icon: icon,
                color: color,
                title: title,
                description: `${data.residentName || 'Resident'} - ${data.documentType}`,
                timestamp: data.requestDate,
                status: data.status
            });
        });

        // Fetch recent incident reports (last 10)
        const incidentsQuery = query(
            collection(db, "incidentReports"),
            orderBy("createdAt", "desc"),
            limit(10)
        );
        const incidentsSnapshot = await getDocs(incidentsQuery);
        
        incidentsSnapshot.forEach(doc => {
            const data = doc.data();
            
            let title = 'Incident report';
            let color = '#4facfe';
            
            if (data.status === 'submitted') {
                title = 'New incident report';
                color = '#f5576c';
            } else if (data.status === 'resolved') {
                title = 'Incident resolved';
                color = '#43e97b';
            } else if (data.status === 'in-progress') {
                title = 'Incident in progress';
                color = '#ffa726';
            }
            
            const incidentType = formatIncidentType(data.incidentType);
            
            activities.push({
                type: 'incident',
                icon: 'fa-exclamation-triangle',
                color: color,
                title: title,
                description: `${incidentType} - ${data.location || 'Unknown location'}`,
                timestamp: data.createdAt,
                status: data.status
            });
        });

        // Sort all activities by timestamp (most recent first)
        activities.sort((a, b) => {
            const timeA = a.timestamp?.seconds || 0;
            const timeB = b.timestamp?.seconds || 0;
            return timeB - timeA;
        });

        // Display top 15 most recent activities
        const topActivities = activities.slice(0, 15);

        if (topActivities.length === 0) {
            activityList.innerHTML = `
                <div class="activity-item">
                    <div class="activity-icon" style="background: #718096;">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div class="activity-details">
                        <p class="activity-title">No recent activity</p>
                        <p class="activity-desc">Activity will appear here as it happens</p>
                    </div>
                </div>
            `;
            return;
        }

        // Render activity items
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