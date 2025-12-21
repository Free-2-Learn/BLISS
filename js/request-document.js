import { db, auth } from "../firebase-config.js";
import { collection, addDoc, getDocs, query, where, doc, getDoc, Timestamp, updateDoc, deleteDoc, setDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { onAuthStateChanged, signOut} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { arrayUnion } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";



// Firestore Reference
const requestCollection = collection(db, "documentRequests");
 
// DOM Elements

const requestModal = document.getElementById("request-modal");
const openModalButton = document.getElementById("open-modal-btn");
const closeModalButton = document.getElementById("close-modal-btn");
const requestForm = document.getElementById("request-form");
const documentTypeSelect = document.getElementById("document-type");
const otherDocumentInput = document.getElementById("custom-document-type");
const requestNoteInput = document.getElementById("request-note");
const pendingRequestsContainer = document.getElementById("pending-requests-container");
const completedRequestsContainer = document.getElementById("completed-requests-container");
const residentNameDisplay = document.getElementById("resident-name");

const APP_CONFIG = {
  // ⚠️ IMPORTANT: Change this to your actual deployed website URL
  PRODUCTION_URL: 'https://free-2-learn.github.io/BLISS/', // Your GitHub Pages URL
  
  // Smart URL detection
  getBaseURL() {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || 
        hostname === '127.0.0.1' || 
        hostname.startsWith('192.168') ||
        hostname.startsWith('10.0')) {
      console.log('🔧 Local environment detected, using production URL for QR codes');
      return this.PRODUCTION_URL;
    }
    
    console.log('🌐 Production environment detected, using current domain');
    return window.location.origin;
  },
  
  // Get document viewer URL
  getDocumentViewerURL(verificationCode, requestId) {
    return `${this.getBaseURL()}/view-document.html?code=${verificationCode}&id=${requestId}`;
  }
};

let isSubmitting = false;

// NEW: Filter state
let currentFilters = {
  search: '',
  status: 'all'
};

// Function to check if the user is a resident
async function getResidentData(user) {
    if (!user) return null;

    try {
        const residentRef = doc(db, "residents", user.email);
        const residentSnap = await getDoc(residentRef);

        if (residentSnap.exists()) {
            return residentSnap.data();
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error fetching resident data:", error);
        return null;
    }
}

// Handle Authentication & Role-Based Access
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("No user logged in. Redirecting to login.");
        window.location.href = "../index.html";
        return;
    }

    const residentData = await getResidentData(user);

    if (!residentData) {
        console.warn("Unauthorized access. Redirecting...");
        await signOut(auth);
        window.location.href = "../index.html";
        return;
    }

    console.log("User verified as Resident:", residentData);

    // Store resident data in sessionStorage
    sessionStorage.setItem("residentData", JSON.stringify(residentData));

    // Update UI
    updateResidentName(residentData);
    loadRequests();
});

// Update Resident Name Display
function updateResidentName(residentData) {
    if (!residentData || !residentData.firstName || !residentData.lastName) {
        residentNameDisplay.innerText = "Logged in as: Unknown Resident";
        return;
    }

    const fullName = `${residentData.firstName} ${residentData.lastName}`;
    residentNameDisplay.innerText = `Logged in as: ${fullName}`;
}

// Open Modal
openModalButton.addEventListener("click", () => {
    requestModal.showModal();
});

// Close Modal
closeModalButton.addEventListener("click", () => {
    requestModal.close();
});

// Submit Document Request
async function submitRequest(event) {
    event.preventDefault();

    if (isSubmitting) return;
    isSubmitting = true;

    const submitBtn = document.querySelector("#request-form button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    const documentTypeSelect = document.getElementById("document-type");
    const requestNoteInput = document.getElementById("request-note");
    const requestForm = document.getElementById("request-form");
    const requestModal = document.getElementById("request-modal");
    const requestCollection = collection(db, "documentRequests");

    const documentType = documentTypeSelect.value;
    const requestNote = requestNoteInput.value.trim();
    const residentData = JSON.parse(sessionStorage.getItem("residentData"));

    // ✅ FIXED: Removed "Others" validation
    if (!documentType || !requestNote) {
        alert("Please complete all fields.");
        resetSubmitButton(submitBtn);
        return;
    }

    if (!residentData) {
        alert("Error: Could not retrieve resident data. Please log in again.");
        resetSubmitButton(submitBtn);
        return;
    }

    const fullName = `${residentData.firstName} ${residentData.lastName}`;

    const newRequest = {
        residentId: residentData.email,
        residentName: fullName,
        documentType: documentType, // ✅ FIXED: No more ternary for "Others"
        purpose: requestNote,
        status: "pending",
        requestedAt: Timestamp.now(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        documentUrl: null,
        qrCodeData: null,
        verificationCode: null
    };

    try {
        const userRequestsQuery = query(
            requestCollection, 
            where("residentId", "==", residentData.email)
        );
        const userRequestsSnapshot = await getDocs(userRequestsQuery);

        let maxRequestNum = 0;
        userRequestsSnapshot.forEach((docSnap) => {
            const docId = docSnap.id;

            if (docId.startsWith(residentData.firstName + "-")) {
                const parts = docId.split("-");
                const num = parseInt(parts[parts.length - 1]);
                if (!isNaN(num) && num > maxRequestNum) {
                    maxRequestNum = num;
                }
            }
        });

        const requestNumber = maxRequestNum + 1;
        const customDocId = `${residentData.firstName}-${requestNumber}`;

        const { setDoc } = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js");

        const docRef = doc(db, "documentRequests", customDocId);
        await setDoc(docRef, newRequest);

        await logDocumentHistory(customDocId, "created", {
            documentType: newRequest.documentType,
            purpose: newRequest.purpose
        });

        await logActivity("requested_document", {
            documentType: newRequest.documentType,
            requestId: customDocId,
            purpose: newRequest.purpose
        });

        alert("Your request has been submitted.");
        requestForm.reset();
        requestModal.close();
        loadRequests();

    } catch (error) {
        console.error("Error submitting request:", error);
        alert("Failed to submit request.");
    }

    resetSubmitButton(submitBtn);
}

// Function to format Firestore Timestamp into "March 31, 2025, 4:41 PM"
function formatDate(date) {
    return date.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
  
let pendingRequests = [];
let requests = []; // NEW: Store all requests

async function loadRequests() {
    const residentData = JSON.parse(sessionStorage.getItem("residentData"));
    if (!residentData) return;

    const userId = residentData.email;

    pendingRequestsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><h4>Loading...</h4></div>';
    completedRequestsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><h4>Loading...</h4></div>';

    try {
        const q = query(requestCollection, where("residentId", "==", userId));
        const querySnapshot = await getDocs(q);

        pendingRequests = [];
        requests = [];
        let completedRequests = [];

        querySnapshot.forEach((docSnap) => {
            const req = { id: docSnap.id, ...docSnap.data() };

            // Convert Firestore Timestamp to JavaScript Date
            if (req.requestedAt && req.requestedAt.seconds) {
                req.requestedAt = new Date(req.requestedAt.seconds * 1000);
            } else if (req.requestedAt) {
                req.requestedAt = new Date(req.requestedAt);
            }

            requests.push(req);

            if (req.status === "pending") {
                pendingRequests.push(req);
            } else {
                completedRequests.push(req);
            }
        });

        // Sort by date (newest first)
        pendingRequests.sort((a, b) => b.requestedAt - a.requestedAt);
        completedRequests.sort((a, b) => b.requestedAt - a.requestedAt);

        // ✅ ONLY USE RENDER FUNCTIONS (remove duplicate forEach loops)
        renderPendingCards(pendingRequests);
        renderCompletedCards(completedRequests);

        // Update stats and initialize filters
        updateDashboardStats();
        initializeFilters();

    } catch (error) {
        console.error("Error loading requests:", error);
            pendingRequestsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><h4>Failed to load</h4></div>';
            completedRequestsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><h4>Failed to load</h4></div>';
    }
}

function updateDashboardStats() {
  const residentData = JSON.parse(sessionStorage.getItem("residentData"));
  if (!residentData) return;

  // Count pending
  const pendingCount = pendingRequests.length;
  
  // Count approved
  const approvedCount = requests.filter(req => req.status === "approved").length;
  
  // Count rejected
  const rejectedCount = requests.filter(req => req.status === "rejected").length;
  
  // Total requests
  const totalCount = requests.length;
  
  // Update DOM
  document.getElementById("pending-count").textContent = pendingCount;
  document.getElementById("approved-count").textContent = approvedCount;
  document.getElementById("rejected-count").textContent = rejectedCount;
  document.getElementById("total-count").textContent = totalCount;
}

// Initialize filters
function initializeFilters() {
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  
  if (!searchInput || !statusFilter) return;
  
  searchInput.addEventListener('input', (e) => {
    currentFilters.search = e.target.value.toLowerCase();
    renderFilteredRequests();
  });
  
  statusFilter.addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    renderFilteredRequests();
  });
}

// Reset filters
window.resetFilters = function() {
  currentFilters = {
    search: '',
    status: 'all'
  };
  
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  
  if (searchInput) searchInput.value = '';
  if (statusFilter) statusFilter.value = 'all';
  
  renderFilteredRequests();
};

// Apply filters and re-render
function renderFilteredRequests() {
  let filteredPending = [...pendingRequests];
  let filteredCompleted = requests.filter(r => r.status !== "pending");
  
  // Apply search filter
  if (currentFilters.search) {
    filteredPending = filteredPending.filter(req => 
      req.documentType.toLowerCase().includes(currentFilters.search) ||
      req.purpose.toLowerCase().includes(currentFilters.search)
    );
    
    filteredCompleted = filteredCompleted.filter(req => 
      req.documentType.toLowerCase().includes(currentFilters.search) ||
      req.purpose.toLowerCase().includes(currentFilters.search)
    );
  }
  
  // Apply status filter
  if (currentFilters.status !== 'all') {
    if (currentFilters.status === 'pending') {
      filteredCompleted = [];
    } else {
      filteredPending = [];
      filteredCompleted = filteredCompleted.filter(req => req.status === currentFilters.status);
    }
  }
  
  // Re-render tables
    renderPendingCards(filteredPending);
    renderCompletedCards(filteredCompleted);
}

// Render pending requests table
function renderPendingCards(requestsToRender) {
  pendingRequestsContainer.innerHTML = "";
  
  if (requestsToRender.length === 0) {
    pendingRequestsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h4>No pending requests</h4>
        <p>You don't have any pending document requests at the moment</p>
      </div>`;
    return;
  }
  
  requestsToRender.forEach((request) => {
    const card = document.createElement("div");
    card.className = "request-card";
    card.style.setProperty('--card-color', '#FFA726');
    
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <h4>${request.documentType}</h4>
          <div class="card-subtitle">${request.residentName || "Unknown"}</div>
        </div>
        <span class="status-badge status-${request.status}">
          ⏳ Pending
        </span>
      </div>
      
      <div class="card-content">
        <div class="info-row">
          <span class="info-icon">📝</span>
          <div class="info-text">
            <div class="info-label">Purpose</div>
            <div class="info-value">${request.purpose}</div>
          </div>
        </div>
        
        <div class="info-row">
          <span class="info-icon">📅</span>
          <div class="info-text">
            <div class="info-label">Date Requested</div>
            <div class="info-value">${formatDate(request.requestedAt)}</div>
          </div>
        </div>
      </div>
      
      <div class="card-actions">
        <button class="btn btn-edit" data-id="${request.id}">
          ✏️ Edit
        </button>
        <button class="btn btn-cancel" data-id="${request.id}">
          ❌ Cancel
        </button>
      </div>
    `;
    
    pendingRequestsContainer.appendChild(card);
  });
  
  document.querySelectorAll(".btn-edit").forEach(button => {
    button.addEventListener("click", openEditModal);
  });
  document.querySelectorAll(".btn-cancel").forEach(button => {
    button.addEventListener("click", cancelRequest);
  });
}

// Render completed requests table
function renderCompletedCards(requestsToRender) {
  completedRequestsContainer.innerHTML = "";
  
  if (requestsToRender.length === 0) {
    completedRequestsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h4>No completed requests yet</h4>
        <p>Completed requests will appear here once they're approved or rejected</p>
      </div>`;
    return;
  }
  
  requestsToRender.forEach((request) => {
    const card = document.createElement("div");
    card.className = "request-card";
    
    const cardColor = request.status === 'approved' ? '#4CAF50' : '#EF5350';
    card.style.setProperty('--card-color', cardColor);
    
    const statusIcon = request.status === 'approved' ? '✓' : '✗';
    const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);
    
    let reviewedDate = "N/A";
    if (request.reviewedAt) {
      const date = request.reviewedAt.seconds 
        ? new Date(request.reviewedAt.seconds * 1000) 
        : new Date(request.reviewedAt);
      reviewedDate = formatDate(date);
    }
    
    const comment = request.rejectionReason || "No comment provided";
    
    let actionButtons = '';
    if (request.status === "approved" && request.documentUrl) {
      actionButtons = `
        <button class="btn btn-view" onclick="window.open('${request.documentUrl}', '_blank'); window.logActivity('viewed_document', {requestId: '${request.id}', documentType: '${request.documentType}'});">
          📄 View PDF
        </button>
        ${request.verificationCode ? `
          <button class="btn btn-qr" onclick="window.downloadResidentQR('${request.id}', '${request.verificationCode}', '${request.documentType}')">
            📱 QR Code
          </button>
        ` : ''}
      `;
    } else if (request.status === "approved" && !request.documentUrl) {
      actionButtons = `
        <div style="text-align: center; color: #FFA726; font-size: 13px;">
          <span class="spinner"></span> Generating document...
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <h4>${request.documentType}</h4>
          <div class="card-subtitle">${request.residentName || "Unknown"}</div>
        </div>
        <span class="status-badge status-${request.status}">
          ${statusIcon} ${statusText}
        </span>
      </div>
      
      <div class="card-content">
        <div class="info-row">
          <span class="info-icon">📝</span>
          <div class="info-text">
            <div class="info-label">Purpose</div>
            <div class="info-value">${request.purpose}</div>
          </div>
        </div>
        
        <div class="info-row">
          <span class="info-icon">📅</span>
          <div class="info-text">
            <div class="info-label">Date Requested</div>
            <div class="info-value">${formatDate(request.requestedAt)}</div>
          </div>
        </div>
        
        <div class="info-row">
          <span class="info-icon">✓</span>
          <div class="info-text">
            <div class="info-label">${statusText} At</div>
            <div class="info-value">${reviewedDate}</div>
          </div>
        </div>
        
        <div class="info-row">
          <span class="info-icon">💬</span>
          <div class="info-text">
            <div class="info-label">Captain's Comment</div>
            <div class="info-value">${comment}</div>
          </div>
        </div>
      </div>
      
      ${actionButtons ? `<div class="card-actions">${actionButtons}</div>` : ''}
    `;
    
    completedRequestsContainer.appendChild(card);
  });
}

// Event Listener for Form Submission
requestForm.addEventListener("submit", submitRequest);

// Open Edit Modal and Pre-fill Data
function openEditModal(event) {
    const requestId = event.target.dataset.id;
    const request = pendingRequests.find(req => req.id === requestId);

    if (!request) {
        console.error("Request not found.");
        return;
    }

    document.getElementById("edit-request-id").value = requestId;
    document.getElementById("edit-document-type").value = request.documentType;
    document.getElementById("edit-request-note").value = request.purpose;

    // ✅ REMOVED: No more checking for "Others" since we removed that option
    
    document.getElementById("edit-request-modal").showModal();
}

// Save Edited Request to Firestore
async function saveEditedRequest(event) {
    event.preventDefault();

    if (isSubmitting) return;
    isSubmitting = true;

    const saveBtn = document.querySelector("#edit-request-form button[type='submit']");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const requestId = document.getElementById("edit-request-id").value;
    const documentType = document.getElementById("edit-document-type").value;
    const requestNote = document.getElementById("edit-request-note").value.trim();

    // ✅ FIXED: Removed check for "Others" option
    if (!documentType || !requestNote) {
        alert("Please complete all fields.");
        resetSubmitButton(saveBtn);
        return;
    }

    const updatedRequest = {
        documentType: documentType, // ✅ FIXED: No more ternary for "Others"
        purpose: requestNote,
        requestedAt: Timestamp.fromDate(new Date())
    };

    try {
        const requestRef = doc(db, "documentRequests", requestId);
        await updateDoc(requestRef, updatedRequest);

        await logDocumentHistory(requestId, "edited", {
            newDocumentType: updatedRequest.documentType,
            newPurpose: updatedRequest.purpose
        });

        await logActivity("edited_request", {
            requestId: requestId,
            documentType: updatedRequest.documentType,
            purpose: updatedRequest.purpose
        });

        alert("Request updated successfully.");
        document.getElementById("edit-request-modal").close();
        loadRequests();
    } catch (error) {
        console.error("Error updating request:", error);
        alert("Failed to update request.");
    }

    resetSubmitButton(saveBtn);
}


// Cancel Request and Delete from Firestore
async function cancelRequest(event) {
    const requestId = event.target.dataset.id;
    const confirmDelete = confirm("Are you sure you want to cancel this request?");
    if (!confirmDelete) return;

    try {
        const requestRef = doc(db, "documentRequests", requestId);

        // Save history before deleting
        await logDocumentHistory(requestId, "cancelled", {
            reason: "User cancelled the request"
        });

        // Log global activity
        await logActivity("cancelled_request", { requestId });

        // Delete request
        await deleteDoc(requestRef);

        alert("Request cancelled successfully.");
        loadRequests();

    } catch (error) {
        console.error("Error cancelling request:", error);
        alert("Failed to cancel request.");
    }
}

async function logActivity(action, details = {}) {
    const user = auth.currentUser;
    if (!user) return;

    const residentData = JSON.parse(sessionStorage.getItem("residentData"));
    if (!residentData) return;

    const userId = residentData.email.toLowerCase(); // ← CHANGED: Added .toLowerCase()
    const fullName = `${residentData.firstName} ${residentData.lastName}`;

    try {
        const logRef = doc(db, "activityLogs", userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: "resident",
            activities: arrayUnion({
                action: action,
                details: details,
                timestamp: Timestamp.now() // ← CHANGED: Use Timestamp.now() instead of Timestamp.now()
            })
        }, { merge: true });

    } catch (error) {
        console.error("Error writing global activity log:", error);
    }
}

async function logDocumentHistory(docId, action, details = {}) {
    const residentData = JSON.parse(sessionStorage.getItem("residentData"));
    if (!residentData) return;

    const fullName = `${residentData.firstName} ${residentData.lastName}`;

    try {
        const historyRef = collection(db, "documentHistory", docId, "logs");

        await addDoc(historyRef, {
            action: action,
            userId: residentData.email.toLowerCase(), // ← CHANGED: Added .toLowerCase()
            userName: fullName,
            timestamp: Timestamp.now(), // Keep this as is for subcollection
            details: details
        });

        console.log("History saved for", docId);

    } catch (error) {
        console.error("Error writing document history:", error);
    }
}

function resetSubmitButton(button) {
    isSubmitting = false;
    button.disabled = false;
    
    // Restore original button text based on which form it belongs to
    if (button.closest("#request-form")) {
        button.textContent = "Submit Request";
    } else if (button.closest("#edit-request-form")) {
        button.textContent = "Save Changes";
    }
}

window.logActivity = logActivity;

// Download QR code for resident
window.downloadResidentQR = function(requestId, verificationCode, documentType) {
  try {
    const residentData = JSON.parse(sessionStorage.getItem("residentData"));
    const residentName = residentData ? `${residentData.firstName} ${residentData.lastName}` : "Resident";
    
    // ✅ UPDATED: Use document viewer URL instead of verify.html
    const qrCodeData = APP_CONFIG.getDocumentViewerURL(verificationCode, requestId);
    
    console.log("📱 Generating QR Code for:", qrCodeData);
    
    const qr = new QRious({
      value: qrCodeData,
      size: 400,
      level: 'H'
    });
    
    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 500;
    canvas.height = 620;
    
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Title
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('BARANGAY LIPAY', canvas.width / 2, 40);
    
    // Subtitle
    ctx.font = '16px Arial';
    ctx.fillText('Document Access Portal', canvas.width / 2, 65);
    
    // Info
    ctx.font = '14px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText('Villasis, Pangasinan', canvas.width / 2, 85);
    
    // Document type
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`Document: ${documentType}`, canvas.width / 2, 110);
    
    // QR code
    const qrImage = new Image();
    qrImage.src = qr.toDataURL();
    qrImage.onload = function() {
      ctx.drawImage(qrImage, 50, 130, 400, 400);
      
      // Instructions
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = '#667eea';
      ctx.fillText('📱 Scan to View & Download Document', canvas.width / 2, 550);
      
      // Verification code
      ctx.font = '14px monospace';
      ctx.fillStyle = '#000000';
      ctx.fillText(`Code: ${verificationCode}`, canvas.width / 2, 575);
      
      // Footer note
      ctx.font = '12px Arial';
      ctx.fillStyle = '#999999';
      ctx.fillText('Scan with any QR code scanner app', canvas.width / 2, 600);
      
      // Download
      canvas.toBlob(function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `QR_${documentType.replace(/\s+/g, '_')}_${verificationCode}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log("✅ QR Code downloaded successfully");
        
        // Log activity
        logActivity("downloaded_qr", {
          requestId: requestId,
          documentType: documentType,
          verificationCode: verificationCode
        });
      });
    };
    
  } catch (error) {
    console.error("Error generating QR code:", error);
    alert("Failed to generate QR code. Please try again.");
  }
};

// Attach Event Listeners
document.getElementById("edit-request-form").addEventListener("submit", saveEditedRequest);
document.getElementById("close-edit-modal-btn").addEventListener("click", () => {
    document.getElementById("edit-request-modal").close();
});

/* ========================================
   SIDEBAR JAVASCRIPT
   Add this to your main JS file or at the bottom of your HTML
   ======================================== */

// Sidebar Toggle for Mobile
document.getElementById('menu-toggle')?.addEventListener('click', function() {
    document.getElementById('sidebar').classList.add('active');
});

document.getElementById('close-sidebar')?.addEventListener('click', function() {
    document.getElementById('sidebar').classList.remove('active');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menu-toggle');
    
    if (sidebar && menuToggle && sidebar.classList.contains('active')) {
        if (!sidebar.contains(event.target) && event.target !== menuToggle) {
            sidebar.classList.remove('active');
        }
    }
});

// Close sidebar when pressing Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
        }
    }
});

// Logout handler
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        // Add your logout logic here
        // For example:
        // firebase.auth().signOut();
        window.location.href = '../index.html';
    }
}

// Make handleLogout globally accessible
window.handleLogout = handleLogout;

// Set active nav item based on current page
window.addEventListener('DOMContentLoaded', function() {
    const currentPage = window.location.pathname.split('/').pop();
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href && href.includes(currentPage)) {
            // Remove active from all items first
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to current item
            item.classList.add('active');
        }
    });
    
    // Update user info if available
    // You can populate this from your auth system or sessionStorage
    updateSidebarUserInfo();
});

// Function to update sidebar user info
function updateSidebarUserInfo() {
    // Get user data from sessionStorage or your auth system
    const residentData = sessionStorage.getItem('residentData');
    
    if (residentData) {
        try {
            const data = JSON.parse(residentData);
            const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
            const role = data.role || 'Resident';
            
            const userNameEl = document.getElementById('sidebar-user-name');
            const userRoleEl = document.getElementById('sidebar-user-role');
            
            if (userNameEl) userNameEl.textContent = fullName || 'Guest User';
            if (userRoleEl) userRoleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        } catch (error) {
            console.error('Error parsing resident data:', error);
        }
    }
}

// Export functions if using modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        handleLogout,
        updateSidebarUserInfo
    };
}
