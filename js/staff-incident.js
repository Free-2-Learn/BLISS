import { auth, db, storage } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where,
    orderBy, 
    getDocs,
    doc,
    updateDoc,
    arrayUnion,
    serverTimestamp,
    getDoc,
    addDoc,
    setDoc,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import { 
    ref, 
    uploadBytes, 
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
// ADD THIS IMPORT AT THE TOP (with your other imports)
import { goToDashboard } from "../js/navigation-helper.js";

// UPDATED VARIABLES SECTION
let currentUser = null;
let currentUserData = null;
let currentUserRole = null; // ← ADD ONLY THIS LINE (don't redeclare currentUser and currentUserData)
let allReports = [];
let unassignedReports = [];
let myReports = [];
let allStaffMembers = [];
let currentReportId = null;
let currentReportUserId = null;
let currentLightboxImages = [];
let currentLightboxIndex = 0;
let currentStatusFilter = { unassigned: 'all', my: 'all', all: 'all' };
let currentTypeFilter = { unassigned: 'all', my: 'all', all: 'all' };

// REPLACE the onAuthStateChanged section in staff-incidents.js with this:

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userEmail = user.email.toLowerCase();
            let userData = null;
            let hasAccess = false;
            
            // METHOD 1: Check users collection (original method)
            let userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                userData = userDoc.data();
                if (userData.role === 'staff' || userData.role === 'admin' || userData.role === 'captain') {
                    hasAccess = true;
                    
                    // Set currentUserRole
                    if (userData.role === 'captain') {
                        currentUserRole = 'captain';
                        userData.role = 'admin'; // Treat captain as admin internally
                    } else if (userData.role === 'admin') {
                        currentUserRole = 'captain';
                    } else {
                        currentUserRole = 'staff';
                    }
                }
            }
            
            // METHOD 2: Check staff collection (NEW - matches staff-auth.js)
            if (!hasAccess) {
                // Check if captain/admin
                const adminRef = doc(db, 'config', 'admin');
                const adminSnap = await getDoc(adminRef);
                
                if (adminSnap.exists() && adminSnap.data().email === userEmail) {
                    hasAccess = true;
                    currentUserRole = 'captain';
                    userData = {
                        email: userEmail,
                        role: 'admin',
                        fullName: 'Captain Admin'
                    };
                    console.log('✅ Captain/Admin access granted');
                }
                
                // Check if staff
                if (!hasAccess) {
                    const staffRef = doc(db, 'staff', userEmail);
                    const staffSnap = await getDoc(staffRef);
                    
                    if (staffSnap.exists()) {
                        const staffData = staffSnap.data();
                        
                        if (staffData.isActive === true) {
                            hasAccess = true;
                            currentUserRole = 'staff';
                            userData = {
                                email: userEmail,
                                role: 'staff',
                                fullName: staffData.fullName || staffData.name || userEmail,
                                uid: user.uid
                            };
                            console.log('✅ Staff access granted via staff collection');
                        } else {
                            console.warn('❌ Staff account is inactive');
                            await customAlert(
                                '<strong>Account Disabled</strong><br><br>Your staff account has been disabled.<br><br>Please contact the administrator.',
                                'error'
                            );
                            await auth.signOut();
                            window.location.href = '../index.html';
                            return;
                        }
                    }
                }
            }
            
            // Fallback: captain@example.com hardcoded access
            if (!hasAccess && user.email === 'captain@example.com') {
                hasAccess = true;
                await setDoc(doc(db, 'users', user.uid), {
                    email: user.email,
                    role: 'captain',
                    fullName: 'Captain Admin'
                }, { merge: true });
                userData = { 
                    email: user.email, 
                    role: 'admin',
                    fullName: 'Captain Admin'
                };
                currentUserRole = 'captain';
            }
            
            if (hasAccess) {
                currentUser = user;
                currentUserData = userData || { email: user.email, role: 'staff' };
                
                // Set default role if not already set
                if (!currentUserRole) {
                    currentUserRole = (currentUserData.role === 'admin') ? 'captain' : 'staff';
                }
                
                // Hide "All Reports" tab if not admin/captain
                if (currentUserData.role !== 'admin') {
                    const allReportsTab = document.getElementById('allReportsTab');
                    if (allReportsTab) {
                        allReportsTab.style.display = 'none';
                    }
                }
                
                setupBackButton();
                
                await loadStaffMembers();
                await loadAllReports();
                initializeTabs();
                initializeStatusFilters();
                initializeTypeFilters();
                
                console.log('✅ Dashboard loaded successfully for:', userEmail, '| Role:', currentUserRole);
                
            } else {
                console.log('❌ Access denied. User role:', userData?.role);
                await customAlert(
                    '<strong>Access Denied</strong><br><br>Staff or admin privileges are required to access this page.<br><br>You will be redirected to the login page.',
                    'error'
                );
                await auth.signOut();
                window.location.href = '../index.html';
            }
        } catch (error) {
            console.error('❌ Error checking user role:', error);
            await customAlert(
                '<strong>Verification Error</strong><br><br>Unable to verify your access credentials.<br><br>Error: ' + error.message,
                'error'
            );
            await auth.signOut();
            window.location.href = '../index.html';
        }
    } else {
        console.log('❌ No user logged in');
        window.location.href = '../index.html';
    }
});

// ← ADD THIS FUNCTION AT THE BOTTOM OF YOUR FILE (after all other functions)
// Setup back button for role-based navigation
function setupBackButton() {
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.onclick = (e) => {
            e.preventDefault();
            goToDashboard(currentUserRole);
        };
    }
}

// Custom Alert
function customAlert(message, type = 'info') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const dialog = document.getElementById('customModalDialog');
        const header = dialog.querySelector('.custom-modal-header');
        const icon = document.getElementById('customModalIcon');
        const title = document.getElementById('customModalTitle');
        const body = document.getElementById('customModalBody');
        const footer = document.getElementById('customModalFooter');
        
        const configs = {
            info: { icon: 'ℹ️', title: 'Information', headerClass: 'info' },
            warning: { icon: '⚠️', title: 'Warning', headerClass: 'warning' },
            error: { icon: '❌', title: 'Error', headerClass: 'danger' },
            success: { icon: '✅', title: 'Success', headerClass: 'success' }
        };
        
        const config = configs[type] || configs.info;
        
        icon.textContent = config.icon;
        title.textContent = config.title;
        body.innerHTML = message.replace(/\n/g, '<br>');
        
        header.className = 'custom-modal-header';
        if (config.headerClass) {
            header.classList.add(config.headerClass);
        }
        
        footer.innerHTML = `
            <button class="custom-modal-btn primary" onclick="closeCustomModal()">
                OK
            </button>
        `;
        
        overlay.classList.add('show');
        
        window.closeCustomModal = () => {
            overlay.classList.remove('show');
            resolve(true);
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                window.closeCustomModal();
            }
        };
    });
}

// Custom Confirm
function customConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const {
            title = 'Confirm Action',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            type = 'warning',
            icon = '❓'
        } = options;
        
        const overlay = document.getElementById('customModalOverlay');
        const dialog = document.getElementById('customModalDialog');
        const header = dialog.querySelector('.custom-modal-header');
        const iconEl = document.getElementById('customModalIcon');
        const titleEl = document.getElementById('customModalTitle');
        const body = document.getElementById('customModalBody');
        const footer = document.getElementById('customModalFooter');
        
        iconEl.textContent = icon;
        titleEl.textContent = title;
        body.innerHTML = message.replace(/\n/g, '<br>');
        
        header.className = 'custom-modal-header';
        if (type) {
            header.classList.add(type);
        }
        
        footer.innerHTML = `
            <button class="custom-modal-btn secondary" id="customModalCancel">
                ${cancelText}
            </button>
            <button class="custom-modal-btn ${type}" id="customModalConfirm">
                ${confirmText}
            </button>
        `;
        
        overlay.classList.add('show');
        
        setTimeout(() => {
            document.getElementById('customModalConfirm')?.focus();
        }, 100);
        
        document.getElementById('customModalConfirm').onclick = () => {
            overlay.classList.remove('show');
            resolve(true);
        };
        
        document.getElementById('customModalCancel').onclick = () => {
            overlay.classList.remove('show');
            resolve(false);
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                resolve(false);
            }
        };
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.classList.remove('show');
                resolve(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// Custom Prompt
function customPrompt(message, options = {}) {
    return new Promise((resolve) => {
        const {
            title = 'Input Required',
            placeholder = '',
            defaultValue = '',
            confirmText = 'Submit',
            cancelText = 'Cancel',
            type = 'primary',
            icon = '✏️',
            validateText = null,
            isTextarea = false,
            rows = 4
        } = options;
        
        const overlay = document.getElementById('customModalOverlay');
        const dialog = document.getElementById('customModalDialog');
        const header = dialog.querySelector('.custom-modal-header');
        const iconEl = document.getElementById('customModalIcon');
        const titleEl = document.getElementById('customModalTitle');
        const body = document.getElementById('customModalBody');
        const footer = document.getElementById('customModalFooter');
        
        iconEl.textContent = icon;
        titleEl.textContent = title;
        
        const inputField = isTextarea ? 
            `<textarea 
                id="customModalInput" 
                placeholder="${placeholder}"
                rows="${rows}"
                style="
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    font-size: 15px;
                    margin-top: 15px;
                    transition: border-color 0.3s;
                    font-family: inherit;
                    resize: vertical;
                "
                onfocus="this.style.borderColor='#667eea'"
                onblur="this.style.borderColor='#e0e0e0'"
            >${defaultValue}</textarea>` :
            `<input 
                type="text" 
                id="customModalInput" 
                placeholder="${placeholder}"
                value="${defaultValue}"
                style="
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    font-size: 15px;
                    margin-top: 15px;
                    transition: border-color 0.3s;
                    font-family: inherit;
                "
                onfocus="this.style.borderColor='#667eea'"
                onblur="this.style.borderColor='#e0e0e0'"
            >`;
        
        body.innerHTML = `
            <p>${message.replace(/\n/g, '<br>')}</p>
            ${inputField}
            ${validateText ? `<p style="color:#e74c3c; font-size:13px; margin-top:10px; font-weight:600;">⚠️ Type exactly: <code style="background:#f8f9fa; padding:2px 8px; border-radius:4px; font-family:monospace;">${validateText}</code></p>` : ''}
        `;
        
        header.className = 'custom-modal-header';
        if (type && type !== 'primary') {
            header.classList.add(type);
        }
        
        footer.innerHTML = `
            <button class="custom-modal-btn secondary" id="customModalCancel">
                ${cancelText}
            </button>
            <button class="custom-modal-btn ${type}" id="customModalConfirm">
                ${confirmText}
            </button>
        `;
        
        overlay.classList.add('show');
        
        setTimeout(() => {
            document.getElementById('customModalInput')?.focus();
        }, 100);
        
        const confirmAction = () => {
            const input = document.getElementById('customModalInput');
            const value = input.value.trim();
            
            if (validateText && value !== validateText) {
                input.style.borderColor = '#e74c3c';
                input.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    input.style.animation = '';
                }, 500);
                return;
            }
            
            if (!value && validateText) {
                input.style.borderColor = '#e74c3c';
                return;
            }
            
            overlay.classList.remove('show');
            resolve(value || null);
        };
        
        document.getElementById('customModalConfirm').onclick = confirmAction;
        
        document.getElementById('customModalCancel').onclick = () => {
            overlay.classList.remove('show');
            resolve(null);
        };
        
        document.getElementById('customModalInput').onkeypress = (e) => {
            if (e.key === 'Enter' && !isTextarea) {
                confirmAction();
            }
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                resolve(null);
            }
        };
    });
}

// Load all staff members for transfer dropdown
async function loadStaffMembers() {
    try {
        const q = query(
            collection(db, 'users'),
            where('role', 'in', ['staff', 'admin', 'captain'])
        );
        
        const querySnapshot = await getDocs(q);
        allStaffMembers = [];
        
        querySnapshot.forEach((docSnap) => {
            const staff = { uid: docSnap.id, ...docSnap.data() };
            allStaffMembers.push(staff); // Include ALL staff members
        });
                
        // Populate transfer dropdown (exclude current user from transfer list)
        const transferSelect = document.getElementById('transferToStaff');
        transferSelect.innerHTML = '<option value="">Select staff member...</option>';
        allStaffMembers.forEach(staff => {
            // Don't show current user in transfer dropdown
            if (staff.uid !== currentUser.uid) {
                const option = document.createElement('option');
                option.value = staff.uid;
                const displayRole = staff.role === 'captain' ? 'admin' : staff.role;
                option.textContent = `${staff.fullName || staff.email} (${displayRole})`;
                transferSelect.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Error loading staff members:', error);
    }
}

// Load all reports and categorize them
async function loadAllReports() {
    try {
        const q = query(
            collection(db, 'incidentReports'),
            orderBy('createdAt', 'desc')
        );
        
        const querySnapshot = await getDocs(q);
        allReports = [];
        unassignedReports = [];
        myReports = [];
        
        querySnapshot.forEach((docSnap) => {
            const report = { id: docSnap.id, ...docSnap.data() };
            allReports.push(report);
            
            // Categorize reports
            if (!report.assignedTo) {
                // Unassigned reports (only show submitted/acknowledged)
                if (report.status === 'submitted' || report.status === 'acknowledged') {
                    unassignedReports.push(report);
                }
            } else if (report.assignedTo === currentUser.uid) {
                // My assigned reports
                myReports.push(report);
            }
        });
        
        // Update all views
        updateReportCounts();
        displayUnassignedReports();
        displayMyReports();
        if (currentUserData.role === 'admin') {
            displayAllReports();
        }
        
    } catch (error) {
        console.error('Error loading reports:', error);
        alert('Error loading reports. Please refresh the page.');
    }
}

// Initialize tabs
function initializeTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            btn.classList.add('active');
            if (targetTab === 'unassigned') {
                document.getElementById('unassignedTab').classList.add('active');
            } else if (targetTab === 'my-reports') {
                document.getElementById('myReportsTab').classList.add('active');
            } else if (targetTab === 'all-reports') {
                document.getElementById('allReportsTabContent').classList.add('active');
            }
        });
    });
}

// Initialize status filter chips
function initializeStatusFilters() {
    const filterChips = document.querySelectorAll('.filter-chip');
    
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const status = chip.dataset.status;
            const context = chip.dataset.context;
            
            // Remove active from chips in same context
            document.querySelectorAll(`.filter-chip[data-context="${context}"]`).forEach(c => {
                c.classList.remove('active');
            });
            
            chip.classList.add('active');
            currentStatusFilter[context] = status;
            
            // Update appropriate view
            if (context === 'unassigned') displayUnassignedReports();
            else if (context === 'my') displayMyReports();
            else if (context === 'all') displayAllReports();
        });
    });
}

// Initialize type filters
function initializeTypeFilters() {
    document.getElementById('unassignedTypeFilter').addEventListener('change', (e) => {
        currentTypeFilter.unassigned = e.target.value;
        displayUnassignedReports();
    });
    
    document.getElementById('myReportsTypeFilter').addEventListener('change', (e) => {
        currentTypeFilter.my = e.target.value;
        displayMyReports();
    });
    
    document.getElementById('allReportsTypeFilter').addEventListener('change', (e) => {
        currentTypeFilter.all = e.target.value;
        displayAllReports();
    });
    
    // Refresh buttons
    document.getElementById('refreshUnassigned').addEventListener('click', loadAllReports);
    document.getElementById('refreshMyReports').addEventListener('click', loadAllReports);
    document.getElementById('refreshAllReports').addEventListener('click', loadAllReports);
}

// Update report counts
function updateReportCounts() {
    // Unassigned counts
    const unassignedCounts = getStatusCounts(unassignedReports);
    document.getElementById('unassignedCount').textContent = unassignedReports.length;
    document.getElementById('unassigned-countAll').textContent = unassignedReports.length;
    document.getElementById('unassigned-countSubmitted').textContent = unassignedCounts.submitted || 0;
    document.getElementById('unassigned-countAcknowledged').textContent = unassignedCounts.acknowledged || 0;
    
    // My reports counts
    const myCounts = getStatusCounts(myReports);
    document.getElementById('myReportsCount').textContent = myReports.length;
    document.getElementById('my-countAll').textContent = myReports.length;
    document.getElementById('my-countAcknowledged').textContent = myCounts.acknowledged || 0;
    document.getElementById('my-countInProgress').textContent = myCounts['in-progress'] || 0;
    document.getElementById('my-countResolved').textContent = myCounts.resolved || 0;
    document.getElementById('my-countClosed').textContent = myCounts.closed || 0;
    
    // All reports counts (admin only)
    if (currentUserData.role === 'admin') {
        const allCounts = getStatusCounts(allReports);
        document.getElementById('allReportsCount').textContent = allReports.length;
        document.getElementById('all-countAll').textContent = allReports.length;
        document.getElementById('all-countSubmitted').textContent = allCounts.submitted || 0;
        document.getElementById('all-countAcknowledged').textContent = allCounts.acknowledged || 0;
        document.getElementById('all-countInProgress').textContent = allCounts['in-progress'] || 0;
        document.getElementById('all-countResolved').textContent = allCounts.resolved || 0;
        document.getElementById('all-countClosed').textContent = allCounts.closed || 0;
        document.getElementById('all-countRejected').textContent = allCounts.rejected || 0;
        document.getElementById('all-countFalse').textContent = allCounts['false-report'] || 0;
    }
}

function getStatusCounts(reports) {
    const counts = {};
    reports.forEach(report => {
        counts[report.status] = (counts[report.status] || 0) + 1;
    });
    return counts;
}

// Display functions
function displayUnassignedReports() {
    const container = document.getElementById('unassignedList');
    let filtered = filterReports(unassignedReports, 'unassigned');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-reports">📋 No unassigned reports</div>';
        return;
    }
    
    container.innerHTML = '';
    filtered.forEach(report => {
        const card = createReportCard(report, 'unassigned');
        container.appendChild(card);
    });
}

function displayMyReports() {
    const container = document.getElementById('myReportsList');
    let filtered = filterReports(myReports, 'my');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-reports">📋 No reports assigned to you</div>';
        return;
    }
    
    container.innerHTML = '';
    filtered.forEach(report => {
        const card = createReportCard(report, 'my');
        container.appendChild(card);
    });
}

function filterReports(reports, context) {
    let filtered = reports;
    
    // Filter by status
    if (currentStatusFilter[context] !== 'all') {
        filtered = filtered.filter(r => r.status === currentStatusFilter[context]);
    }
    
    // Filter by type
    if (currentTypeFilter[context] !== 'all') {
        filtered = filtered.filter(r => r.incidentType === currentTypeFilter[context]);
    }
    
    return filtered;
}

function displayAllReports() {
    const container = document.getElementById('allReportsList');
    
    if (!container) {
        console.error('ERROR: allReportsList container not found!');
        return;
    }
    
    if (!allReports || allReports.length === 0) {
        container.innerHTML = '<div class="no-reports">📋 No reports in database</div>';
        return;
    }
    
    let filtered = filterReports(allReports, 'all');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-reports">📋 No reports match the current filters<br><small style="color:#999;">Try clicking "All" status and selecting "All Types"</small></div>';
        return;
    }
    
    container.innerHTML = '';
    filtered.forEach(report => {
        const card = createReportCard(report, 'all');
        container.appendChild(card);
    });
}

// Create report card
function createReportCard(report, context) {
    const card = document.createElement('div');
    card.className = 'report-card';
    
    const statusClass = `status-${report.status.toLowerCase().replace(/[\s-]/g, '-')}`;
    const createdDate = formatFirestoreDate(report.createdAt);
    
    const isFinal = report.status === 'closed' || report.status === 'false-report' || report.status === 'rejected';
    const canModify = !isFinal;
    const isAssignedToMe = report.assignedTo === currentUser.uid;
    const isAdmin = currentUserData.role === 'admin';
    
    // Images HTML
    let imagesHtml = '';
    if (report.images && report.images.length > 0) {
        const allImages = JSON.stringify(report.images).replace(/"/g, '&quot;');
        imagesHtml = '<div class="report-images">';
        report.images.forEach((url, index) => {
            imagesHtml += `<img src="${url}" alt="Evidence ${index + 1}" onclick="openLightbox('${url}', ${allImages})">`;
        });
        imagesHtml += '</div>';
    }
    
    // Latest note - make it clickable to view full details
    let latestNoteHtml = '';
    if (report.investigationNotes && report.investigationNotes.length > 0) {
        const latestNote = report.investigationNotes[report.investigationNotes.length - 1];
        const noteDate = formatFirestoreDate(latestNote.timestamp);
        const totalNotes = report.investigationNotes.length;
        
        latestNoteHtml = `
            <div class="report-detail clickable-note" onclick="viewReportDetails('${report.id}')" style="background:#f0f7ff; padding:10px; border-radius:5px; margin-top:10px; cursor:pointer; transition: all 0.3s;" 
                 onmouseover="this.style.background='#e3f2fd'; this.style.transform='translateX(5px)';" 
                 onmouseout="this.style.background='#f0f7ff'; this.style.transform='translateX(0)';">
                <strong>📝 Latest Update:</strong> ${latestNote.note}<br>
                <small style="color:#666;">By: ${latestNote.staffName || latestNote.staffEmail} - ${noteDate}</small>
                ${totalNotes > 1 ? `<br><small style="color:#3498db; font-weight:600;">+${totalNotes - 1} more update(s) - Click to view full history →</small>` : ''}
            </div>
        `;
    }
    
    // Assignment badge
    let assignmentBadge = '';
    if (report.assignedTo) {
        const assignedStaff = allStaffMembers.find(s => s.uid === report.assignedTo);
        const assignedName = assignedStaff ? (assignedStaff.fullName || assignedStaff.email) : 
                            report.assignedToName || 'Unknown Staff';
        assignmentBadge = `<div class="assignment-badge">👤 Assigned to: ${assignedName}</div>`;
    }
    
    // Action buttons based on context and permissions
    let actionButtons = '';
    
    if (context === 'unassigned') {
        // Unassigned reports - "Assign to Me" for everyone, "Assign to Staff" for admin only
        actionButtons += `<button class="btn-primary" onclick="assignReportToMe('${report.id}')">✋ Assign to Me</button>`;
        if (isAdmin) {
            actionButtons += `<button class="btn-secondary" onclick="openTransferModal('${report.id}')">👥 Assign to Staff</button>`;
        }
    } else if (context === 'my') {
        // My assigned reports
        if (canModify) {
            actionButtons += `<button class="btn-primary" onclick="viewReportDetails('${report.id}')">📄 View Details</button>`;
            
            // Status progression
            if (report.status === 'submitted') {
                actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'acknowledged')">✓ Acknowledge</button>`;
            }
            if (report.status === 'acknowledged' || report.status === 'in-progress') {
                actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'in-progress')">🔄 Mark In Progress</button>`;
            }
            if (report.status === 'in-progress') {
                actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'resolved')">✅ Mark Resolved</button>`;
            }
            if (report.status === 'resolved') {
                actionButtons += `<button class="btn-secondary" onclick="updateStatus('${report.id}', 'closed')">🔒 Close Report</button>`;
            }
            
            actionButtons += `<button class="btn-warning" onclick="addNote('${report.id}')">📝 Add Note</button>`;
            
            if (report.status !== 'rejected') {
                actionButtons += `<button class="btn-danger" onclick="updateStatus('${report.id}', 'rejected')">❌ Reject</button>`;
            }
            
            actionButtons += `<button class="btn-danger" onclick="markFalseReport('${report.id}', '${report.userId}', '${report.userEmail}')">⚠️ Mark False</button>`;
            actionButtons += `<button class="btn-secondary" onclick="openTransferModal('${report.id}')">🔄 Transfer</button>`;
        } else {
            actionButtons += `<button class="btn-primary" onclick="viewReportDetails('${report.id}')">📄 View Details</button>`;
            actionButtons += `<span style="color:#999; font-size:14px; margin-left:10px;">Report is ${report.status} - No further actions</span>`;
        }
    } else if (context === 'all' && isAdmin) {
        // Admin view all reports
        actionButtons += `<button class="btn-primary" onclick="viewReportDetails('${report.id}')">📄 View Details</button>`;
        
        // Can modify if not final status
        if (canModify) {
            if (!report.assignedTo) {
                actionButtons += `<button class="btn-secondary" onclick="openTransferModal('${report.id}')">👥 Assign to Staff</button>`;
                actionButtons += `<button class="btn-primary" onclick="assignReportToMe('${report.id}')">✋ Assign to Me</button>`;
            } else {
                // Assigned report - admin can still manage it
                if (report.status === 'submitted' || report.status === 'acknowledged') {
                    actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'acknowledged')">✓ Acknowledge</button>`;
                }
                if (report.status === 'acknowledged' || report.status === 'in-progress') {
                    actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'in-progress')">🔄 Mark In Progress</button>`;
                }
                if (report.status === 'in-progress') {
                    actionButtons += `<button class="btn-primary" onclick="updateStatus('${report.id}', 'resolved')">✅ Mark Resolved</button>`;
                }
                if (report.status === 'resolved') {
                    actionButtons += `<button class="btn-secondary" onclick="updateStatus('${report.id}', 'closed')">🔒 Close</button>`;
                }
                
                actionButtons += `<button class="btn-warning" onclick="addNote('${report.id}')">📝 Add Note</button>`;
                actionButtons += `<button class="btn-secondary" onclick="openTransferModal('${report.id}')">🔄 Reassign</button>`;
                actionButtons += `<button class="btn-danger" onclick="markFalseReport('${report.id}', '${report.userId}', '${report.userEmail}')">⚠️ Mark False</button>`;
            }
        }
    }
    
    card.innerHTML = `
        <div class="report-header">
            <div class="report-meta">
                <div class="report-type">${formatIncidentType(report.incidentType)}</div>
                <div class="report-submitter">
                    Submitted by: ${report.userName || report.userEmail}<br>
                    <small style="color:#999;">Report ID: ${report.reportId || report.id}</small>
                </div>
                ${assignmentBadge}
            </div>
            <div class="report-status ${statusClass}">${report.status.toUpperCase().replace(/-/g, ' ')}</div>
        </div>
        
        <div class="report-body">
            <div class="report-detail"><strong>📅 Submitted:</strong> ${createdDate}</div>
            <div class="report-detail"><strong>📆 Incident Date:</strong> ${report.incidentDate}</div>
            <div class="report-detail"><strong>📍 Location:</strong> ${report.location}</div>
            <div class="report-detail"><strong>📝 Description:</strong> ${report.description}</div>
            ${latestNoteHtml}
            ${imagesHtml}
        </div>
        
        <div class="report-actions">
            ${actionButtons}
        </div>
    `;
    
    return card;
}

// Assign report to current user
window.assignReportToMe = async function(reportId) {
    const confirmed = await customConfirm(
        '<strong>Assign this report to yourself?</strong><br><br>You will be responsible for handling and resolving this incident.',
        {
            title: 'Assign Report',
            confirmText: '✋ Assign to Me',
            cancelText: 'Cancel',
            type: 'primary',
            icon: '✋'
        }
    );
    
    if (!confirmed) return;
    
    try {
        const reportRef = doc(db, 'incidentReports', reportId);
        
        await updateDoc(reportRef, {
            assignedTo: currentUser.uid,
            assignedToName: currentUserData?.fullName || currentUser.email,
            assignedAt: serverTimestamp(),
            status: 'acknowledged',
            updatedAt: serverTimestamp(),
            investigationNotes: arrayUnion({
                note: `Report assigned to ${currentUserData?.fullName || currentUser.email}`,
                staffEmail: currentUser.email,
                staffName: currentUserData?.fullName || currentUser.email,
                timestamp: Timestamp.now()
            })
        });
        
        await logActivity('assigned_report_to_self', {
            reportId: reportId
        });
        
        await logDocumentHistory(reportId, 'report_assigned', {
            assignedTo: currentUserData?.fullName || currentUser.email
        });
        
        await customAlert(
            '<strong>Report Assigned Successfully!</strong><br><br>The report has been assigned to you and its status has been updated to <strong>Acknowledged</strong>.',
            'success'
        );
        
        loadAllReports();
        
        document.querySelector('.tab-btn[data-tab="my-reports"]').click();
        
    } catch (error) {
        console.error('Error assigning report:', error);
        await customAlert(
            '<strong>Assignment Failed</strong><br><br>' + error.message,
            'error'
        );
    }
};

// Open transfer modal
window.openTransferModal = function(reportId) {
    const report = allReports.find(r => r.id === reportId);
    if (!report) return;
    
    document.getElementById('transferReportId').value = report.reportId || reportId;
    document.getElementById('transferModal').classList.add('show');
    
    // Store report ID for form submission
    window.currentTransferReportId = reportId;
};

window.closeTransferModal = function() {
    document.getElementById('transferModal').classList.remove('show');
    document.getElementById('transferForm').reset();
};

// Handle transfer form
document.getElementById('transferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const reportId = window.currentTransferReportId;
    const transferToUid = document.getElementById('transferToStaff').value;
    const reason = document.getElementById('transferReason').value;
    
    try {
        const targetStaff = allStaffMembers.find(s => s.uid === transferToUid);
        if (!targetStaff) {
            alert('Selected staff member not found');
            return;
        }
        
        const reportRef = doc(db, 'incidentReports', reportId);
        
        await updateDoc(reportRef, {
            assignedTo: transferToUid,
            assignedToName: targetStaff.fullName || targetStaff.email,
            assignedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            investigationNotes: arrayUnion({
                note: `Report transferred to ${targetStaff.fullName || targetStaff.email}. Reason: ${reason}`,
                staffEmail: currentUser.email,
                staffName: currentUserData?.fullName || currentUser.email,
                timestamp: Timestamp.now()
            })
        });
        
        await logActivity('transferred_report', {
            reportId: reportId,
            transferredTo: targetStaff.fullName || targetStaff.email,
            reason: reason
        });
        
        await logDocumentHistory(reportId, 'report_transferred', {
            transferredTo: targetStaff.fullName || targetStaff.email,
            transferredBy: currentUserData?.fullName || currentUser.email,
            reason: reason
        });
        
        alert(`Report transferred to ${targetStaff.fullName || targetStaff.email} successfully!`);
        closeTransferModal();
        loadAllReports();
        
    } catch (error) {
        console.error('Error transferring report:', error);
        alert('Failed to transfer report: ' + error.message);
    }
});

// ✅ NEW (appends to user's document)
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
                details: details,  // Keep lightweight
                timestamp: Timestamp.now()
            })
        }, { merge: true });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

// Document history
async function logDocumentHistory(reportId, action, details = {}) {
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

        const historyRef = collection(db, 'documentHistory', reportId, 'logs');
        await addDoc(historyRef, historyData);
    } catch (error) {
        console.error('Error writing document history:', error);
    }
}

// Helper function to format Firestore Timestamp
function formatFirestoreDate(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        if (timestamp.toDate && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().toLocaleString();
        }
        else if (timestamp.seconds) {
            return new Date(timestamp.seconds * 1000).toLocaleString();
        }
        else if (timestamp instanceof Date) {
            return timestamp.toLocaleString();
        }
        else if (typeof timestamp === 'number') {
            return new Date(timestamp).toLocaleString();
        }
    } catch (error) {
        console.error('Error formatting date:', error);
    }
    
    return 'N/A';
}

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

// Remaining functions (updateStatus, addNote, markFalseReport, etc.) will continue in next part...

// View report details modal
window.viewReportDetails = async function(reportId) {
    const report = allReports.find(r => r.id === reportId);
    if (!report) return;
    
    const modal = document.getElementById('reportModal');
    const modalBody = document.getElementById('modalBody');
    
    // Build evidence images section
    let imagesHtml = '';
    if (report.images && report.images.length > 0) {
        const allImages = JSON.stringify(report.images).replace(/"/g, '&quot;');
        imagesHtml = `
            <div class="modal-section">
                <h3>📷 Evidence Images</h3>
                <div class="report-images">
        `;
        report.images.forEach((url, index) => {
            imagesHtml += `<img src="${url}" alt="Evidence ${index + 1}" onclick="openLightbox('${url}', ${allImages})">`;
        });
        imagesHtml += '</div></div>';
    }
    
    // Build investigation timeline
    let timelineHtml = '';
    if (report.investigationNotes && report.investigationNotes.length > 0) {
        timelineHtml = `
            <div class="modal-section">
                <h3>📋 Investigation Timeline</h3>
                <div class="timeline">
        `;
        
        const sortedNotes = [...report.investigationNotes].sort((a, b) => {
            const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp?.seconds ? new Date(a.timestamp.seconds * 1000) : new Date(0));
            const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp?.seconds ? new Date(b.timestamp.seconds * 1000) : new Date(0));
            return timeA - timeB;
        });
        
        sortedNotes.forEach((note, index) => {
            let noteDate = 'Date unknown';
            if (note.timestamp) {
                if (note.timestamp.toDate) {
                    noteDate = note.timestamp.toDate().toLocaleString();
                } else if (note.timestamp.seconds) {
                    noteDate = new Date(note.timestamp.seconds * 1000).toLocaleString();
                }
            }
            const staffName = note.staffName || note.staffEmail || 'Staff';
            
            let noteImagesHtml = '';
            if (note.images && note.images.length > 0) {
                const noteAllImages = JSON.stringify(note.images).replace(/"/g, '&quot;');
                noteImagesHtml = '<div class="note-images" style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">';
                note.images.forEach((url, imgIndex) => {
                    noteImagesHtml += `
                        <img src="${url}" 
                             alt="Note image ${imgIndex + 1}" 
                             onclick="openLightbox('${url}', ${noteAllImages})"
                             style="width:80px; height:80px; object-fit:cover; border-radius:5px; cursor:pointer; border:2px solid #e0e0e0;">
                    `;
                });
                noteImagesHtml += '</div>';
            }
            
            timelineHtml += `
                <div class="timeline-item">
                    <div class="timeline-marker">${index + 1}</div>
                    <div class="timeline-content">
                        <div class="timeline-header">
                            <strong>${staffName}</strong>
                            <span class="timeline-date">${noteDate}</span>
                        </div>
                        <p>${note.note}</p>
                        ${noteImagesHtml}
                    </div>
                </div>
            `;
        });
        
        timelineHtml += '</div></div>';
    }
    
    // Assignment info
    let assignmentHtml = '';
    if (report.assignedTo) {
        const assignedStaff = allStaffMembers.find(s => s.uid === report.assignedTo);
        const assignedName = assignedStaff ? (assignedStaff.fullName || assignedStaff.email) : 
                            report.assignedToName || 'Unknown Staff';
        const assignedDate = formatFirestoreDate(report.assignedAt);
        assignmentHtml = `
            <div class="info-item">
                <strong>Assigned to:</strong>
                <span>${assignedName} (${assignedDate})</span>
            </div>
        `;
    }
    
    // Location with coordinates
    let locationHtml = report.location;
    if (report.locationCoordinates) {
        locationHtml += ` <small style="color:#999;">(${report.locationCoordinates.lat.toFixed(6)}, ${report.locationCoordinates.lng.toFixed(6)})</small>`;
    }
    
    const statusClass = `status-${report.status.toLowerCase().replace(/[\s-]/g, '-')}`;
    
    modalBody.innerHTML = `
        <div class="modal-section">
            <h3>ℹ️ Report Information</h3>
            <div class="info-grid">
                <div class="info-item">
                    <strong>Report ID:</strong>
                    <span>${report.reportId || reportId}</span>
                </div>
                <div class="info-item">
                    <strong>Type:</strong>
                    <span>${formatIncidentType(report.incidentType)}</span>
                </div>
                <div class="info-item">
                    <strong>Status:</strong>
                    <span class="report-status ${statusClass}" style="display:inline-block;">${report.status.toUpperCase().replace(/-/g, ' ')}</span>
                </div>
                <div class="info-item">
                    <strong>Submitted by:</strong>
                    <span>${report.userName || 'Unknown'} (${report.userEmail})</span>
                </div>
                <div class="info-item">
                    <strong>Submitted on:</strong>
                    <span>${formatFirestoreDate(report.createdAt)}</span>
                </div>
                <div class="info-item">
                    <strong>Incident Date:</strong>
                    <span>${report.incidentDate}</span>
                </div>
                ${assignmentHtml}
                <div class="info-item" style="grid-column: 1 / -1;">
                    <strong>Location:</strong>
                    <span>${locationHtml}</span>
                </div>
            </div>
        </div>
        
        <div class="modal-section">
            <h3>📝 Description</h3>
            <p>${report.description}</p>
        </div>
        
        ${imagesHtml}
        ${timelineHtml}
    `;
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    await logActivity('viewed_report_details', {
        reportId: report.reportId || reportId,
        incidentType: report.incidentType
    });
};

window.closeReportModal = function() {
    document.getElementById('reportModal').classList.remove('show');
    document.body.style.overflow = '';
};

// Update report status
window.updateStatus = async function(reportId, newStatus) {
    const report = allReports.find(r => r.id === reportId);
    
    // Check permission
    if (report.assignedTo && report.assignedTo !== currentUser.uid && currentUserData.role !== 'admin') {
        await customAlert(
            '<strong>Permission Denied</strong><br><br>You do not have permission to update this report.<br><br>It is assigned to another staff member.',
            'warning'
        );
        return;
    }
    
    let confirmMessage = '';
    let confirmOptions = {};
    let requireReason = false;
    
    switch(newStatus) {
        case 'acknowledged':
            confirmMessage = '<strong>Acknowledge this report?</strong><br><br>This will notify the submitter that you have received and reviewed their report.';
            confirmOptions = { title: 'Acknowledge Report', confirmText: '✓ Acknowledge', icon: '👀', type: 'primary' };
            break;
        case 'in-progress':
            confirmMessage = '<strong>Mark as In Progress?</strong><br><br>This indicates you are actively investigating or working on this incident.';
            confirmOptions = { title: 'Mark In Progress', confirmText: '🔄 Mark In Progress', icon: '🔄', type: 'primary' };
            break;
        case 'resolved':
            confirmMessage = '<strong>Mark as Resolved?</strong><br><br>This indicates the incident has been successfully handled and resolved.';
            confirmOptions = { title: 'Mark Resolved', confirmText: '✅ Mark Resolved', icon: '✅', type: 'success' };
            break;
        case 'closed':
            confirmMessage = '<strong>Close this report?</strong><br><br><div class="warning-box"><strong>⚠️ Warning:</strong> No further actions will be possible after closing.</div>This is a final action and cannot be easily reversed.';
            confirmOptions = { title: 'Close Report', confirmText: '🔒 Close Report', icon: '🔒', type: 'warning' };
            break;
        case 'rejected':
            confirmMessage = '<strong>Reject this report?</strong><br><br>You will need to provide a reason for rejection.';
            confirmOptions = { title: 'Reject Report', confirmText: '❌ Continue to Rejection', icon: '❌', type: 'danger' };
            requireReason = true;
            break;
        default:
            confirmMessage = `<strong>Change status to ${newStatus}?</strong>`;
            confirmOptions = { title: 'Change Status', confirmText: 'Confirm', icon: '❓' };
    }
    
    const confirmed = await customConfirm(confirmMessage, confirmOptions);
    if (!confirmed) return;
    
    let additionalNote = '';
    
    if (requireReason) {
        const reason = await customPrompt(
            'Please provide a detailed reason for rejecting this report:',
            {
                title: 'Rejection Reason Required',
                placeholder: 'E.g., Insufficient evidence, outside jurisdiction, duplicate report...',
                confirmText: '❌ Reject Report',
                cancelText: 'Cancel',
                type: 'danger',
                icon: '📝',
                isTextarea: true,
                rows: 4
            }
        );
        
        if (!reason) {
            await customAlert('Rejection cancelled - No reason provided.', 'info');
            return;
        }
        
        additionalNote = `REJECTED - Reason: ${reason}`;
    }
    
    await performStatusUpdate(reportId, newStatus, report, additionalNote);
};

async function performStatusUpdate(reportId, newStatus, report, additionalNote = '') {
    try {
        const reportRef = doc(db, 'incidentReports', reportId);
        
        const noteText = additionalNote || `Status changed to: ${newStatus}`;
        
        await updateDoc(reportRef, {
            status: newStatus,
            updatedAt: serverTimestamp(),
            investigationNotes: arrayUnion({
                note: noteText,
                staffEmail: currentUser.email,
                staffName: currentUserData?.fullName || currentUser.email,
                timestamp: Timestamp.now()
            })
        });
        
        await logActivity('updated_report_status', {
            reportId: report.reportId || reportId,
            oldStatus: report.status,
            newStatus: newStatus
        });
        
        await logDocumentHistory(reportId, 'status_updated', {
            oldStatus: report.status,
            newStatus: newStatus,
            note: additionalNote
        });
        
        alert(`Report status updated to: ${newStatus}`);
        loadAllReports();
        
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Failed to update status: ' + error.message);
    }
}

// Add investigation note
window.addNote = async function(reportId) {
    const report = allReports.find(r => r.id === reportId);
    
    // Check permission
    if (report.assignedTo && report.assignedTo !== currentUser.uid && currentUserData.role !== 'admin') {
        alert('You do not have permission to add notes to this report.');
        return;
    }
    
    if (report.status === 'closed' || report.status === 'false-report') {
        alert('Cannot add notes to a ' + report.status + ' report.');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <h2>Add Investigation Note</h2>
            <p style="color:#666; font-size:14px; margin-bottom:20px;">
                Report ID: ${report.reportId || reportId}
            </p>
            
            <form id="noteForm">
                <div class="form-group">
                    <label>Note *</label>
                    <textarea id="noteText" required placeholder="Enter investigation details, updates, or findings..." style="min-height:120px;"></textarea>
                </div>
                
                <div class="form-group">
                    <label>Attach Evidence Images (Optional - Max 3)</label>
                    <div style="border:2px dashed #e0e0e0; border-radius:8px; padding:20px; text-align:center; cursor:pointer;" onclick="document.getElementById('noteImages').click()">
                        <p>📷 Click to upload images</p>
                        <p style="font-size:12px; color:#999;">Photos of site visit, resolved issue, etc.</p>
                    </div>
                    <input type="file" id="noteImages" accept="image/*" multiple style="display:none;" />
                    <div id="noteImagePreview" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;"></div>
                </div>
                
                <div class="form-actions">
                    <button type="submit" class="btn-primary">Add Note</button>
                    <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    let selectedNoteImages = [];
    const MAX_NOTE_IMAGES = 3;
    
    document.getElementById('noteImages').addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        
        if (selectedNoteImages.length + files.length > MAX_NOTE_IMAGES) {
            alert(`Maximum ${MAX_NOTE_IMAGES} images allowed`);
            return;
        }
        
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                selectedNoteImages.push(file);
                
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const preview = document.getElementById('noteImagePreview');
                    const div = document.createElement('div');
                    div.style.cssText = 'position:relative; width:80px; height:80px;';
                    div.innerHTML = `
                        <img src="${ev.target.result}" style="width:100%; height:100%; object-fit:cover; border-radius:5px; border:2px solid #e0e0e0;">
                        <button type="button" onclick="this.parentElement.remove(); selectedNoteImages.splice(${selectedNoteImages.length - 1}, 1);" 
                                style="position:absolute; top:-5px; right:-5px; background:#e74c3c; color:white; border:none; border-radius:50%; width:20px; height:20px; cursor:pointer; font-size:12px;">×</button>
                    `;
                    preview.appendChild(div);
                };
                reader.readAsDataURL(file);
            }
        });
        
        e.target.value = '';
    });
    
    document.getElementById('noteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const noteText = document.getElementById('noteText').value.trim();
        if (!noteText) {
            alert('Please enter a note');
            return;
        }
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';
        
        try {
            const imageUrls = [];
            for (let i = 0; i < selectedNoteImages.length; i++) {
                const file = selectedNoteImages[i];
                const timestamp = Date.now();
                const fileExt = file.name.split('.').pop();
                const storagePath = `incident-reports/${reportId}/notes/${timestamp}_${i}.${fileExt}`;
                const storageRef = ref(storage, storagePath);
                
                const snapshot = await uploadBytes(storageRef, file);
                const url = await getDownloadURL(snapshot.ref);
                imageUrls.push(url);
            }
            
            const reportRef = doc(db, 'incidentReports', reportId);
            await updateDoc(reportRef, {
                updatedAt: serverTimestamp(),
                investigationNotes: arrayUnion({
                    note: noteText,
                    staffEmail: currentUser.email,
                    staffName: currentUserData?.fullName || currentUser.email,
                    timestamp: Timestamp.now(),
                    images: imageUrls
                })
            });
            
            await logActivity('added_investigation_note', {
                reportId: report.reportId || reportId,
                notePreview: noteText.substring(0, 50) + '...',
                hasImages: imageUrls.length > 0
            });
            
            await logDocumentHistory(reportId, 'note_added', {
                notePreview: noteText.substring(0, 100),
                imageCount: imageUrls.length
            });
            
            alert('Note added successfully' + (imageUrls.length > 0 ? ` with ${imageUrls.length} image(s)` : ''));
            modal.remove();
            loadAllReports();
            
        } catch (error) {
            console.error('Error adding note:', error);
            alert('Failed to add note: ' + error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Note';
        }
    });
    
    window.selectedNoteImages = selectedNoteImages;
};

// Mark as false report
window.markFalseReport = async function(reportId, userId, userEmail) {
    const report = allReports.find(r => r.id === reportId);
    
    // Check permission
    if (report.assignedTo && report.assignedTo !== currentUser.uid && currentUserData.role !== 'admin') {
        await customAlert(
            '<strong>Permission Denied</strong><br><br>You do not have permission to mark this report as false.',
            'warning'
        );
        return;
    }
    
    const confirmed = await customConfirm(
        `<strong>Mark as FALSE REPORT?</strong><br><br>
        <div class="danger-box">
            <strong>⚠️ SERIOUS ACTION:</strong><br>
            This will:<br>
            <ul style="margin:10px 0; padding-left:20px;">
                <li>Flag the user's account</li>
                <li>Add a warning to their record</li>
                <li>May result in automatic restrictions</li>
                <li>Impact their ability to submit future reports</li>
            </ul>
        </div>
        <strong>User:</strong> ${userEmail}<br>
        <strong>Report ID:</strong> ${report.reportId || reportId}<br><br>
        Only proceed if you are certain this is a false report.`,
        {
            title: 'Confirm False Report',
            confirmText: '⚠️ Mark as False',
            cancelText: 'Cancel',
            type: 'danger',
            icon: '⚠️'
        }
    );
    
    if (!confirmed) return;
    
    try {
        const reportRef = doc(db, 'incidentReports', reportId);
        await updateDoc(reportRef, {
            status: 'false-report',
            updatedAt: serverTimestamp(),
            investigationNotes: arrayUnion({
                note: 'MARKED AS FALSE REPORT',
                staffEmail: currentUser.email,
                staffName: currentUserData?.fullName || currentUser.email,
                timestamp: Timestamp.now()
            })
        });
        
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const currentCount = userDoc.data().falseReportCount || 0;
            const newCount = currentCount + 1;
            
            let autoRestrict = false;
            let restrictDays = 0;
            let restrictLevel = 'warning';
            let restrictReason = '';
            
            if (newCount === 2) {
                autoRestrict = true;
                restrictDays = 7;
                restrictLevel = 'temporary';
                restrictReason = '2nd false report - Automatic 7-day restriction';
            } else if (newCount === 3) {
                autoRestrict = true;
                restrictDays = 30;
                restrictLevel = 'extended';
                restrictReason = '3rd false report - Automatic 30-day restriction';
            } else if (newCount >= 4) {
                autoRestrict = true;
                restrictDays = 90;
                restrictLevel = 'severe';
                restrictReason = '4+ false reports - Severe restriction';
            }
            
            const updateData = {
                warnings: arrayUnion({
                    reportId: reportId,
                    reason: 'False incident report',
                    issuedBy: currentUser.email,
                    issuedAt: Timestamp.now()
                }),
                falseReportCount: newCount
            };
            
            if (autoRestrict) {
                const restrictionEnd = new Date();
                restrictionEnd.setDate(restrictionEnd.getDate() + restrictDays);
                
                updateData.reportingRestricted = true;
                updateData.restrictionLevel = restrictLevel;
                updateData.restrictionStartDate = Timestamp.now();
                updateData.restrictionEndDate = Timestamp.fromDate(restrictionEnd);
                updateData.restrictionReason = restrictReason;
                updateData.restrictedBy = currentUser.email;
                updateData.restrictedAt = Timestamp.now();
            }
            
            await updateDoc(userRef, updateData);
            
            let message = `<strong>Report Marked as False</strong><br><br>User <strong>${userEmail}</strong> now has <strong>${newCount}</strong> warning(s).`;
            
            if (autoRestrict) {
                message += `<br><br><div class="danger-box"><strong>🚫 AUTOMATIC RESTRICTION APPLIED</strong><br><br><strong>Duration:</strong> ${restrictDays} days<br><strong>Level:</strong> ${restrictLevel}<br><strong>Reason:</strong> ${restrictReason}</div>`;
            } else if (newCount === 1) {
                message += '<br><br><div class="warning-box"><strong>⚠️ First Warning Issued</strong><br>Next false report will result in automatic 7-day restriction.</div>';
            }
            
            await customAlert(message, autoRestrict ? 'warning' : 'success');
            
            // Admin can add additional restrictions for 4+ false reports
            if (newCount >= 4 && currentUserData.role === 'admin') {
                const addMore = await customConfirm(
                    '<strong>Additional Restriction?</strong><br><br>This user has 4+ false reports. Would you like to add a custom restriction period?',
                    {
                        title: 'Additional Restriction',
                        confirmText: 'Yes, Add Custom Restriction',
                        cancelText: 'No, Keep Current',
                        type: 'warning',
                        icon: '⚠️'
                    }
                );
                
                if (addMore) {
                    currentReportId = reportId;
                    currentReportUserId = userId;
                    document.getElementById('restrictUserEmail').value = userEmail;
                    document.getElementById('restrictionModal').classList.add('show');
                }
            }
        } else {
            await setDoc(userRef, {
                uid: userId,
                email: userEmail,
                role: 'resident',
                falseReportCount: 1,
                warnings: [{
                    reportId: reportId,
                    reason: 'False incident report',
                    issuedBy: currentUser.email,
                    issuedAt: Timestamp.now()
                }],
                reportingRestricted: false
            });
            
            await customAlert(
                '<strong>Report Marked as False</strong><br><br>User document created with 1 warning.<br><br><div class="warning-box"><strong>⚠️ First Warning Issued</strong></div>',
                'success'
            );
        }
        
        await logActivity('marked_false_report', {
            reportId: report.reportId || reportId,
            flaggedUser: userEmail
        });
        
        await logDocumentHistory(reportId, 'marked_as_false', {
            flaggedUser: userEmail
        });
        
        loadAllReports();
        
    } catch (error) {
        console.error('Error marking false report:', error);
        await customAlert(
            '<strong>Failed to Mark as False Report</strong><br><br>' + error.message,
            'error'
        );
    }
};

// Restriction modal handlers
window.closeRestrictionModal = function() {
    document.getElementById('restrictionModal').classList.remove('show');
    document.getElementById('restrictionForm').reset();
};

document.getElementById('restrictionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const duration = parseInt(document.getElementById('restrictionDuration').value);
    const reason = document.getElementById('restrictionReason').value;
    const userEmail = document.getElementById('restrictUserEmail').value;
    
    try {
        const userRef = doc(db, 'users', currentReportUserId);
        const restrictionEnd = new Date();
        restrictionEnd.setDate(restrictionEnd.getDate() + duration);
        
        await updateDoc(userRef, {
            reportingRestricted: true,
            restrictionEndDate: Timestamp.fromDate(restrictionEnd),
            restrictionReason: reason,
            restrictedBy: currentUser.email,
            restrictedAt: serverTimestamp()
        });
        
        await logActivity('restricted_user_reporting', {
            restrictedUser: userEmail,
            duration: duration + ' days',
            reason: reason
        });
        
        alert(`User reporting privileges restricted for ${duration} days`);
        closeRestrictionModal();
        
    } catch (error) {
        console.error('Error restricting user:', error);
        alert('Failed to apply restriction: ' + error.message);
    }
});

// Lightbox functions
window.openLightbox = function(imageUrl, allImages = []) {
    currentLightboxImages = allImages.length > 0 ? allImages : [imageUrl];
    currentLightboxIndex = currentLightboxImages.indexOf(imageUrl);
    
    if (currentLightboxIndex === -1) {
        currentLightboxIndex = 0;
    }
    
    showLightboxImage();
    document.getElementById('imageLightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
};

window.closeLightbox = function() {
    document.getElementById('imageLightbox').classList.remove('show');
    document.body.style.overflow = '';
};

window.changeLightboxImage = function(direction) {
    currentLightboxIndex += direction;
    
    if (currentLightboxIndex >= currentLightboxImages.length) {
        currentLightboxIndex = 0;
    } else if (currentLightboxIndex < 0) {
        currentLightboxIndex = currentLightboxImages.length - 1;
    }
    
    showLightboxImage();
};

function showLightboxImage() {
    const lightboxImage = document.getElementById('lightboxImage');
    const lightboxCounter = document.getElementById('lightboxCounter');
    const currentUrl = currentLightboxImages[currentLightboxIndex];
    
    lightboxImage.src = currentUrl;
    
    const prevBtn = document.querySelector('.lightbox-prev');
    const nextBtn = document.querySelector('.lightbox-next');
    
    if (currentLightboxImages.length > 1) {
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
        lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${currentLightboxImages.length}`;
        lightboxCounter.style.display = 'block';
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        lightboxCounter.style.display = 'none';
    }
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox && lightbox.classList.contains('show')) {
        if (e.key === 'Escape') {
            closeLightbox();
        } else if (e.key === 'ArrowLeft') {
            changeLightboxImage(-1);
        } else if (e.key === 'ArrowRight') {
            changeLightboxImage(1);
        }
    }
});

// Click outside modals to close
window.onclick = function(event) {
    const reportModal = document.getElementById('reportModal');
    const restrictionModal = document.getElementById('restrictionModal');
    const transferModal = document.getElementById('transferModal');
    const lightbox = document.getElementById('imageLightbox');
    
    if (event.target === reportModal) {
        closeReportModal();
    }
    if (event.target === restrictionModal) {
        closeRestrictionModal();
    }
    if (event.target === transferModal) {
        closeTransferModal();
    }
    if (event.target === lightbox) {
        closeLightbox();
    }
};

// Touch/Swipe support
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('DOMContentLoaded', () => {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox) {
        lightbox.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, false);

        lightbox.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, false);
    }
});

function handleSwipe() {
    const swipeThreshold = 50;
    
    if (touchEndX < touchStartX - swipeThreshold) {
        if (currentLightboxImages.length > 1) {
            changeLightboxImage(1);
        }
    }
    
    if (touchEndX > touchStartX + swipeThreshold) {
        if (currentLightboxImages.length > 1) {
            changeLightboxImage(-1);
        }
    }
}
