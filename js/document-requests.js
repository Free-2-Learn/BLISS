import { db, auth } from "../firebase-config.js";
import { 
  collection, 
  getDocs, 
  updateDoc, 
  doc, 
  getDoc, 
  setDoc,           // ← ADD THIS
  addDoc,           // ← ADD THIS
  arrayUnion,       // ← ADD THIS
  serverTimestamp,  // ← ADD THIS
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js";

// Initialize Firebase Storage
const storage = getStorage();
// Firestore reference
const requestCollection = collection(db, "documentRequests");

const APP_CONFIG = {
  // ⚠️ IMPORTANT: Change this to your actual deployed website URL
  PRODUCTION_URL: 'https://free-2-learn.github.io/BLISS/', // Change to your domain!
  
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
  
  // Get document viewer URL (not verification page)
  getDocumentViewerURL(verificationCode, requestId) {
    return `${this.getBaseURL()}/view-document.html?code=${verificationCode}&id=${requestId}`;
  }
};

// BARANGAY CONFIGURATION
const BARANGAY_CONFIG = {
  name: "BARANGAY LIPAY",
  municipality: "VILLASIS, PANGASINAN",
  captain: {
    name: "LENY B. SEMBRAN",
    title: "Barangay Captain"
  },
  // We'll add logo path here later
  logoPath: "../assets/barangay-logo.png" // You'll need to create this
};

// =====================================================
// UPDATE FOR: document-requests.js
// =====================================================
import { isCaptainOrStaff, getUserData } from "../js/auth-helper.js";
import { goToDashboard } from "../js/navigation-helper.js"; // ADD THIS

let currentUserRole = null; // ADD THIS

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("🚫 No user logged in. Redirecting to login.");
        window.location.href = "../index.html";
        return;
    }

    const accessCheck = await isCaptainOrStaff(user);

    if (!accessCheck.hasAccess) {
        console.warn("🚫 Unauthorized access. Staff or Captain privileges required.");
        alert("Access denied. This page is for Barangay Captain and Staff only.");
        window.location.href = "../index.html";
        return;
    }

    console.log(`✅ User verified as ${accessCheck.role}`);
    
    currentUserRole = accessCheck.role; // ADD THIS
    
    // Store current user info for logging
    currentUser = user;
    
    // Load user data
    currentUserData = await getUserData(user);
    
    if (!currentUserData) {
        currentUserData = {
            uid: user.uid,
            email: user.email,
            fullName: user.email.split('@')[0].replace(/\./g, ' '),
            role: accessCheck.role
        };
    }
    
    setupBackButton(); // ADD THIS
    
    loadRequests();
});

// ADD THIS FUNCTION
function setupBackButton() {
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.onclick = (e) => {
            e.preventDefault();
            goToDashboard(currentUserRole);
        };
    }
}


// ✅ OPTIMIZED: Activity logging (appends to captain's document)
async function logActivity(action, details = {}) {
  if (!currentUser) return;

  const userId = currentUser.email.toLowerCase();
  const fullName = currentUserData?.fullName || currentUser.displayName || currentUser.email;

  try {
    const logRef = doc(db, 'activityLogs', userId);

    await setDoc(logRef, {
      userId: userId,
      userName: fullName,
      userRole: currentUserData?.role || 'captain',
      activities: arrayUnion({
        action: action,
        details: details,  // Keep lightweight
        timestamp: Timestamp.now()
      })
    }, { merge: true });
    
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// ✅ OPTIMIZED: Document history (subcollection per request)
async function logDocumentHistory(requestId, action, details = {}) {
  if (!currentUser) return;

  const fullName = currentUserData?.fullName || currentUser.displayName || currentUser.email;

  try {
    const historyData = {
      action: action,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      userName: fullName,
      userRole: currentUserData?.role || 'captain',
      timestamp: serverTimestamp(),
      createdAt: Timestamp.now(),
      details: details
    };

    const historyRef = collection(db, 'documentHistory', requestId, 'logs');
    await addDoc(historyRef, historyData);
    
  } catch (error) {
    console.error('Error writing document history:', error);
  }
}

let requests = [];
// Current user data for activity logging
let currentUser = null;
let currentUserData = null;

window.selectedRequests = new Set();

// Add this function
window.toggleRequestSelection = function(requestId, checkbox) {
  if (checkbox.checked) {
    selectedRequests.add(requestId);
  } else {
    selectedRequests.delete(requestId);
  }
  updateBulkActionsUI();
}

window.updateBulkActionsUI = function() {
  const bulkActionsBar = document.getElementById('bulk-actions-bar');
  const selectedCount = document.getElementById('selected-count');
  
  if (selectedRequests.size > 0) {
    bulkActionsBar.style.display = 'flex';
    selectedCount.textContent = selectedRequests.size;
  } else {
    bulkActionsBar.style.display = 'none';
  }
}

window.bulkApprove = async function() {
  if (selectedRequests.size === 0) return;
  
  const confirm = window.confirm(`Approve ${selectedRequests.size} requests?`);
  if (!confirm) return;
  
  for (const requestId of selectedRequests) {
    await updateRequestStatus(requestId, 'approved', 'Bulk approved');
  }
  
  selectedRequests.clear();
  loadRequests();
};

window.bulkReject = async function() {
  if (selectedRequests.size === 0) return;
  
  const reason = prompt('Reason for bulk rejection:');
  if (!reason) return;
  
  for (const requestId of selectedRequests) {
    await updateRequestStatus(requestId, 'rejected', reason);
  }
  
  selectedRequests.clear();
  loadRequests();
};

window.exportToCSV = async function() {
  const csvData = [];
  const headers = ['Resident Name', 'Document Type', 'Purpose', 'Status', 'Date Requested', 'Reviewed Date', 'Comment'];
  csvData.push(headers.join(','));
  
  const filteredRequests = applyFilters(requests);
  
  filteredRequests.forEach(req => {
    const row = [
      `"${req.residentName}"`,
      `"${req.documentType}"`,
      `"${req.purpose || ''}"`,
      `"${req.status}"`,
      `"${req.requestedAt ? formatDate(req.requestedAt) : 'N/A'}"`,
      `"${req.reviewedAt ? formatDate(new Date(req.reviewedAt.seconds * 1000)) : 'N/A'}"`,
      `"${req.rejectionReason || 'No comment'}"`
    ];
    csvData.push(row.join(','));
  });
  
  const csvContent = csvData.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fileName = `document-requests-${new Date().toISOString().split('T')[0]}.csv`;
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  
  // ✅ LOG ACTIVITY
  await logActivity("exported_csv_report", {
    fileName: fileName,
    totalRecords: filteredRequests.length,
    filters: {
      search: currentFilters.search || null,
      documentType: currentFilters.documentType,
      status: currentFilters.status,
      dateRange: currentFilters.dateRange
    }
  });
};

// =====================================================
// PRINT/PDF REPORT GENERATOR
// =====================================================
window.generateReport = async function() {
  const printWindow = window.open('', '_blank');
  const filteredRequests = applyFilters(requests);
  
  function printFormatDate(date) {
    if (!date) return 'N/A';
    if (date.seconds) {
      return new Date(date.seconds * 1000).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    }
    return new Date(date).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Document Requests Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #667eea; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; font-size: 12px; }
        th { background: #667eea; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .header { margin-bottom: 30px; }
        .stats { display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap; }
        .stat-box { padding: 15px; background: #f0f0f0; border-radius: 8px; }
        .role-badge { font-size: 10px; color: #666; font-style: italic; }
        @media print {
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📋 Document Requests Report</h1>
        <p><strong>Barangay Lipay, Villasis, Pangasinan</strong></p>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <p>Generated by: ${currentUserData?.fullName || currentUser.email} (${(currentUserData?.role || 'staff').charAt(0).toUpperCase() + (currentUserData?.role || 'staff').slice(1)})</p>
        <p>Total Requests: ${filteredRequests.length}</p>
      </div>
      
      <div class="stats">
        <div class="stat-box">
          <strong>Pending:</strong> ${filteredRequests.filter(r => r.status === 'pending').length}
        </div>
        <div class="stat-box">
          <strong>Approved:</strong> ${filteredRequests.filter(r => r.status === 'approved').length}
        </div>
        <div class="stat-box">
          <strong>Rejected:</strong> ${filteredRequests.filter(r => r.status === 'rejected').length}
        </div>
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Resident</th>
            <th>Document Type</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Reviewed By</th>
            <th>Reviewed Date</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRequests.map(req => {
            // Get reviewer info with role
            let reviewedBy = '-';
            if (req.reviewedByName) {
              const role = req.reviewedByRole || '';
              const roleDisplay = role ? ` (${role.charAt(0).toUpperCase() + role.slice(1)})` : '';
              reviewedBy = req.reviewedByName + roleDisplay;
            } else if (req.reviewedBy) {
              reviewedBy = req.reviewedBy.split('@')[0].replace(/\./g, ' ');
            } else if (req.generatedByName) {
              reviewedBy = req.generatedByName;
            }
            
            let reviewedDate = '-';
            if (req.reviewedAt) {
              reviewedDate = printFormatDate(req.reviewedAt);
            }
            
            return `
            <tr>
              <td>${req.residentName || 'Unknown'}</td>
              <td>${req.documentType || 'N/A'}</td>
              <td>${req.purpose || 'N/A'}</td>
              <td style="text-transform: capitalize;">${req.status || 'N/A'}</td>
              <td>${req.requestedAt ? printFormatDate(req.requestedAt) : 'N/A'}</td>
              <td>${reviewedBy}</td>
              <td>${reviewedDate}</td>
              <td>${req.rejectionReason || 'No comment'}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
      
      <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #ddd; text-align: center; color: #666;">
        <p><em>This is a computer-generated report. No signature required.</em></p>
      </div>
      
      <script>
        window.onload = function() {
          setTimeout(() => window.print(), 500);
        };
      </script>
    </body>
    </html>
  `;
  
  printWindow.document.write(html);
  printWindow.document.close();
  
  // ✅ LOG ACTIVITY
  await logActivity("generated_print_report", {
    totalRecords: filteredRequests.length,
    stats: {
      pending: filteredRequests.filter(r => r.status === 'pending').length,
      approved: filteredRequests.filter(r => r.status === 'approved').length,
      rejected: filteredRequests.filter(r => r.status === 'rejected').length
    },
    filters: {
      search: currentFilters.search || null,
      documentType: currentFilters.documentType,
      status: currentFilters.status,
      dateRange: currentFilters.dateRange
    }
  });
};

window.viewRequestDetails = async function(requestId) {
  const request = requests.find(r => r.id === requestId);
  if (!request) return;
  
  const modal = document.getElementById('details-modal');
  const modalBody = document.getElementById('details-body');
  
  let residentDetails = '';
  if (request.residentId) {
    try {
      const residentRef = doc(db, "residents", request.residentId);
      const residentDoc = await getDoc(residentRef);
      if (residentDoc.exists()) {
        const data = residentDoc.data();
        residentDetails = `
          <p><strong>Age:</strong> ${data.age || 'N/A'}</p>
          <p><strong>Address:</strong> ${data.address || 'N/A'}</p>
          <p><strong>Contact:</strong> ${data.phoneNumber || 'N/A'}</p>
          <p><strong>Civil Status:</strong> ${data.civilStatus || 'N/A'}</p>
        `;
      }
    } catch (error) {
      console.error('Error fetching resident details:', error);
    }
  }
  
  modalBody.innerHTML = `
    <h3 style="margin-bottom: 15px; color: #667eea;">📋 Request Details</h3>
    <p><strong>Resident:</strong> ${request.residentName}</p>
    ${residentDetails}
    <p><strong>Document Type:</strong> ${request.documentType}</p>
    <p><strong>Purpose:</strong> ${request.purpose || 'Not specified'}</p>
    <p><strong>Status:</strong> <span style="color: ${request.status === 'approved' ? '#4CAF50' : request.status === 'rejected' ? '#ef5350' : '#FFA726'}; font-weight: bold;">${request.status.toUpperCase()}</span></p>
    <p><strong>Requested:</strong> ${request.requestedAt ? formatDate(request.requestedAt) : 'N/A'}</p>
    ${request.reviewedAt ? `<p><strong>Reviewed:</strong> ${formatDate(new Date(request.reviewedAt.seconds * 1000))}</p>` : ''}
    ${request.reviewedByName ? `<p><strong>Reviewed By:</strong> ${request.reviewedByName}</p>` : ''}
    ${request.rejectionReason ? `<p><strong>Comment:</strong> ${request.rejectionReason}</p>` : ''}
    ${request.documentUrl ? `<p><strong>Document:</strong> <a href="${request.documentUrl}" target="_blank" style="color: #667eea;">View PDF</a></p>` : ''}
  `;
  
  modal.style.display = 'block';
};

window.closeDetailsModal = function() {
  document.getElementById('details-modal').style.display = 'none';
};

// Close modal when clicking outside
window.onclick = function(event) {
  const detailsModal = document.getElementById('details-modal');
  if (event.target === detailsModal) {
    detailsModal.style.display = 'none';
  }
};

// NEW: Filter state variables (ADD ONLY THIS PART)
let currentFilters = {
  search: '',
  documentType: 'all',
  status: 'all',
  dateRange: 'all'
};

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

// Initialize filters
function initializeFilters() {
  const searchInput = document.getElementById('search-input');
  const documentFilter = document.getElementById('document-filter');
  const statusFilter = document.getElementById('status-filter');
  const dateFilter = document.getElementById('date-filter');
  
  // Add event listeners
  searchInput.addEventListener('input', (e) => {
    currentFilters.search = e.target.value.toLowerCase();
    renderRequests();
  });
  
  documentFilter.addEventListener('change', (e) => {
    currentFilters.documentType = e.target.value;
    renderRequests();
  });
  
  statusFilter.addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    renderRequests();
  });
  
  dateFilter.addEventListener('change', (e) => {
    currentFilters.dateRange = e.target.value;
    renderRequests();
  });
}

// Reset all filters
window.resetFilters = function() {
  currentFilters = {
    search: '',
    documentType: 'all',
    status: 'all',
    dateRange: 'all'
  };
  
  document.getElementById('search-input').value = '';
  document.getElementById('document-filter').value = 'all';
  document.getElementById('status-filter').value = 'all';
  document.getElementById('date-filter').value = 'all';
  
  renderRequests();
};

// Apply filters to requests
function applyFilters(requestsList) {
  return requestsList.filter(request => {
    // Search filter
    if (currentFilters.search) {
      const nameMatch = request.residentName.toLowerCase().includes(currentFilters.search);
      if (!nameMatch) return false;
    }
    
    // Document type filter
    if (currentFilters.documentType !== 'all') {
      if (request.documentType !== currentFilters.documentType) return false;
    }
    
    // Status filter
    if (currentFilters.status !== 'all') {
      if (request.status !== currentFilters.status) return false;
    }
    
    // Date range filter
    if (currentFilters.dateRange !== 'all' && request.requestedAt) {
      const requestDate = new Date(request.requestedAt);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (currentFilters.dateRange === 'today') {
        const reqDate = new Date(requestDate);
        reqDate.setHours(0, 0, 0, 0);
        if (reqDate.getTime() !== today.getTime()) return false;
      } else if (currentFilters.dateRange === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        if (requestDate < weekAgo) return false;
      } else if (currentFilters.dateRange === 'month') {
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        if (requestDate < monthAgo) return false;
      }
    }
    
    return true;
  });
}

// Log filter usage (optional - helps understand captain behavior)
async function trackFilterUsage() {
  const activeFilters = [];
  
  if (currentFilters.search) activeFilters.push('search');
  if (currentFilters.documentType !== 'all') activeFilters.push('documentType');
  if (currentFilters.status !== 'all') activeFilters.push('status');
  if (currentFilters.dateRange !== 'all') activeFilters.push('dateRange');
  
  if (activeFilters.length > 0) {
    await logActivity("used_filters", {
      filters: activeFilters,
      searchTerm: currentFilters.search || null,
      documentType: currentFilters.documentType,
      status: currentFilters.status,
      dateRange: currentFilters.dateRange
    });
  }
}

async function loadRequests() {
  const pendingRequestsBody = document.getElementById("pending-requests");
  const processedRequestsBody = document.getElementById("processed-requests");

  pendingRequestsBody.innerHTML = "<tr><td colspan='6'>Loading...</td></tr>";
  processedRequestsBody.innerHTML = "<tr><td colspan='8'>Loading...</td></tr>";

  try {
    const querySnapshot = await getDocs(requestCollection);
    requests = [];

    for (const docSnap of querySnapshot.docs) {
      const request = docSnap.data();
      const requestId = docSnap.id;
      let residentName = request.residentName || "Unknown";

      if ((!request.residentName || residentName === "Unknown") && request.residentId) {
        const residentRef = doc(db, "residents", request.residentId);
        const residentDoc = await getDoc(residentRef);

        if (residentDoc.exists()) {
          const data = residentDoc.data();
          const { firstName = "", middleName = "", lastName = "" } = data;
          residentName = `${firstName} ${middleName} ${lastName}`.trim();
        }
      }

      if (request.requestedAt && request.requestedAt.seconds) {
        request.requestedAt = new Date(request.requestedAt.seconds * 1000);
      } else if (request.requestedAt) {
        request.requestedAt = new Date(request.requestedAt);
      } else if (request.date && request.date.seconds) {
        request.requestedAt = new Date(request.date.seconds * 1000);
      } else if (request.date) {
        request.requestedAt = new Date(request.date);
      }

      requests.push({ ...request, id: requestId, residentName });
    }

    renderRequests();
  } catch (error) {
    console.error("Error loading document requests:", error);
    pendingRequestsBody.innerHTML = "<tr><td colspan='6'>Failed to load pending requests.</td></tr>";
    processedRequestsBody.innerHTML = "<tr><td colspan='8'>Failed to load processed requests.</td></tr>";
  }
    initializeFilters();
}

let pendingSortOrder = 'desc';
let processedSortOrder = 'desc';

function renderRequests() {
  const pendingRequestsBody = document.getElementById("pending-requests");
  const processedRequestsBody = document.getElementById("processed-requests");

  pendingRequestsBody.innerHTML = "";
  processedRequestsBody.innerHTML = "";

  // Apply filters first
  const filteredRequests = applyFilters(requests);

  const pendingRequests = filteredRequests
    .filter((req) => req.status === "pending")
    .sort((a, b) => {
      return pendingSortOrder === 'asc' ? a.requestedAt - b.requestedAt : b.requestedAt - a.requestedAt;
    });

  // ✅ FIX: Sort by reviewedAt for processed, with most recent on top by default
  const processedRequests = filteredRequests
    .filter((req) => req.status !== "pending")
    .sort((a, b) => {
      // Use reviewedAt if available, otherwise fallback to requestedAt
      const dateA = a.reviewedAt ? (a.reviewedAt.seconds ? new Date(a.reviewedAt.seconds * 1000) : new Date(a.reviewedAt)) : a.requestedAt;
      const dateB = b.reviewedAt ? (b.reviewedAt.seconds ? new Date(b.reviewedAt.seconds * 1000) : new Date(b.reviewedAt)) : b.requestedAt;
      
      return processedSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

  // Render pending
  if (pendingRequests.length === 0) {
    pendingRequestsBody.innerHTML = "<tr><td colspan='6'>No pending requests.</td></tr>";
  } else {
    pendingRequests.forEach((request) => {
      const tr = document.createElement("tr");
      const dateText = request.requestedAt ? formatDate(request.requestedAt) : "N/A";
      
      tr.innerHTML = `
        <td>${request.residentName}</td>
        <td>${request.documentType || "N/A"}</td>
        <td>${request.purpose || "N/A"}</td>
        <td id="status-${request.id}">${request.status ? request.status.charAt(0).toUpperCase() + request.status.slice(1) : "N/A"}</td>
        <td>${dateText}</td>
        <td>
          <div class="action-buttons">
            <button class="request-btn" style="background: #4CAF50;" onclick="openReasonModal('${request.id}', 'approved', '${request.residentName}')">Approve</button>
            <button class="request-btn" style="background: #d32f2f;" onclick="openReasonModal('${request.id}', 'rejected', '${request.residentName}')">Reject</button>
          </div>
        </td>
      `;
      pendingRequestsBody.appendChild(tr);
    });
  }

  // Render processed
  if (processedRequests.length === 0) {
    processedRequestsBody.innerHTML = "<tr><td colspan='8'>No processed requests.</td></tr>";
  } else {
    processedRequests.forEach((request) => {
      const tr = document.createElement("tr");

      let actionTimeText = "N/A";
      if (request.reviewedAt) {
        const reviewedDate = request.reviewedAt.seconds 
          ? new Date(request.reviewedAt.seconds * 1000) 
          : new Date(request.reviewedAt);
        const statusText = request.status ? request.status.charAt(0).toUpperCase() + request.status.slice(1) : "Unknown";
        
        // IMPROVED: Get reviewer info with role
        let reviewerInfo = "Unknown";
        if (request.reviewedByName) {
          const role = request.reviewedByRole || 'staff';
          const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);
          reviewerInfo = `${request.reviewedByName} (${roleDisplay})`;
        } else if (request.reviewedBy) {
          // Extract name from email
          reviewerInfo = request.reviewedBy.split('@')[0].replace(/\./g, ' ');
        } else if (request.generatedByName) {
          reviewerInfo = request.generatedByName;
        }
        
        actionTimeText = `${statusText} by ${reviewerInfo}<br>at ${formatDate(reviewedDate)}`;
      }

      const comment = request.rejectionReason || "No comment";
      const requestedDateText = request.requestedAt ? formatDate(request.requestedAt) : "N/A";

      // Generate Document button + QR Code download
      let actionButtons = "";
      if (request.status === "approved" && !request.documentUrl) {
        actionButtons = `
          <button class="request-btn" style="background: #2196F3;" onclick="generateDocument('${request.id}', '${request.residentId}', '${request.documentType}')">
            📄 Generate Document
          </button>
        `;
      } else if (request.status === "approved" && request.documentUrl) {
        const generatedByName = request.generatedByName || request.generatedBy || "Unknown";
        const generatedDate = request.generatedAt ? formatDate(new Date(request.generatedAt.seconds * 1000)) : "N/A";
        
        actionButtons = `
          <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">
            <span style="color: #4CAF50; font-weight: bold;">✓ Document Generated</span>
            <span style="color: #666; font-size: 11px;">by ${generatedByName}</span>
            <span style="color: #999; font-size: 10px;">${generatedDate}</span>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; justify-content: center;">
              <a href="${request.documentUrl}" target="_blank" class="request-btn" style="background: #1976D2; font-size: 12px; padding: 6px 12px;">
                📄 View PDF
              </a>
              <button class="request-btn" style="background: #9C27B0; font-size: 12px; padding: 6px 12px;" onclick="downloadQRCode('${request.id}', '${request.verificationCode}', '${request.residentName}')">
                📱 Download QR
              </button>
            </div>
          </div>
        `;
      } else {
        actionButtons = `<span style="color: #999;">-</span>`;
      }

      tr.innerHTML = `
        <td>${request.residentName}</td>
        <td>${request.documentType || "N/A"}</td>
        <td>${request.purpose || "N/A"}</td>
        <td id="status-${request.id}">${request.status ? request.status.charAt(0).toUpperCase() + request.status.slice(1) : "N/A"}</td>
        <td>${requestedDateText}</td>
        <td>${actionTimeText}</td>
        <td>${comment}</td>
        <td>${actionButtons}</td>
      `;
      processedRequestsBody.appendChild(tr);
    });
  }
    updateDashboardStats();
}

window.toggleSortPending = function () {
  pendingSortOrder = pendingSortOrder === "asc" ? "desc" : "asc";
  const icon = pendingSortOrder === "asc" ? "🔼" : "🔽";
  document.getElementById("sortToggleBtn").innerText = icon;
  renderRequests();
};

window.toggleSortProcessed = function () {
  processedSortOrder = processedSortOrder === "asc" ? "desc" : "asc";
  const icon = processedSortOrder === "asc" ? "🔼" : "🔽";
  document.getElementById("sortToggleBtn1").innerText = icon;
  renderRequests();
};

let currentAction = "";
let currentRequestId = "";
let currentResidentName = "";

window.openReasonModal = function (requestId, action, residentName) {
  currentAction = action;
  currentRequestId = requestId;
  currentResidentName = residentName;

  document.getElementById("modal-title").innerText = `${action} Request for ${residentName}`;
  document.getElementById("action-type").innerText = action.toLowerCase();
  document.getElementById("action-reason").value = "";
  document.getElementById("reason-modal").style.display = "block";
};

window.closeReasonModal = function () {
  document.getElementById("reason-modal").style.display = "none";
};

window.confirmAction = async function () {
  const reason = document.getElementById("action-reason").value;

  try {
    await updateRequestStatus(currentRequestId, currentAction, reason);
    closeReasonModal();
    loadRequests();
  } catch (error) {
    console.error("Error updating request:", error);
  }
};

async function updateRequestStatus(requestId, status, reason = "") {
  const requestRef = doc(db, "documentRequests", requestId);
  
  // SAFETY CHECK: Ensure currentUserData is loaded
  if (!currentUser) {
    alert("User not authenticated. Please refresh the page.");
    return;
  }
  
  if (!currentUserData) {
    console.warn("⚠️ currentUserData not loaded, attempting to reload...");
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
        console.log("✅ Reloaded user data");
      } else {
        // Fallback
        currentUserData = {
          uid: currentUser.uid,
          email: currentUser.email,
          fullName: currentUser.displayName || currentUser.email.split('@')[0].replace(/\./g, ' '),
          role: 'staff'
        };
      }
    } catch (error) {
      console.error("Error reloading user data:", error);
      alert("Error loading user information. Please refresh the page.");
      return;
    }
  }
  
  // Get reviewer information (works for captain, staff, admin)
  const reviewerEmail = currentUser.email;
  const reviewerName = currentUserData?.fullName || 
                       currentUser.displayName || 
                       currentUser.email.split('@')[0].replace(/\./g, ' ');
  const reviewerRole = currentUserData?.role || 'staff';
  
  // DEBUG: Log who is reviewing
  console.log("📝 Reviewing request:", {
    reviewer: reviewerName,
    email: reviewerEmail,
    role: reviewerRole,
    action: status
  });
  
  try {
    // Update request with reviewer information
    await updateDoc(requestRef, {
      status: status,
      rejectionReason: reason,
      reviewedAt: Timestamp.now(),
      reviewedBy: reviewerEmail,
      reviewedByName: reviewerName,
      reviewedByRole: reviewerRole  // NEW: Track role too
    });

    // Get request data for logging
    const requestSnap = await getDoc(requestRef);
    const requestData = requestSnap.data();

    // Log activity
    await logActivity(
      status === "approved" ? "document_request_approved" : "document_request_rejected",
      {
        requestId: requestId,
        residentName: requestData.residentName,
        documentType: requestData.documentType,
        reason: reason || "No reason provided",
        reviewedBy: reviewerName,
        reviewerRole: reviewerRole
      }
    );

    // Log to document history
    await logDocumentHistory(requestId, 
      status === "approved" ? "request_approved" : "request_rejected",
      {
        reviewedBy: reviewerName,
        reviewedByRole: reviewerRole,
        reason: reason || "No reason provided",
        previousStatus: requestData.status
      }
    );

    // Update UI
    document.getElementById(`status-${requestId}`).innerText = 
      status.charAt(0).toUpperCase() + status.slice(1);
    
    console.log("✅ Request updated successfully");
      
  } catch (error) {
    console.error('❌ Error updating request status:', error);
    alert('Failed to update request status. Please try again.');
  }
}

// =====================================================
// NEW: SEPARATE QR CODE DOWNLOAD FUNCTION
// =====================================================
window.downloadQRCode = function(requestId, verificationCode, residentName) {
  try {
    // ✅ UPDATED: QR code points to document viewer page
    const viewerURL = APP_CONFIG.getDocumentViewerURL(verificationCode, requestId);
    
    console.log("📱 Generating QR Code for:", viewerURL);
    
    const qr = new QRious({
      value: viewerURL,
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
    
    // Resident name
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(`For: ${residentName}`, canvas.width / 2, 110);
    
    // Add QR code
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
        a.download = `QR_Document_${residentName.replace(/\s+/g, '_')}_${verificationCode}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log("✅ QR Code downloaded successfully");
      });
    };
    
  } catch (error) {
    console.error("Error generating QR code:", error);
    alert("Failed to generate QR code: " + error.message);
  }
};

function generateVerificationCode() {
  return 'VER-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Add console logging to debug
window.generateDocument = async function(requestId, residentId, documentType) {
  console.log("🔍 DIAGNOSTIC INFO:");
  console.log("Document Type:", documentType);
  
  const confirmGenerate = confirm(`Generate ${documentType} for this resident?`);
  if (!confirmGenerate) return;

  const button = document.querySelector(`button[onclick*="${requestId}"]`);
  
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Generating...";
    }

    console.log("🔍 Fetching resident data...");
    const normalizedId = residentId.toLowerCase();
    const residentRef = doc(db, "residents", normalizedId);
    const residentSnap = await getDoc(residentRef);
    
    if (!residentSnap.exists()) {
      alert(`Resident data not found! ID: ${normalizedId}`);
      if (button) {
        button.disabled = false;
        button.textContent = "📄 Generate Document";
      }
      return;
    }

    const residentData = residentSnap.data();
    console.log("✅ Resident data found");

    // ✅ UPDATED: Generate QR code that points to document viewer
    const verificationCode = generateVerificationCode();
    const viewerURL = APP_CONFIG.getDocumentViewerURL(verificationCode, requestId);
    
    console.log("📱 Document Viewer URL:", viewerURL);

    // Get request data
    const requestRef = doc(db, "documentRequests", requestId);
    const requestSnap = await getDoc(requestRef);
    const requestData = requestSnap.exists() ? requestSnap.data() : {};

    // Generate PDF
    const pdfBlob = await createPDF(residentData, documentType, requestData.purpose || "legal purposes");

    // Upload to Firebase Storage
    const fileName = `documents/${normalizedId}/${requestId}_${documentType.replace(/\s+/g, '_')}.pdf`;
    const fileRef = storageRef(storage, fileName);
    
    console.log("📤 Uploading PDF...");
    await uploadBytes(fileRef, pdfBlob);
    const downloadURL = await getDownloadURL(fileRef);
    console.log("✅ Upload complete!");

    const currentUser = auth.currentUser;
    const userName = currentUserData?.fullName || currentUser.displayName || currentUser.email;
    const userRole = currentUserData?.role || 'staff';

    // Update Firestore - store viewer URL in qrCodeData
    await updateDoc(requestRef, {
      documentUrl: downloadURL,
      qrCodeData: viewerURL, // QR code points to viewer page
      verificationCode: verificationCode,
      generatedAt: Timestamp.now(),
      generatedBy: currentUser.email,
      generatedByName: userName,
      generatedByRole: userRole,
      documentGenerationLog: {
        action: "Document Generated",
        documentType: documentType,
        performedBy: userName,
        performedByEmail: currentUser.email,
        performedByRole: userRole,
        timestamp: Timestamp.now()
      }
    });

    // Log activity
    await logActivity("document_generated", {
      requestId: requestId,
      residentId: residentId,
      residentName: residentData.firstName + " " + residentData.lastName,
      documentType: documentType,
      verificationCode: verificationCode,
      viewerURL: viewerURL,
      generatedBy: userName,
      generatedByRole: userRole
    });

    await logDocumentHistory(requestId, "document_generated", {
      documentType: documentType,
      verificationCode: verificationCode,
      viewerURL: viewerURL,
      generatedBy: userName,
      generatedByRole: userRole,
      fileName: fileName
    });

    alert("Document generated successfully!");
    loadRequests();

  } catch (error) {
    console.error("❌ Error:", error);
    alert("Failed to generate document: " + error.message);
    
    if (button) {
      button.disabled = false;
      button.textContent = "📄 Generate Document";
    }
  }
};

function updateDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Count pending requests
  const pendingCount = requests.filter(req => req.status === "pending").length;
  
  // Count approved today
  const approvedToday = requests.filter(req => {
    if (req.status === "approved" && req.reviewedAt) {
      const reviewedDate = req.reviewedAt.seconds 
        ? new Date(req.reviewedAt.seconds * 1000) 
        : new Date(req.reviewedAt);
      reviewedDate.setHours(0, 0, 0, 0);
      return reviewedDate.getTime() === today.getTime();
    }
    return false;
  }).length;
  
  // Count rejected today
  const rejectedToday = requests.filter(req => {
    if (req.status === "rejected" && req.reviewedAt) {
      const reviewedDate = req.reviewedAt.seconds 
        ? new Date(req.reviewedAt.seconds * 1000) 
        : new Date(req.reviewedAt);
      reviewedDate.setHours(0, 0, 0, 0);
      return reviewedDate.getTime() === today.getTime();
    }
    return false;
  }).length;
  
  // Count documents generated
  const generatedCount = requests.filter(req => req.documentUrl).length;
  
  // Total requests
  const totalCount = requests.length;
  
  // Update the DOM
  document.getElementById("pending-count").textContent = pendingCount;
  document.getElementById("approved-count").textContent = approvedToday;
  document.getElementById("rejected-count").textContent = rejectedToday;
  document.getElementById("generated-count").textContent = generatedCount;
  document.getElementById("total-count").textContent = totalCount;
}

// =====================================================
// IMPROVED PDF GENERATION WITH DIFFERENT TEMPLATES
// =====================================================
// In the createPDF function, add Barangay ID case:
async function createPDF(residentData, documentType, purpose) {
  const { jsPDF } = window.jspdf;
  
  // Log for debugging
  console.log("🔍 Document Type Received:", `"${documentType}"`);
  
  // Trim and convert to lowercase for comparison
  const type = documentType.trim().toLowerCase();
  
  console.log("🔍 Normalized Type:", `"${type}"`);
  
  // Use flexible matching with includes()
  if (type === 'barangay id' || type.includes('barangay id')) {
    console.log("✅ Creating: Barangay ID Form");
    return await createBarangayIDForm(residentData);
  }
  
  if (type === 'barangay clearance' || type.includes('barangay clearance')) {
    console.log("✅ Creating: Barangay Clearance");
    return await createBarangayClearance(residentData, purpose);
  }
  
  if (type === 'certificate of residency' || type.includes('residency')) {
    console.log("✅ Creating: Certificate of Residency");
    return await createCertificateOfResidency(residentData, purpose);
  }
  
  // Handle both "indigency" AND "indigence"
  if (type === 'certificate of indigency' || 
      type === 'certificate of indigence' || 
      type.includes('indigen')) {
    console.log("✅ Creating: Certificate of Indigency");
    return await createCertificateOfIndigency(residentData, purpose);
  }
  
  if (type === 'business permit' || type.includes('business permit')) {
    console.log("✅ Creating: Business Permit");
    return await createBusinessPermit(residentData, purpose);
  }
  
  // Fallback
  console.warn("⚠️ No match found for:", documentType);
  console.log("🔄 Using generic certificate template");
  return await createGenericCertificate(residentData, documentType, purpose);
}

// Helper function to load logo (you'll implement this)
async function loadBarangayLogo() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("Logo not found, continuing without it");
      resolve(null);
    };
    img.src = BARANGAY_CONFIG.logoPath;
  });
}

// =====================================================
// BARANGAY CLEARANCE TEMPLATE - LIPAY, VILLASIS (POSITION FIXED)
// =====================================================
async function createBarangayClearance(residentData, purpose) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  
  const pageWidth = 210;
  const pageHeight = 297;
  
  // Load logos
  const leftLogo = await loadBarangayLogo();
  
  // Load right logo (municipality logo)
  const rightLogo = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("Municipality logo not found");
      resolve(null);
    };
    img.src = "../assets/barangay-logo.png";
  });
  
  // ==================== HEADER SECTION ====================
  
  // Left Logo (Barangay Lipay)
  if (leftLogo) {
    doc.addImage(leftLogo, 'PNG', 25, 12, 30, 30);
  }
  
  // Right Logo (Municipality of Villasis)
  if (rightLogo) {
    doc.addImage(rightLogo, 'PNG', 155, 12, 30, 30);
  }
  
  // Header Text
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text("Republic of the Philippines", pageWidth / 2, 15, { align: "center" });
  doc.text("Province of Pangasinan", pageWidth / 2, 20, { align: "center" });
  doc.text("Municipality of Villasis", pageWidth / 2, 25, { align: "center" });
  
  // Barangay Name (Large, Bold, Blue color)
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(41, 55, 141); // Blue color
  doc.text("BARANGAY LIPAY", pageWidth / 2, 38, { align: "center" });
  
  // Reset text color to black
  doc.setTextColor(0, 0, 0);
  
  // Red horizontal line under header
  doc.setDrawColor(220, 38, 38); // Red color
  doc.setLineWidth(1.5);
  doc.line(20, 44, 190, 44);
  
  // Reset line color to black
  doc.setDrawColor(0, 0, 0);
  
  // ==================== TITLE ====================
  doc.setFontSize(22);
  doc.setFont(undefined, 'bold');
  const titleY = 60;
  doc.text("BARANGAY CLEARANCE", pageWidth / 2, titleY, { align: "center" });
  
  // ==================== BODY SECTION ====================
  let y = 80;
  
  doc.setFontSize(11);
  doc.setFont(undefined, 'italic');
  doc.text("TO WHOM IT MAY CONCERN:", 25, y);
  
  y += 15;
  
  // Get resident data - CONVERT TO STRINGS
  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  
  const fullName = `${residentData.firstName || ""} ${residentData.middleName || ""} ${residentData.lastName || ""}`.trim();
  const ageStr = String(residentData.age || "____");
  
  // NEW FORMAT - Paragraph 1
  const para1Line1 = `       This is to certify that ____________________________, ___ years old and a`;
  const para1Line2 = `resident of this barangay is known to be of good moral character and a law abiding`;
  const para1Line3 = `citizen of the community.`;
  
  doc.text(para1Line1, 25, y);
  
  // Add the actual name over the blank line (bold and underlined)
  doc.setFont(undefined, 'bold');
  const nameWidth = doc.getTextWidth(fullName);
  doc.text(fullName, 72, y);
  doc.setLineWidth(0.2);
  doc.line(72, y + 0.5, 72 + nameWidth, y + 0.5); // Underline
  
  // Add age over the blank line - MOVED MORE TO THE LEFT ✅
  const ageWidth = doc.getTextWidth(ageStr);
  doc.text(ageStr, 133, y); // ✅ Changed from 139 to 133 (6mm left)
  doc.line(133, y + 0.5, 133 + ageWidth, y + 0.5); // Underline
  doc.setFont(undefined, 'normal');
  
  y += 7;
  doc.text(para1Line2, 25, y);
  y += 7;
  doc.text(para1Line3, 25, y);
  
  y += 12;
  
  // NEW FORMAT - Paragraph 2
  const para2Line1 = `       It is further certified that he/she has no derogatory and or criminal case filed`;
  const para2Line2 = `in this barangay.`;
  
  doc.text(para2Line1, 25, y);
  y += 7;
  doc.text(para2Line2, 25, y);
  
  y += 15;
  
  // NEW FORMAT - Date and purpose paragraph
  const currentDate = new Date();
  const day = currentDate.getDate();
  const month = currentDate.toLocaleDateString('en-US', { month: 'long' });
  const year = currentDate.getFullYear();
  
  const para3Line1 = `       Issued this _____ day of ______________, ${year}, at Brgy. Lipay, Villasis,`;
  const para3Line2 = `Pangasinan. Upon request of the interested party for whatever legal purposes this`;
  const para3Line3 = `clearance may serve.`;
  
  doc.text(para3Line1, 25, y);
  
  // Fill in actual date (bold and underlined)
  doc.setFont(undefined, 'bold');
  
  // Day
  const dayStr = String(day);
  const dayWidth = doc.getTextWidth(dayStr);
  doc.text(dayStr, 58, y);
  doc.setLineWidth(0.2);
  doc.line(58, y + 0.5, 58 + dayWidth, y + 0.5);
  
  // Month - MOVED MORE TO THE LEFT ✅
  const monthWidth = doc.getTextWidth(month);
  doc.text(month, 84, y); // ✅ Changed from 91 to 84 (7mm left)
  doc.line(84, y + 0.5, 84 + monthWidth, y + 0.5);
  
  doc.setFont(undefined, 'normal');
  
  y += 7;
  doc.text(para3Line2, 25, y);
  y += 7;
  doc.text(para3Line3, 25, y);
  
  y += 40;
  
  // ==================== SIGNATURE SECTION ====================
  
  // Barangay Captain name and title (right aligned)
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text("LENY B. SEMBRAN", 150, y, { align: "center" });
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text("Barangay Captain", 150, y + 6, { align: "center" });
  
  y += 40;
  
  // ==================== FOOTER SECTION ====================
  
  // Specimen signature line only (CTC removed)
  doc.setLineWidth(0.3);
  doc.line(25, y, 80, y);
  doc.setFontSize(9);
  doc.text("Specimen Signature of Applicant", 25, y + 5);
  
  return doc.output('blob');
}

// =====================================================
// CERTIFICATE OF RESIDENCY - A4, No Border, Centered
// =====================================================
async function createCertificateOfResidency(residentData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  
  const logo = await loadBarangayLogo();
  
  const pageWidth = 210;
  const pageHeight = 297;
  
  let y = 20;
  
  // Left Logo
  if (logo) {
    doc.addImage(logo, 'PNG', 25, y, 30, 30);
  }
  
  // Right Logo
  if (logo) {
    doc.addImage(logo, 'PNG', 155, y, 30, 30);
  }
  
  // Header - centered
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text("Republic of the Philippines", pageWidth / 2, 23, { align: "center" });
  doc.text("Province of Pangasinan", pageWidth / 2, 28, { align: "center" });
  doc.text("Municipality of Villasis", pageWidth / 2, 33, { align: "center" });
  
  y = 45;
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text("BARANGAY LIPAY", pageWidth / 2, y, { align: "center" });
  
  y = 53;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text("Office of the Punong Barangay", pageWidth / 2, y, { align: "center" });
  
  // Underline
  y = 56;
  doc.setLineWidth(0.5);
  doc.line(60, y, 150, y);
  
  // Title
  y = 70;
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text("C E R T I F I C A T E  of  R E S I D E N C Y", pageWidth / 2, y, { align: "center" });
  
  // Body
  y = 90;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("To Whom It May Concern:", 25, y);
  
  y = 105;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  
  // Get resident data with proper title
  let title = "Mr.";
  if (residentData.gender === "Female") {
    if (residentData.civilStatus === "Married") {
      title = "Mrs.";
    } else {
      title = "Ms.";
    }
  }
  const fullName = `${residentData.firstName || ""} ${residentData.middleName || ""} ${residentData.lastName || ""}`.trim().toUpperCase();
  const age = residentData.age || (residentData.birthdate ? calculateAge(residentData.birthdate) : "");
  const ageStr = String(age);
  const civilStatus = residentData.civilStatus || "";
  const barangay = "Lipay";
  const municipality = "Villasis";
  const province = "Pangasinan";
  const yearsResident = residentData.yearsAsResident || residentData.years || "";
  const yearsStr = String(yearsResident);
  
  // First paragraph with underlines for data
  const indent = 30;
  const lineHeight = 7;
  
  const line1 = `This is to certify that ${title} ______________________________,`;
  doc.text(line1, indent, y);
  
  // Add actual name with underline - moved more to the left
  doc.setFont(undefined, 'bold');
  const nameWidth = doc.getTextWidth(fullName);
  doc.text(fullName, 87, y);
  doc.setLineWidth(0.2);
  doc.line(87, y + 0.5, 87 + nameWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  const line2 = `___ years old, ________________, Filipino citizen and a bona fide`;
  doc.text(line2, indent, y);
  
  // Add age with underline
  doc.setFont(undefined, 'bold');
  const ageWidth = doc.getTextWidth(ageStr);
  doc.text(ageStr, 30, y);
  doc.line(30, y + 0.5, 30 + ageWidth, y + 0.5);
  
  // Add civil status with underline - moved more to the right
  const civilWidth = doc.getTextWidth(civilStatus);
  doc.text(civilStatus, 56, y);
  doc.line(56, y + 0.5, 56 + civilWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  const line3 = `resident of Barangay ________, Municipality of ________,`;
  doc.text(line3, indent, y);
  
  // Add barangay with underline
  doc.setFont(undefined, 'bold');
  const barangayWidth = doc.getTextWidth(barangay);
  doc.text(barangay, 70, y);
  doc.line(70, y + 0.5, 70 + barangayWidth, y + 0.5);
  
  // Add municipality with underline - removed space, positioned right after "of"
  const municipalityWidth = doc.getTextWidth(municipality);
  doc.text(municipality, 127, y);
  doc.line(127, y + 0.5, 127 + municipalityWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  const line4 = `Province of ____________ is known to me personally as a Person of Good`;
  doc.text(line4, indent, y);
  
  // Add province with underline
  doc.setFont(undefined, 'bold');
  const provinceWidth = doc.getTextWidth(province);
  doc.text(province, 52, y);
  doc.line(52, y + 0.5, 52 + provinceWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  doc.text(`moral character, God-fearing, Law abiding and Peace-loving citizen of this`, indent, y);
  y += lineHeight;
  
  const line6 = `community. He/She is also known to be staying here in this community for more`;
  doc.text(line6, indent, y);
  y += lineHeight;
  
  const line7 = `than ____ years.`;
  doc.text(line7, indent, y);
  
  // Add years with underline
  doc.setFont(undefined, 'bold');
  const yearsWidth = doc.getTextWidth(yearsStr);
  doc.text(yearsStr, 40, y);
  doc.line(40, y + 0.5, 40 + yearsWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight + 5;
  
  // Second paragraph
  const line8 = `This certification is being issued upon the request of`;
  doc.text(line8, indent, y);
  y += lineHeight;
  
  const line9 = `${title} ______________________________ for whatever legal intents and`;
  doc.text(line9, indent, y);
  
  // Add name with underline - moved to the left
  doc.setFont(undefined, 'bold');
  const name2Width = doc.getTextWidth(fullName);
  doc.text(fullName, 38, y);
  doc.line(38, y + 0.5, 38 + name2Width, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  doc.text(`purposes this may serve.`, indent, y);
  
  y += lineHeight + 5;
  
  // Date issued
  const currentDate = new Date();
  const day = currentDate.getDate();
  const dayStr = String(day);
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const month = monthNames[currentDate.getMonth()];
  const year = currentDate.getFullYear();
  
  const line10 = `Issued this ___ day of ____________, ${year}, at Barangay`;
  doc.text(line10, indent, y);
  
  // Add day with underline
  doc.setFont(undefined, 'bold');
  const dayWidth = doc.getTextWidth(dayStr);
  doc.text(dayStr, 52, y);
  doc.line(52, y + 0.5, 52 + dayWidth, y + 0.5);
  
  // Add month with underline - moved more to the left
  const monthWidth = doc.getTextWidth(month);
  doc.text(month, 74, y);
  doc.line(74, y + 0.5, 74 + monthWidth, y + 0.5);
  doc.setFont(undefined, 'normal');
  
  y += lineHeight;
  
  doc.text(`Lipay, Municipality of Villasis, Province of`, indent, y);
  y += lineHeight;
  
  doc.text(`Pangasinan, Philippines.`, indent, y);
  
  // Signature area
  y = 240;
  const sigX = 150;
  
  doc.setLineWidth(0.5);
  doc.line(sigX - 25, y, sigX + 25, y);
  
  y += 5;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("LENY B. SEMBRAN", sigX, y, { align: "center" });
  
  y += 6;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text("Punong Barangay", sigX, y, { align: "center" });
  
  // Footer note
  y = 275;
  doc.setFontSize(9);
  doc.setFont(undefined, 'italic');
  doc.text("Not Valid Without Seal", pageWidth / 2, y, { align: "center" });
  
  return doc.output('blob');
}

// Helper function to calculate age from birthdate
function calculateAge(birthdate) {
  if (!birthdate) return "";
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// =====================================================
// CERTIFICATE OF INDIGENCY TEMPLATE - FIXED
// =====================================================
async function createCertificateOfIndigency(residentData, purpose) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const logo = await loadBarangayLogo();
  
  // Logo (if available)
  if (logo) {
    doc.addImage(logo, 'PNG', 15, 15, 25, 25);
  }
  
  // Header
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  doc.text("Republic of the Philippines", 105, 25, { align: "center" });
  
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text("OFFICE OF THE PUNONG BARANGAY", 105, 32, { align: "center" });
  
  // Decorative line (underline style)
  doc.setLineWidth(0.3);
  doc.line(55, 37, 155, 37);
  
  // Title
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text("CERTIFICATE OF INDIGENCY", 105, 45, { align: "center" });
  
  // Body content
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  
  let y = 65;
  
  // Construct full name
  const fullName = `${residentData.firstName || ""} ${residentData.middleName || ""} ${residentData.lastName || ""}`.trim().toUpperCase();
  const address = residentData.address || "Barangay Lipay, Villasis, Pangasinan";
  
  // First line: "This is to certify that ___name___ of legal"
  doc.text("This is to certify that ", 20, y);
  const nameX = doc.getTextWidth("This is to certify that ") + 20;
  doc.setFont(undefined, 'bold');
  doc.text(fullName, nameX, y);
  doc.setLineWidth(0.3);
  doc.line(nameX, y + 1, nameX + doc.getTextWidth(fullName), y + 1);
  doc.setFont(undefined, 'normal');
  const afterName = nameX + doc.getTextWidth(fullName) + 2;
  doc.text(" of legal", afterName, y);
  
  y += 7;
  
  // Second line: "age, is a resident of ___address___."
  doc.text("age, is a resident of ", 20, y);
  const addressX = doc.getTextWidth("age, is a resident of ") + 20;
  doc.setFont(undefined, 'bold');
  doc.text(address, addressX, y);
  doc.line(addressX, y + 1, addressX + doc.getTextWidth(address), y + 1);
  doc.setFont(undefined, 'normal');
  doc.text(".", addressX + doc.getTextWidth(address) + 1, y);
  
  y += 10;
  
  // Second paragraph - wrap text properly
  const paragraph2 = "Further certifies that he/she belongs to an indigent family which has proven to be below the poverty line.";
  const lines2 = doc.splitTextToSize(paragraph2, 170);
  doc.text(lines2, 20, y);
  y += (lines2.length * 7) + 5;
  
  // Third paragraph
  doc.text("This certification is issued upon request for availing of:", 20, y);
  y += 10;
  
  // Checkboxes section
  const checkboxSize = 4;
  const checkboxOptions = [
    { label: "Medical Assistance", key: "medical" },
    { label: "Financial Assistance", key: "financial" },
    { label: "Educational Assistance", key: "educational" },
    { label: "Burial Assistance", key: "burial" },
    { label: "Employment Assistance", key: "employment" },
    { label: "General Purpose", key: "general" } // Removed ampersand
  ];
  
  // Determine which checkbox to check based on purpose
  let selectedOption = "general"; // default
  const purposeLower = (purpose || "").toLowerCase();
  if (purposeLower.includes("medical")) selectedOption = "medical";
  else if (purposeLower.includes("financial")) selectedOption = "financial";
  else if (purposeLower.includes("educational") || purposeLower.includes("education")) selectedOption = "educational";
  else if (purposeLower.includes("burial")) selectedOption = "burial";
  else if (purposeLower.includes("employment") || purposeLower.includes("work") || purposeLower.includes("job")) selectedOption = "employment";
  
  // Draw checkboxes with more spacing
  checkboxOptions.forEach((option) => {
    // Draw checkbox
    doc.setLineWidth(0.5);
    doc.rect(35, y - 3, checkboxSize, checkboxSize);
    
    // Draw label
    doc.setFont(undefined, 'normal');
    doc.text(option.label, 42, y);
    y += 7;
  });
  
  y += 3;
  
  // Fourth paragraph
  doc.text("and for whatever legal matters it may serve best.", 20, y);
  y += 15;
  
  // Date line with underlines (adjusted positioning)
  const currentDate = new Date();
  const day = currentDate.getDate();
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const month = monthNames[currentDate.getMonth()];
  const year = currentDate.getFullYear();
  const location = "Barangay Lipay, Villasis, Pangasinan";
  
  // Build the date string with underlines - adjusted x position
  doc.text("Issued this ", 30, y);
  let xPos = 30 + doc.getTextWidth("Issued this ");
  
  // Day underline - moved right with padding
  doc.setFont(undefined, 'bold');
  const dayStr = ` ${day} `; // Added spaces for padding
  doc.text(dayStr, xPos, y);
  const dayWidth = doc.getTextWidth(dayStr);
  doc.line(xPos, y + 1, xPos + dayWidth, y + 1);
  xPos += dayWidth + 2;
  doc.setFont(undefined, 'normal');
  
  doc.text(" day of ", xPos, y);
  xPos += doc.getTextWidth(" day of ");
  
  // Month underline
  doc.setFont(undefined, 'bold');
  doc.text(month, xPos, y);
  const monthWidth = doc.getTextWidth(month);
  doc.line(xPos, y + 1, xPos + monthWidth + 3, y + 1);
  xPos += monthWidth + 5;
  doc.setFont(undefined, 'normal');
  
  doc.text(`, ${year} at `, xPos, y);
  xPos += doc.getTextWidth(`, ${year} at `);
  
  // Location underline
  doc.setFont(undefined, 'bold');
  doc.text(location, xPos, y);
  const locationWidth = doc.getTextWidth(location);
  doc.line(xPos, y + 1, xPos + locationWidth, y + 1);
  doc.setFont(undefined, 'normal');
  doc.text(".", xPos + locationWidth + 1, y);
  
  y += 25;
  
  // Signature section (right aligned) - Added captain name
  const signatureX = 155;
  
  // Captain name above the line
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text("LENY B. SEMBRAN", signatureX, y, { align: "center" });
  
  y += 2;
  
  // Signature line
  doc.setLineWidth(0.5);
  doc.line(130, y, 180, y);
  
  y += 5;
  
  // Title below the line
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text("Punong Barangay", signatureX, y, { align: "center" });
  
  return doc.output('blob');
}

// =====================================================
// BUSINESS PERMIT TEMPLATE
// =====================================================
async function createBusinessPermit(residentData, purpose) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const logo = await loadBarangayLogo();
  
  if (logo) {
    doc.addImage(logo, 'PNG', 15, 15, 25, 25);
  }
  
  // Header
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text("REPUBLIC OF THE PHILIPPINES", 105, 20, { align: "center" });
  doc.setFontSize(12);
  doc.text("Province of Pangasinan", 105, 27, { align: "center" });
  doc.text("Municipality of Villasis", 105, 33, { align: "center" });
  
  doc.setFontSize(16);
  doc.text("BARANGAY LIPAY", 105, 42, { align: "center" });
  
  doc.setLineWidth(0.8);
  doc.line(20, 48, 190, 48);
  
  doc.setFontSize(11);
  doc.text("OFFICE OF THE BARANGAY CAPTAIN", 105, 54, { align: "center" });
  
  // Title
  doc.setFontSize(18);
  doc.text("BARANGAY BUSINESS CLEARANCE", 105, 70, { align: "center" });
  
  // Permit Number
  const permitNumber = `BP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Permit No: ${permitNumber}`, 105, 78, { align: "center" });
  
  // Body
  doc.setFontSize(12);
  doc.text("TO WHOM IT MAY CONCERN:", 20, 95);
  
  const fullName = `${residentData.firstName || ""} ${residentData.middleName || ""} ${residentData.lastName || ""}`.trim().toUpperCase();
  const address = residentData.address || "Barangay Lipay, Villasis, Pangasinan";
  const businessName = purpose || "Business Establishment"; // You can add businessName field
  
  doc.text("This is to certify that:", 20, 110);
  
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.text(`Business Owner: ${fullName}`, 30, 125);
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(12);
  doc.text(`Business Name/Type: ${businessName}`, 30, 135);
  doc.text(`Business Address: ${address}`, 30, 145);
  
  const bodyText = `has been granted clearance to operate the above-mentioned business within the territorial 
jurisdiction of Barangay Lipay, subject to compliance with all applicable local ordinances, rules and 
regulations.

This clearance is a prerequisite for securing a Business Permit from the Municipal Government and does not 
constitute authorization to operate without said permit.

This clearance is valid for ONE (1) YEAR from date of issuance and must be renewed annually.`;

  const lines = doc.splitTextToSize(bodyText, 170);
  doc.text(lines, 20, 160);
  
  const currentDate = new Date().toLocaleDateString('en-US', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
  
  // Validity period
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  const expiryString = expiryDate.toLocaleDateString('en-US', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
  
  doc.setFont(undefined, 'bold');
  doc.text(`Date Issued: ${currentDate}`, 20, 215);
  doc.text(`Valid Until: ${expiryString}`, 20, 223);
  
  // Signature
  doc.setFont(undefined, 'bold');
  doc.text(BARANGAY_CONFIG.captain.name, 140, 245, { align: "center" });
  doc.setLineWidth(0.5);
  doc.line(115, 243, 165, 243);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(BARANGAY_CONFIG.captain.title, 140, 251, { align: "center" });
  
  // Footer
  doc.setFontSize(9);
  doc.setFont(undefined, 'italic');
  doc.text("NOT VALID WITHOUT BARANGAY SEAL AND MUNICIPAL BUSINESS PERMIT", 105, 270, { align: "center" });
  
  // Border
  doc.setLineWidth(1);
  doc.rect(10, 10, 190, 277);
  
  return doc.output('blob');
}

// =====================================================
// GENERIC CERTIFICATE TEMPLATE (Fallback)
// =====================================================
async function createGenericCertificate(residentData, documentType, purpose) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const logo = await loadBarangayLogo();
  
  if (logo) {
    doc.addImage(logo, 'PNG', 15, 15, 25, 25);
  }
  
  // Header
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text("REPUBLIC OF THE PHILIPPINES", 105, 20, { align: "center" });
  doc.setFontSize(12);
  doc.text("Province of Pangasinan", 105, 27, { align: "center" });
  doc.text("Municipality of Villasis", 105, 33, { align: "center" });
  
  doc.setFontSize(16);
  doc.text("BARANGAY LIPAY", 105, 42, { align: "center" });
  
  doc.setLineWidth(0.8);
  doc.line(20, 48, 190, 48);
  
  doc.setFontSize(11);
  doc.text("OFFICE OF THE BARANGAY CAPTAIN", 105, 54, { align: "center" });
  
  // Title
  doc.setFontSize(18);
  doc.text(documentType.toUpperCase(), 105, 70, { align: "center" });
  
  // Body
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  
  doc.text("TO WHOM IT MAY CONCERN:", 20, 90);
  
  const fullName = `${residentData.firstName || ""} ${residentData.middleName || ""} ${residentData.lastName || ""}`.trim();
  const age = residentData.age || "N/A";
  const civilStatus = residentData.civilStatus || "N/A";
  const address = residentData.address || "Barangay Lipay, Villasis, Pangasinan";
  
  doc.text("This is to certify that:", 20, 105);
  
  doc.setFont(undefined, 'bold');
  doc.text(`Name: ${fullName}`, 30, 120);
  doc.setFont(undefined, 'normal');
  doc.text(`Age: ${age}`, 30, 130);
  doc.text(`Civil Status: ${civilStatus}`, 30, 138);
  doc.text(`Address: ${address}`, 30, 146);
  
  doc.text(`is a bonafide resident of this barangay.`, 20, 165);
  
  doc.text(`This certification is issued upon the request of the`, 20, 180);
  doc.text(`above-named person for ${purpose}.`, 20, 190);

  const currentDate = new Date().toLocaleDateString('en-US', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
  
  doc.text(`Issued this ${currentDate} at Barangay Lipay, Villasis, Pangasinan.`, 20, 210);

  // Signature
  doc.setFont(undefined, 'bold');
  doc.text(BARANGAY_CONFIG.captain.name, 140, 245, { align: "center" });
  doc.setLineWidth(0.5);
  doc.line(115, 243, 165, 243);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(BARANGAY_CONFIG.captain.title, 140, 251, { align: "center" });
  
  // Border
  doc.setLineWidth(1);
  doc.rect(10, 10, 190, 277);
  
  return doc.output('blob');
}

// =====================================================
// BARANGAY ID APPLICATION FORM - 3 ROW ATTESTATION TABLE
// =====================================================
async function createBarangayIDForm(residentData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  
  const logo = await loadBarangayLogo();
  
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  
  // Outer border
  doc.setLineWidth(1.5);
  doc.rect(margin, margin, contentWidth, pageHeight - (margin * 2));
  
  // Left Logo
  if (logo) {
    doc.addImage(logo, 'PNG', 20, 15, 25, 25);
  }
  
  // Header
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text("Republic of the Philippines", pageWidth / 2, 17, { align: "center" });
  
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text("Province of Pangasinan", pageWidth / 2, 22, { align: "center" });
  doc.text("Municipality of Villasis", pageWidth / 2, 26, { align: "center" });
  
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("BARANGAY LIPAY", pageWidth / 2, 31, { align: "center" });
  
  doc.setFontSize(14);
  doc.text("APPLICATION FORM FOR BARANGAY ID", pageWidth / 2, 38, { align: "center" });
  
  // Right Logo
  if (logo) {
    doc.addImage(logo, 'PNG', 165, 15, 25, 25);
  }
  
  let y = 47;
  const leftMargin = 15;
  const rightMargin = 195;
  const fullWidth = rightMargin - leftMargin;
  
  doc.setLineWidth(0.4);
  
  // NAME OF APPLICANT ROW
  doc.rect(leftMargin, y, 130, 8);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Name of Applicant", leftMargin + 2, y + 5);
  
  doc.rect(145, y, 50, 8);
  doc.text("Date of Application:", 147, y + 5);
  doc.setFont(undefined, 'normal');
  const appDate = new Date().toLocaleDateString('en-US');
  doc.text(appDate, 147, y + 7);
  
  y += 8;
  
  // LAST, FIRST, MIDDLE NAME ROW
  doc.rect(leftMargin, y, 60, 8);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Last Name", leftMargin + 2, y + 3);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text((residentData.lastName || "").toUpperCase(), leftMargin + 2, y + 6.5);
  
  doc.rect(75, y, 60, 8);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("First Name", 77, y + 3);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text((residentData.firstName || "").toUpperCase(), 77, y + 6.5);
  
  doc.rect(135, y, 60, 8);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Middle Name", 137, y + 3);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text((residentData.middleName || "").toUpperCase(), 137, y + 6.5);
  
  y += 8;
  
  // ADDRESS (LIPAY) ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Address (Barangay Lipay):", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.address || "", leftMargin + 45, y + 5);
  
  y += 7;
  
  // ADDRESS (PROVINCIAL) ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Address (Provincial):", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.provincialAddress || "", leftMargin + 40, y + 5);
  
  y += 7;
  
  // CONTACT NUMBER ROW
  doc.rect(leftMargin, y, 60, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Contact Number:", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.phoneNumber || "", leftMargin + 30, y + 5);
  
  doc.rect(75, y, 60, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Cell. No.", 77, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.cellNumber || "", 95, y + 5);
  
  doc.rect(135, y, 60, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Tel. No.", 137, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.telNumber || "", 155, y + 5);
  
  y += 7;
  
  // EMPLOYER'S NAME ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Employer's Name:", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.employer || "", leftMargin + 35, y + 5);
  
  y += 7;
  
  // LENGTH OF STAY / DATE OF BIRTH ROW
  doc.rect(leftMargin, y, 50, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Length of Stay in Lipay:", leftMargin + 2, y + 5);
  
  doc.rect(65, y, 25, 7);
  doc.text("year/s", 67, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.years || "", 67, y + 5.5);
  
  doc.rect(90, y, 25, 7);
  doc.setFont(undefined, 'bold');
  doc.text("month/s", 92, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.months || "", 92, y + 5.5);
  
  doc.rect(115, y, 80, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Date of Birth:", 117, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.birthdate || "", 140, y + 5);
  
  y += 7;
  
  // FATHER'S NAME / GENDER ROW
  doc.rect(leftMargin, y, 120, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Father's Name:", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.fatherName || "", leftMargin + 30, y + 5);
  
  doc.rect(135, y, 60, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Gender:", 137, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.gender || "", 155, y + 5);
  
  y += 7;
  
  // MOTHER'S NAME / STATUS ROW
  doc.rect(leftMargin, y, 120, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Mother's Name:", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.motherName || "", leftMargin + 32, y + 5);
  
  doc.rect(135, y, 60, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Status:", 137, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.civilStatus || "", 155, y + 5);
  
  y += 7;
  
  // EMERGENCY CONTACT DETAILS HEADER
  y += 3;
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text("EMERGENCY CONTACT DETAILS", leftMargin + 2, y);
  y += 2;
  
  // CONTACT PERSON ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFontSize(7);
  doc.text("Contact Person", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.emergencyContact || "", leftMargin + 35, y + 5);
  
  y += 7;
  
  // RELATIONSHIP ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Relationship", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.emergencyRelationship || "", leftMargin + 28, y + 5);
  
  y += 7;
  
  // ADDRESS ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Address", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.emergencyAddress || "", leftMargin + 20, y + 5);
  
  y += 7;
  
  // CONTACT NUMBER ROW
  doc.rect(leftMargin, y, fullWidth, 7);
  doc.setFont(undefined, 'bold');
  doc.text("Contact Number", leftMargin + 2, y + 5);
  doc.setFont(undefined, 'normal');
  doc.text(residentData.emergencyPhone || "", leftMargin + 32, y + 5);
  
  y += 7;
  
  // CLASSIFICATION HEADER
  y += 3;
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text("CLASSIFICATION", leftMargin + 2, y);
  y += 5;
  
  // CLASSIFICATION CHECKBOXES
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  
  doc.rect(leftMargin + 2, y, 4, 4);
  if (residentData.classification === "Homeowners") {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text("✓", leftMargin + 2.8, y + 3.2);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
  }
  doc.text("Homeowners", leftMargin + 8, y + 3);
  
  doc.rect(65, y, 4, 4);
  if (residentData.classification === "Household Helpers") {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text("✓", 65.8, y + 3.2);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
  }
  doc.text("Household Helpers", 71, y + 3);
  
  doc.rect(130, y, 4, 4);
  if (residentData.classification === "Barangay Employee") {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text("✓", 130.8, y + 3.2);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
  }
  doc.text("Barangay Employee", 136, y + 3);
  
  y += 8;
  
  doc.rect(leftMargin + 2, y, 4, 4);
  if (residentData.classification === "Others") {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text("✓", leftMargin + 2.8, y + 3.2);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
  }
  doc.text("Others (please specify)", leftMargin + 8, y + 3);
  doc.line(leftMargin + 45, y + 3, 120, y + 3);
  doc.text(residentData.otherClassification || "", leftMargin + 46, y + 2.5);
  
  y += 12;
  
  // THUMBMARK AND SIGNATURE BOXES
  doc.rect(leftMargin, y, 80, 35);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text("RIGHT THUMBMARK", leftMargin + 40, y + 38, { align: "center" });
  
  doc.rect(100, y, 95, 35);
  doc.text("SIGNATURE OF APPLICANT (please sign within the box)", 147.5, y + 38, { align: "center" });
  
  y += 42;
  
  // CERTIFICATION TEXT
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  doc.text("This is to certify that this Personal Data Sheet has been accomplished by me, and is true, correct and complete", leftMargin + 2, y);
  doc.text("statement. I also authorized the Barangay or its representative to validate the contents stated herein.", leftMargin + 2, y + 4);
  
  y += 10;
  
  // ==================== ATTESTATION TABLE - 3 ROWS x 3 COLUMNS ====================
  
  const col1X = leftMargin;
  const col1W = 20;
  const col2X = col1X + col1W;
  const col2W = 106; // WIDE middle column (homeowner + relative together)
  const col3X = col2X + col2W;
  const col3W = 54; // Right column
  
  const checkSize = 3;
  doc.setLineWidth(0.4);
  
  // ===== ROW 1: EMPLOYER | Homeowner/Relative (with vertical divider) | RECORDED BY =====
  const row1H = 10;
  
  // Column 1 - EMPLOYER
  doc.rect(col1X, y, col1W, row1H);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("EMPLOYER", col1X + (col1W / 2), y + 6, { align: "center" });
  
  // Column 2 - Homeowner AND Relative (ONE column with vertical divider in middle)
  doc.rect(col2X, y, col2W, row1H);
  const col2MidX = col2X + (col2W / 2);
  
  // Left half - Homeowner
  doc.rect(col2X + 2, y + 3.5, checkSize, checkSize);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);
  doc.text("Homeowner or", col2X + 7, y + 3.5);
  doc.text("Representative of the", col2X + 7, y + 6);
  doc.text("homeowner", col2X + 7, y + 8.5);
  
  // Vertical divider line in middle of column 2
  doc.line(col2MidX, y, col2MidX, y + row1H);
  
  // Right half - Relative
  doc.rect(col2MidX + 2, y + 3.5, checkSize, checkSize);
  doc.text("Relative living in the", col2MidX + 7, y + 4.5);
  doc.text("same address", col2MidX + 7, y + 7);
  
  // Column 3 - RECORDED BY
  doc.rect(col3X, y, col3W, row1H);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("RECORDED BY:", col3X + (col3W / 2), y + 6, { align: "center" });
  
  y += row1H;
  
  // ===== ROW 2: Attested by | Signature over printed name | Barangay Secretary =====
  const row2H = 14;
  
  // Column 1 - Attested by:
  doc.rect(col1X, y, col1W, row2H);
  doc.text("Attested by:", col1X + (col1W / 2), y + 8, { align: "center" });
  
  // Column 2 - Signature over printed name (line touching borders) + Atty. Eduardo
  doc.rect(col2X, y, col2W, row2H);
  doc.line(col2X, y + 6, col2X + col2W, y + 6); // Line touching left and right borders
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6);
  doc.text("Signature over printed name", col2X + (col2W / 2), y + 9, { align: "center" });
  doc.setFontSize(6.5);
  doc.text("Atty. Eduardo Martin A. Tankiang III", col2X + (col2W / 2), y + 12, { align: "center" });
  
  // Column 3 - Barangay Secretary
  doc.rect(col3X, y, col3W, row2H);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Barangay Secretary", col3X + (col3W / 2), y + 8, { align: "center" });
  
  y += row2H;
  
  // ===== ROW 3: Interview Conducted by | Signature/Barangay Rep | APPROVED BY/Rossana =====
  const row3H = 18;
  
  // Column 1 - Interview Conducted by:
  doc.rect(col1X, y, col1W, row3H);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("Interview", col1X + (col1W / 2), y + 7, { align: "center" });
  doc.text("Conducted by:", col1X + (col1W / 2), y + 11, { align: "center" });
  
  // Column 2 - Signature over printed name + Barangay Representative
  doc.rect(col2X, y, col2W, row3H);
  doc.line(col2X, y + 6, col2X + col2W, y + 6); // Line touching borders
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6);
  doc.text("Signature over printed name", col2X + (col2W / 2), y + 9.5, { align: "center" });
  doc.setFontSize(6.5);
  doc.setFont(undefined, 'bold');
  doc.text("Barangay Representative", col2X + (col2W / 2), y + 14, { align: "center" });
  
  // Column 3 - APPROVED BY + signature space + Rossana Y. Hwang + Punong Barangay
  doc.rect(col3X, y, col3W, row3H);
  
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text("APPROVED BY:", col3X + (col3W / 2), y + 3, { align: "center" });
  
  // Signature line
  doc.line(col3X, y + 6, col3X + col3W, y + 6);
  
  // Name and title
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  doc.text("Rossana Y. Hwang", col3X + (col3W / 2), y + 11, { align: "center" });
  doc.setFont(undefined, 'bold');
  doc.text("Punong Barangay", col3X + (col3W / 2), y + 15, { align: "center" });
  
  return doc.output('blob');
}
