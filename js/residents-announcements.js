import { db, auth } from "../firebase-config.js";
import { 
    collection, getDocs, query, orderBy, limit, startAfter, onSnapshot, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// Firestore reference
const announcementsRef = collection(db, "announcements");

// DOM Elements
const announcementList = document.getElementById("announcement-list");
const loadMoreButton = document.getElementById("load-more");
const backButton = document.getElementById("back-button");

// Global variables
let lastVisible = null;
const PAGE_SIZE = 5;
let isLoading = false;
let loadedAnnouncements = new Set();

// ========== AUTHENTICATION ==========

// Function to check if the user is a resident
async function isResident(user) {
    if (!user) return false;
    const residentRef = doc(db, "residents", user.email);
    const residentSnap = await getDoc(residentRef);
    return residentSnap.exists();
}

// Handle Authentication & Role-Based Access
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("🚫 No user logged in. Redirecting to login.");
        window.location.href = "../index.html";
        return;
    }

    const isUserResident = await isResident(user);

    if (!isUserResident) {
        console.warn("🚫 Unauthorized access. Redirecting...");
        await signOut(auth);
        window.location.href = "../index.html";
        return;
    }

    console.log("✅ User verified as Resident.");
    
    // Get resident data and display name
    const residentRef = doc(db, "residents", user.email);
    const residentSnap = await getDoc(residentRef);
    
    if (residentSnap.exists()) {
        const residentData = residentSnap.data();
        const fullName = `${residentData.firstName || ''} ${residentData.lastName || ''}`.trim() || 'Resident';
        
        const welcomeMsg = document.getElementById("user-welcome");
        if (welcomeMsg) {
            welcomeMsg.textContent = fullName;
        }
    }
    
    // Initialize page
    initializePage();
});

// Initialize page
function initializePage() {
    setupBackButton();
    setupLogout();
    loadAnnouncements(true);
    setupRealTimeListener();
    updateStats();
}

// Setup back button
function setupBackButton() {
    if (backButton) {
        backButton.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'dashboard-resident.html';
        });
    }
}

// Setup logout
function setupLogout() {
    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                await signOut(auth);
                window.location.href = '../index.html';
            }
        });
    }
}

// Update statistics
async function updateStats() {
    try {
        const allDocs = await getDocs(announcementsRef);
        const total = allDocs.size;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let todayCount = 0;
        allDocs.forEach(doc => {
            const data = doc.data();
            const announcementDate = data.date?.toDate ? data.date.toDate() : new Date(data.date);
            announcementDate.setHours(0, 0, 0, 0);
            if (announcementDate.getTime() === today.getTime()) {
                todayCount++;
            }
        });
        
        const totalElem = document.getElementById('total-announcements');
        const todayElem = document.getElementById('today-announcements');
        
        if (totalElem) totalElem.textContent = total;
        if (todayElem) todayElem.textContent = todayCount;
    } catch (error) {
        console.error("Error updating stats:", error);
    }
}

// ========== FORMAT FUNCTIONS ==========

// Format Time Ago
function formatTimeAgo(timestamp) {
    if (!timestamp) return "Unknown time";
    const now = new Date();
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

// Sanitize text and add links
function sanitizeText(text) {
    return text
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        .trim();
}

// ========== CREATE ANNOUNCEMENT CARD ==========

function createAnnouncementElement(doc) {
    if (loadedAnnouncements.has(doc.id)) return null;
    loadedAnnouncements.add(doc.id);

    const announcement = doc.data();
    const container = document.createElement("div");
    container.classList.add("announcement-card");
    container.setAttribute("data-docid", doc.id);

    // Title HTML
    let titleHTML = '';
    if (announcement.title) {
        titleHTML = `
            <div class="announcement-title">
                <i class="fas fa-bullhorn"></i>
                ${sanitizeText(announcement.title)}
            </div>
        `;
    }

    // Images HTML
    let imagesHTML = "";
    if (announcement.images && Array.isArray(announcement.images) && announcement.images.length > 0) {
        imagesHTML = `<div class="image-container">` + 
            announcement.images.map((image, index) => 
                `<img src="${image}" 
                      class="announcement-img" 
                      data-index="${index}" 
                      data-id="${doc.id}"
                      onerror="this.style.display='none'"
                      onclick="openImageModal('${doc.id}', ${index})">`
            ).join("") + 
            `</div>`;
    }

    // Posted by info
    const postedBy = announcement.postedBy || 'Barangay Admin';
    const timeAgo = formatTimeAgo(announcement.date);
    
    // Date formatting
    const date = announcement.date?.toDate ? announcement.date.toDate() : new Date(announcement.date);
    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Edit indicator
    let editedHTML = '';
    if (announcement.editedAt) {
        const editedDate = new Date(announcement.editedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const editedBy = announcement.editedBy || 'Admin';
        editedHTML = `
            <div class="edited-indicator">
                <i class="fas fa-edit"></i>
                Edited by ${editedBy} on ${editedDate}
            </div>
        `;
    }

    container.innerHTML = `
        <div class="announcement-header">
            <img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'><circle cx='12' cy='8' r='4'/><path d='M2 20c0-4 4-7 10-7s10 3 10 7'/></svg>" 
                 class="profile-pic"
                 alt="Profile">
            <div class="announcement-info">
                <strong>📢 ${postedBy}</strong>
                <small><i class="fas fa-clock"></i> ${timeAgo}</small>
            </div>
        </div>
        
        ${titleHTML}
        
        <p class="announcement-text">${sanitizeText(announcement.text)}</p>
        
        ${imagesHTML}
        
        <div class="posted-info">
            <small><i class="fas fa-calendar"></i> ${formattedDate}</small>
            <small><i class="fas fa-user"></i> Posted by <strong>${postedBy}</strong></small>
        </div>
        
        ${editedHTML}
    `;

    return container;
}

// ========== LOAD ANNOUNCEMENTS ==========

async function loadAnnouncements(initialLoad = false) {
    if (isLoading) return;
    isLoading = true;

    try {
        let q = query(announcementsRef, orderBy("date", "desc"), limit(PAGE_SIZE));
        
        if (lastVisible && !initialLoad) {
            q = query(announcementsRef, orderBy("date", "desc"), startAfter(lastVisible), limit(PAGE_SIZE));
        }

        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            // Remove loading state on initial load
            if (initialLoad) {
                announcementList.innerHTML = '';
            }
            
            lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
            
            querySnapshot.forEach((doc) => {
                if (!loadedAnnouncements.has(doc.id)) {
                    const announcementElement = createAnnouncementElement(doc);
                    if (announcementElement) {
                        announcementList.appendChild(announcementElement);
                    }
                }
            });

            // Show/hide load more button
            loadMoreButton.style.display = querySnapshot.size === PAGE_SIZE ? "block" : "none";
            
        } else if (initialLoad) {
            // Show empty state
            announcementList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bullhorn"></i>
                    <h3>No Announcements Yet</h3>
                    <p>Check back later for community updates and news</p>
                </div>
            `;
            loadMoreButton.style.display = "none";
        }
    } catch (error) {
        console.error("Error loading announcements:", error);
        announcementList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-circle" style="color: #f56565;"></i>
                <h3>Error Loading Announcements</h3>
                <p>${error.message}</p>
            </div>
        `;
    } finally {
        isLoading = false;
    }
}

// ========== REAL-TIME LISTENER ==========

function setupRealTimeListener() {
    onSnapshot(
        query(announcementsRef, orderBy("date", "desc"), limit(1)), 
        (snapshot) => {
            snapshot.forEach((doc) => {
                if (!loadedAnnouncements.has(doc.id)) {
                    const newAnnouncement = createAnnouncementElement(doc);
                    if (newAnnouncement) {
                        // Remove empty state if exists
                        const emptyState = announcementList.querySelector('.empty-state');
                        if (emptyState) {
                            announcementList.innerHTML = '';
                        }
                        
                        // Add new announcement at the top
                        announcementList.prepend(newAnnouncement);
                        
                        // Optional: Show notification
                        console.log("📢 New announcement posted!");
                    }
                }
            });
        },
        (error) => {
            console.error("Error in real-time listener:", error);
        }
    );
}

// ========== IMAGE MODAL ==========

let imageList = [];
let currentIndex = 0;

export function openImageModal(announcementId, index) {
    const images = document.querySelectorAll(`img[data-id="${announcementId}"]`);
    imageList = Array.from(images).map(img => img.src).filter(src => src);
    currentIndex = index;

    const modal = document.getElementById("image-modal");
    const modalImage = document.getElementById("modal-image");
    const counter = document.getElementById("image-counter");

    if (imageList.length > 0 && imageList[currentIndex]) {
        modalImage.src = imageList[currentIndex];
        counter.textContent = `${currentIndex + 1} / ${imageList.length}`;
        modal.classList.add("show");
    }
}

export function closeImageModal() {
    const modal = document.getElementById("image-modal");
    modal.classList.remove("show");
}

export function prevImage() {
    if (currentIndex > 0) {
        currentIndex--;
        const modalImage = document.getElementById("modal-image");
        const counter = document.getElementById("image-counter");
        modalImage.src = imageList[currentIndex];
        counter.textContent = `${currentIndex + 1} / ${imageList.length}`;
    }
}

export function nextImage() {
    if (currentIndex < imageList.length - 1) {
        currentIndex++;
        const modalImage = document.getElementById("modal-image");
        const counter = document.getElementById("image-counter");
        modalImage.src = imageList[currentIndex];
        counter.textContent = `${currentIndex + 1} / ${imageList.length}`;
    }
}

// Setup modal button events
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('close-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const modal = document.getElementById('image-modal');

    if (closeBtn) closeBtn.addEventListener('click', closeImageModal);
    if (prevBtn) prevBtn.addEventListener('click', prevImage);
    if (nextBtn) nextBtn.addEventListener('click', nextImage);
    
    // Close on background click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeImageModal();
            }
        });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (modal && modal.classList.contains('show')) {
            if (e.key === 'Escape') closeImageModal();
            if (e.key === 'ArrowLeft') prevImage();
            if (e.key === 'ArrowRight') nextImage();
        }
    });
});

// ========== LOAD MORE BUTTON ==========

if (loadMoreButton) {
    loadMoreButton.addEventListener("click", () => {
        loadAnnouncements(false);
    });
}