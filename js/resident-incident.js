import { auth, db, storage } from '../firebase-config.js';
import { 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    getDocs,
    onSnapshot,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,  // ← ADD THIS
    serverTimestamp,
    arrayUnion,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import { 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';

let currentUser = null;
let currentUserData = null;
let selectedImages = [];
const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
let currentLightboxImages = [];
let currentLightboxIndex = 0;
let allReports = []; // Store all reports
let currentStatusFilter = 'all'; // Current filter
let userLocation = null; // Store user's location
// Search and filter state
let currentSearchTerm = '';
let currentDateFrom = '';
let currentDateTo = '';
let existingImages = [];

// Check authentication
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        await checkRestrictions();
        await loadUserProfile();
        highlightActiveNav();
        loadMyReports();
        initializeDateRestrictions();
        initializeTabs();
        initializeStatusFilters();
        initializeLocationFeature();
    } else {
        window.location.href = '../index.html';
    }
});

// Initialize date input restrictions
function initializeDateRestrictions() {
    const incidentDateInput = document.getElementById('incidentDate');
    const today = new Date().toISOString().split('T')[0];
    incidentDateInput.setAttribute('max', today);
    
    // Set default to today
    if (!incidentDateInput.value) {
        incidentDateInput.value = today;
    }
}

// Initialize tab navigation
function initializeTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            // Remove active class from all tabs and contents
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Add active class to clicked tab and corresponding content
            btn.classList.add('active');
            if (targetTab === 'submit') {
                document.getElementById('submitTab').classList.add('active');
            } else if (targetTab === 'reports') {
                document.getElementById('reportsTab').classList.add('active');
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
            
            // Remove active class from all chips
            filterChips.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked chip
            chip.classList.add('active');
            
            // Update current filter and display
            currentStatusFilter = status;
            displayFilteredReports();
        });
    });
}

// ==================== LOCATION FEATURES ====================

function initializeLocationFeature() {
    const locationInput = document.getElementById('location');
    const getLocationBtn = document.getElementById('getLocationBtn');
    const locationStatus = document.getElementById('locationStatus');
    
    // Add click event to get location button
    getLocationBtn.addEventListener('click', getCurrentLocation);
    
    // Try to get location automatically on page load (optional)
    // Uncomment the line below if you want auto-location on load
    // getCurrentLocation();
}

async function getCurrentLocation() {
    const locationInput = document.getElementById('location');
    const getLocationBtn = document.getElementById('getLocationBtn');
    const locationStatus = document.getElementById('locationStatus');
    
    // Check if geolocation is supported
    if (!navigator.geolocation) {
        showLocationStatus('Geolocation is not supported by your browser', 'error');
        return;
    }
    
    // Show loading state
    getLocationBtn.disabled = true;
    getLocationBtn.innerHTML = '🔄 Getting location...';
    showLocationStatus('Getting your location...', 'loading');
    
    // Get position
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            userLocation = { lat, lng };
            
            // Try to get address from coordinates using reverse geocoding
            try {
                const address = await reverseGeocode(lat, lng);
                locationInput.value = address;
                showLocationStatus('✓ Location detected successfully', 'success');
            } catch (error) {
                console.error('Geocoding error:', error);
                locationInput.value = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                showLocationStatus('Location detected (coordinates only)', 'success');
            }
            
            getLocationBtn.disabled = false;
            getLocationBtn.innerHTML = '📍 Update Location';
        },
        (error) => {
            console.error('Geolocation error:', error);
            
            let errorMessage = 'Unable to get location';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Location permission denied. Please enable location access.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Location information unavailable.';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Location request timed out.';
                    break;
            }
            
            showLocationStatus(errorMessage, 'error');
            getLocationBtn.disabled = false;
            getLocationBtn.innerHTML = '📍 Get My Location';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
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
        
        // Set icon and title based on type
        const configs = {
            info: { icon: 'ℹ️', title: 'Information', headerClass: '' },
            warning: { icon: '⚠️', title: 'Warning', headerClass: 'warning' },
            error: { icon: '❌', title: 'Error', headerClass: 'danger' },
            success: { icon: '✅', title: 'Success', headerClass: 'success' }
        };
        
        const config = configs[type] || configs.info;
        
        icon.textContent = config.icon;
        title.textContent = config.title;
        body.innerHTML = message.replace(/\n/g, '<br>');
        
        // Reset header class
        header.className = 'custom-modal-header';
        if (config.headerClass) {
            header.classList.add(config.headerClass);
        }
        
        // Create button
        footer.innerHTML = `
            <button class="custom-modal-btn primary" onclick="closeCustomModal()">
                OK
            </button>
        `;
        
        overlay.classList.add('show');
        
        // Set up close handler
        window.closeCustomModal = () => {
            overlay.classList.remove('show');
            resolve(true);
        };
        
        // Close on overlay click
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
        
        // Set header class
        header.className = 'custom-modal-header';
        if (type) {
            header.classList.add(type);
        }
        
        // Create buttons
        footer.innerHTML = `
            <button class="custom-modal-btn secondary" id="customModalCancel">
                ${cancelText}
            </button>
            <button class="custom-modal-btn ${type}" id="customModalConfirm">
                ${confirmText}
            </button>
        `;
        
        overlay.classList.add('show');
        
        // Focus on confirm button
        setTimeout(() => {
            document.getElementById('customModalConfirm')?.focus();
        }, 100);
        
        // Set up button handlers
        document.getElementById('customModalConfirm').onclick = () => {
            overlay.classList.remove('show');
            resolve(true);
        };
        
        document.getElementById('customModalCancel').onclick = () => {
            overlay.classList.remove('show');
            resolve(false);
        };
        
        // Close on overlay click = cancel
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                resolve(false);
            }
        };
        
        // ESC key = cancel
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
            validateText = null
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
        
        body.innerHTML = `
            <p>${message.replace(/\n/g, '<br>')}</p>
            <input 
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
            >
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
        
        // Focus input
        setTimeout(() => {
            document.getElementById('customModalInput')?.focus();
        }, 100);
        
        const confirmAction = () => {
            const input = document.getElementById('customModalInput');
            const value = input.value.trim();
            
            // Validate if required
            if (validateText && value !== validateText) {
                input.style.borderColor = '#e74c3c';
                input.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    input.style.animation = '';
                }, 500);
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
        
        // Enter key = confirm
        document.getElementById('customModalInput').onkeypress = (e) => {
            if (e.key === 'Enter') {
                confirmAction();
            }
        };
        
        // Close on overlay click = cancel
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                resolve(null);
            }
        };
    });
}

// Reverse geocoding using OpenStreetMap Nominatim (free, no API key needed)
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
            {
                headers: {
                    'User-Agent': 'BarangayIncidentSystem/1.0'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error('Geocoding service unavailable');
        }
        
        const data = await response.json();
        
        // Build a readable address from the components
        const address = data.address;
        let locationString = '';
        
        // Try to build a meaningful address
        if (address.road) {
            locationString = address.road;
            if (address.house_number) {
                locationString = address.house_number + ' ' + locationString;
            }
        } else if (address.neighbourhood) {
            locationString = address.neighbourhood;
        } else if (address.suburb) {
            locationString = address.suburb;
        }
        
        // Add barangay/village if available
        if (address.village || address.suburb) {
            const area = address.village || address.suburb;
            locationString += locationString ? ', ' + area : area;
        }
        
        // Add city
        if (address.city || address.town || address.municipality) {
            const city = address.city || address.town || address.municipality;
            locationString += locationString ? ', ' + city : city;
        }
        
        // If we still don't have a good address, use display_name
        if (!locationString || locationString.length < 10) {
            locationString = data.display_name;
        }
        
        return locationString;
        
    } catch (error) {
        console.error('Reverse geocoding failed:', error);
        throw error;
    }
}

function showLocationStatus(message, type) {
    const locationStatus = document.getElementById('locationStatus');
    locationStatus.textContent = message;
    locationStatus.className = 'location-status ' + type;
    locationStatus.style.display = 'block';
    
    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            locationStatus.style.display = 'none';
        }, 5000);
    }
}

// Load user data with better fallback handling
async function loadUserData() {
    try {
        // Try users collection first
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            currentUserData = userDoc.data();
            return;
        }
        
        // Fallback to residents collection (by email)
        try {
            const residentDoc = await getDoc(doc(db, 'residents', currentUser.email));
            if (residentDoc.exists()) {
                currentUserData = residentDoc.data();
                return;
            }
        } catch (residentError) {
            console.log('No resident document found:', residentError);
        }
        
        // Create default user data if none exists
        console.log('Creating default user data');
        currentUserData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUser.displayName || 'Resident User',
            role: 'resident'
        };
        
        // Optionally save this to Firestore
        await setDoc(doc(db, 'users', currentUser.uid), currentUserData, { merge: true });
        
    } catch (error) {
        console.error('Error loading user data:', error);
        currentUserData = { 
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: 'Resident User'
        };
    }
}

// Check if user has reporting restrictions with auto-expiry
async function checkRestrictions() {
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (!userDoc.exists()) return;
        
        const userData = userDoc.data();
        const notice = document.getElementById('restrictionNotice');
        
        // Check active restrictions
        if (userData.reportingRestricted) {
            const restrictionEnd = userData.restrictionEndDate?.toDate();
            const now = new Date();
            
            if (restrictionEnd && restrictionEnd > now) {
                // Still restricted
                const daysLeft = Math.ceil((restrictionEnd - now) / (1000 * 60 * 60 * 24));
                const hoursLeft = Math.ceil((restrictionEnd - now) / (1000 * 60 * 60));
                
                const timeDisplay = daysLeft > 0 ? `${daysLeft} day(s)` : `${hoursLeft} hour(s)`;
                
                notice.innerHTML = `
                    <strong>⚠️ Reporting Restricted</strong><br>
                    Your reporting privileges are temporarily restricted for ${timeDisplay}.<br>
                    <strong>Until:</strong> ${restrictionEnd.toLocaleString()}<br>
                    <strong>Reason:</strong> ${userData.restrictionReason || 'Previous false reports'}<br>
                    <small style="color:#666;">False reports: ${userData.falseReportCount || 0}</small>
                `;
                notice.classList.add('show');
                
                // Disable form
                disableReportForm();
                return; // Don't show warnings if restricted
                
            } else if (restrictionEnd && restrictionEnd <= now) {
                // Restriction expired - auto-remove
                console.log('Restriction expired, removing...');
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    reportingRestricted: false,
                    restrictionEndDate: null,
                    restrictionReason: null,
                    restrictedBy: null,
                    restrictedAt: null
                });
                notice.classList.remove('show');
            }
        }
        
        // Show warnings if any (but not restricted)
        if (userData.warnings && userData.warnings.length > 0 && !userData.reportingRestricted) {
            const warningCount = userData.warnings.length;
            const falseCount = userData.falseReportCount || 0;
            
            let warningMessage = `
                <strong>⚠️ Warning Notice</strong><br>
                You have ${warningCount} warning(s) for false reports.<br>
                <strong>False reports count: ${falseCount}</strong><br>
                Please ensure all reports are accurate and truthful.
            `;
            
            // Add escalating warnings
            if (falseCount === 1) {
                warningMessage += `<br><span style="color:#f39c12;">⚠️ Next false report will result in 7-day restriction.</span>`;
            } else if (falseCount === 2) {
                warningMessage += `<br><span style="color:#e74c3c;">⚠️ <strong>SEVERE WARNING:</strong> Next false report will result in 30-day restriction!</span>`;
            } else if (falseCount >= 3) {
                warningMessage += `<br><span style="color:#c0392b;">⚠️ <strong>FINAL WARNING:</strong> Next false report may result in permanent restriction!</span>`;
            }
            
            notice.innerHTML = warningMessage;
            notice.classList.add('show');
        }
        
    } catch (error) {
        console.error('Error checking restrictions:', error);
    }
}

// Disable report form
function disableReportForm() {
    document.getElementById('submitBtn').disabled = true;
    document.querySelectorAll('#incidentForm input, #incidentForm select, #incidentForm textarea').forEach(el => {
        el.disabled = true;
    });
    document.getElementById('imageUpload').style.pointerEvents = 'none';
    document.getElementById('imageUpload').style.opacity = '0.5';
}

// Generate user initials from name or email
function getUserInitials() {
    if (currentUserData?.firstName && currentUserData?.lastName) {
        return `${currentUserData.firstName[0]}${currentUserData.lastName[0]}`.toUpperCase();
    } else if (currentUserData?.fullName) {
        const nameParts = currentUserData.fullName.split(' ').filter(p => p.length > 0);
        if (nameParts.length >= 2) {
            return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
        } else if (nameParts.length === 1) {
            return nameParts[0].substring(0, 2).toUpperCase();
        }
    }
    // Fallback to email
    return currentUser.email.substring(0, 2).toUpperCase();
}

// Generate clean report ID
function generateReportId() {
    const timestamp = Date.now();
    const initials = getUserInitials();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `IR_${initials}_${timestamp}_${random}`;
}

// ✅ OPTIMIZED - Appends to user's single document
async function logActivity(action, details = {}) {
    if (!currentUser || !currentUserData) return;

    const userId = currentUser.email.toLowerCase(); // Use email as document ID
    const fullName = currentUserData?.fullName || 
                     `${currentUserData?.firstName || ''} ${currentUserData?.lastName || ''}`.trim() || 
                     currentUser.email;

    try {
        const logRef = doc(db, 'activityLogs', userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: 'resident',
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

// Document history logging
async function logDocumentHistory(reportId, action, details = {}) {
    if (!currentUser || !currentUserData) return;

    try {
        const historyData = {
            action: action,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            userName: currentUserData?.fullName || 
                     `${currentUserData?.firstName || ''} ${currentUserData?.lastName || ''}`.trim() || 
                     currentUser.email,
            userType: 'resident',
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

// Image upload handling with validation
const imageUpload = document.getElementById('imageUpload');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');

imageUpload.addEventListener('click', () => {
    imageInput.click();
});

// ✅ MODIFIED: Image input handler to support edit mode
imageInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    
    // Check total image count (existing + new)
    const totalImages = existingImages.length + selectedImages.length + files.length;
    
    if (totalImages > MAX_IMAGES) {
        showError(`Maximum ${MAX_IMAGES} images allowed (you have ${existingImages.length} existing, trying to add ${files.length} more)`);
        return;
    }
    
    files.forEach(file => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            showError(`${file.name} is not an image file`);
            return;
        }
        
        // Validate file size
        if (file.size > MAX_IMAGE_SIZE) {
            const sizeMB = (MAX_IMAGE_SIZE / (1024 * 1024)).toFixed(0);
            showError(`${file.name} is too large. Maximum size is ${sizeMB}MB`);
            return;
        }
        
        selectedImages.push(file);
    });
    
    // Check if we're in edit mode
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn.dataset.editingReportId) {
        refreshEditImagePreview();
    } else {
        displayImagePreview(files[files.length - 1]);
    }
    
    imageInput.value = '';
});

function displayImagePreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        const index = selectedImages.length - 1;
        div.innerHTML = `
            <img src="${e.target.result}" alt="Preview">
            <button type="button" class="remove-image" data-index="${index}">×</button>
        `;
        imagePreview.appendChild(div);
        
        // Add event listener to remove button
        div.querySelector('.remove-image').addEventListener('click', function() {
            removeImage(parseInt(this.dataset.index));
        });
    };
    reader.readAsDataURL(file);
}

window.removeImage = function(index) {
    selectedImages.splice(index, 1);
    refreshImagePreview();
};

function refreshImagePreview() {
    imagePreview.innerHTML = '';
    selectedImages.forEach(file => displayImagePreview(file));
}

// Form submission with improved error handling
document.getElementById('incidentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const editingReportId = submitBtn.dataset.editingReportId;
    
    // Check if we're editing or creating new
    if (editingReportId) {
        // UPDATE EXISTING REPORT
        await updateExistingReport(editingReportId);
        return;
    }
    
    // CREATE NEW REPORT (existing code below)
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    
    try {
        // ... rest of your existing submission code stays the same ...
        // Validate incident date
        const incidentDate = document.getElementById('incidentDate').value;
        const selectedDate = new Date(incidentDate);
        const today = new Date();
        today.setHours(23, 59, 59, 999); // End of today
        
        if (selectedDate > today) {
            showError('Incident date cannot be in the future');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Report';
            return;
        }
        
        // Generate clean report ID
        const reportId = generateReportId();
        
        // Upload images with error handling
        const imageUrls = [];
        const uploadErrors = [];
        
        for (let i = 0; i < selectedImages.length; i++) {
            try {
                const file = selectedImages[i];
                const timestamp = Date.now();
                const fileExt = file.name.split('.').pop();
                const storagePath = `incident-reports/${reportId}/image_${i + 1}.${fileExt}`;
                const storageRef = ref(storage, storagePath);
                
                submitBtn.textContent = `Uploading image ${i + 1}/${selectedImages.length}...`;
                
                const snapshot = await uploadBytes(storageRef, file);
                const url = await getDownloadURL(snapshot.ref);
                imageUrls.push(url);
            } catch (uploadError) {
                console.error(`Error uploading image ${i + 1}:`, uploadError);
                uploadErrors.push(`Image ${i + 1}: ${uploadError.message}`);
            }
        }
        
        // Show warning if some images failed
        if (uploadErrors.length > 0 && imageUrls.length === 0) {
            throw new Error('All image uploads failed. Please try again.');
        } else if (uploadErrors.length > 0) {
            console.warn('Some images failed to upload:', uploadErrors);
        }
        
        submitBtn.textContent = 'Creating report...';
        
        // Get form data
        const incidentType = document.getElementById('incidentType').value;
        const description = document.getElementById('description').value;
        const location = document.getElementById('location').value;
        
        // Create incident report with custom ID
        const incidentData = {
            reportId: reportId,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            userName: currentUserData?.fullName || 
                     `${currentUserData?.firstName || ''} ${currentUserData?.lastName || ''}`.trim() || 
                     'Unknown',
            incidentType: incidentType,
            description: description,
            location: location,
            locationCoordinates: userLocation ? {
                lat: userLocation.lat,
                lng: userLocation.lng
            } : null,
            incidentDate: incidentDate,
            images: imageUrls,
            status: 'submitted',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            investigationNotes: [],
            staffReviews: []
        };
        
        // Save to Firestore
        await setDoc(doc(db, 'incidentReports', reportId), incidentData);
        
        // Log activity
        await logActivity('incident_report_submitted', {
            reportId: reportId,
            incidentType: incidentType,
            location: location,
            hasImages: imageUrls.length > 0
        });
        
        // Log to document history
        await logDocumentHistory(reportId, 'report_created', {
            incidentType: incidentType,
            location: location,
            status: 'submitted',
            imageCount: imageUrls.length
        });
        
        let successMessage = `Incident report submitted successfully!\n\nReport ID: ${reportId}`;
        if (uploadErrors.length > 0) {
            successMessage += `\n\nNote: ${uploadErrors.length} image(s) failed to upload.`;
        }
        
        showSuccess(successMessage);
        
        // Reset form
        document.getElementById('incidentForm').reset();
        selectedImages = [];
        imagePreview.innerHTML = '';
        
        // Reset date to today
        const todayDate = new Date().toISOString().split('T')[0];
        document.getElementById('incidentDate').value = todayDate;
        
        // Reload reports after delay
        setTimeout(() => {
            loadMyReports();
            hideMessages();
            
            // Switch to reports tab
            document.querySelector('.tab-btn[data-tab="reports"]').click();
        }, 3000);
        
    } catch (error) {
        console.error('Error submitting report:', error);
        showError('Failed to submit report: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report';
    }
});

// Load user's previous reports
function loadMyReports() {
    const reportsList = document.getElementById('reportsList');
    reportsList.innerHTML = '<p style="text-align:center; color:#999; padding:40px;">Loading your reports...</p>';
    
    try {
        const q = query(
            collection(db, 'incidentReports'),
            where('userId', '==', currentUser.uid),
            orderBy('createdAt', 'desc')
        );
        
        // 🔥 Real-time listener (onSnapshot instead of getDocs)
        const unsubscribe = onSnapshot(q, 
            (snapshot) => {
                // Store previous count to detect new updates
                const previousCount = allReports.length;
                const previousStatuses = new Map(allReports.map(r => [r.id, r.status]));
                
                allReports = [];
                snapshot.forEach((docSnap) => {
                    allReports.push({
                        id: docSnap.id,
                        ...docSnap.data()
                    });
                });
                
                if (allReports.length === 0) {
                    reportsList.innerHTML = '<div class="no-reports">📋 No reports submitted yet</div>';
                    updateReportCounts();
                    return;
                }
                
                // Check for updates and show notifications
                if (previousCount > 0) {
                    allReports.forEach(report => {
                        const oldStatus = previousStatuses.get(report.id);
                        if (oldStatus && oldStatus !== report.status) {
                            // Status changed!
                            showToast(`Report ${report.reportId} status changed to: ${report.status}`, 'info');
                        }
                    });
                }
                
                updateReportCounts();
                displayFilteredReports();
            },
            (error) => {
                console.error('Error in real-time listener:', error);
                
                if (error.code === 'failed-precondition' || error.message.includes('index')) {
                    reportsList.innerHTML = `
                        <div class="no-reports" style="color:#e74c3c;">
                            <strong>Database Index Required</strong><br>
                            Please create a composite index in Firebase Console:<br>
                            Collection: <code>incidentReports</code><br>
                            Fields: <code>userId</code> (Ascending), <code>createdAt</code> (Descending)<br><br>
                            <a href="${error.message.match(/https:\/\/[^\s]+/)}" target="_blank" style="color:#667eea;">Click here to create index</a>
                        </div>
                    `;
                } else {
                    reportsList.innerHTML = '<div class="no-reports">❌ Error loading reports. Please refresh the page.</div>';
                }
            }
        );
        
        // Store unsubscribe function to call when user logs out
        window.reportsUnsubscribe = unsubscribe;
        
    } catch (error) {
        console.error('Error setting up real-time listener:', error);
        reportsList.innerHTML = '<div class="no-reports">❌ Error setting up real-time updates.</div>';
    }
}

// Toast notification for real-time updates
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">${type === 'info' ? '🔔' : '✅'}</span>
            <span>${message}</span>
        </div>
    `;
    
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'info' ? '#3498db' : '#27ae60'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        max-width: 350px;
        font-size: 14px;
    `;
    
    // Add animation
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
    `;
    
    if (!document.querySelector('#toast-styles')) {
        style.id = 'toast-styles';
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds with animation
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 5000);
    
    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            toast.remove();
        }, 300);
    });
}

// Update report counts for each status
function updateReportCounts() {
    const statusCounts = {
        all: allReports.length,
        submitted: 0,
        acknowledged: 0,
        'in-progress': 0,
        resolved: 0,
        closed: 0,
        rejected: 0,
        'false-report': 0
    };
    
    allReports.forEach(report => {
        const status = report.status;
        if (statusCounts[status] !== undefined) {
            statusCounts[status]++;
        }
    });
    
    // Update badge counts
    document.getElementById('reportCount').textContent = statusCounts.all;
    document.getElementById('countAll').textContent = statusCounts.all;
    document.getElementById('countSubmitted').textContent = statusCounts.submitted;
    document.getElementById('countAcknowledged').textContent = statusCounts.acknowledged;
    document.getElementById('countInProgress').textContent = statusCounts['in-progress'];
    document.getElementById('countResolved').textContent = statusCounts.resolved;
    document.getElementById('countClosed').textContent = statusCounts.closed;
    document.getElementById('countRejected').textContent = statusCounts.rejected;
    document.getElementById('countFalse').textContent = statusCounts['false-report'];
}

// Display filtered reports
function displayFilteredReports() {
    const reportsList = document.getElementById('reportsList');
    
    let filteredReports = allReports;
    
    // 1. Filter by status (existing)
    if (currentStatusFilter !== 'all') {
        filteredReports = filteredReports.filter(r => r.status === currentStatusFilter);
    }
    
    // 2. Filter by search term (NEW)
    if (currentSearchTerm) {
        filteredReports = filteredReports.filter(r => {
            const searchLower = currentSearchTerm.toLowerCase();
            return (
                (r.reportId && r.reportId.toLowerCase().includes(searchLower)) ||
                (r.location && r.location.toLowerCase().includes(searchLower)) ||
                (r.description && r.description.toLowerCase().includes(searchLower)) ||
                (r.incidentType && r.incidentType.toLowerCase().includes(searchLower))
            );
        });
    }
    
    // 3. Filter by date range (NEW)
    if (currentDateFrom) {
        filteredReports = filteredReports.filter(r => {
            const reportDate = new Date(r.incidentDate);
            const fromDate = new Date(currentDateFrom);
            return reportDate >= fromDate;
        });
    }
    
    if (currentDateTo) {
        filteredReports = filteredReports.filter(r => {
            const reportDate = new Date(r.incidentDate);
            const toDate = new Date(currentDateTo);
            // Set to end of day
            toDate.setHours(23, 59, 59, 999);
            return reportDate <= toDate;
        });
    }
    
    // Show results info
    updateSearchResultsInfo(filteredReports.length);
    
    // Display results
    if (filteredReports.length === 0) {
        let message = '📋 No reports found';
        
        if (currentSearchTerm || currentDateFrom || currentDateTo) {
            message = '🔍 No reports match your search criteria';
        } else if (currentStatusFilter !== 'all') {
            const filterName = currentStatusFilter.replace(/-/g, ' ');
            message = `📋 No reports with status: ${filterName}`;
        }
        
        reportsList.innerHTML = `<div class="no-reports">${message}</div>`;
        return;
    }
    
    reportsList.innerHTML = '';
    filteredReports.forEach(report => {
        const reportCard = createReportCard(report, report.id);
        reportsList.appendChild(reportCard);
    });
}

// Apply search and date filters
window.applySearchFilters = function() {
    const searchInput = document.getElementById('searchReports');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    
    currentSearchTerm = searchInput.value.trim();
    currentDateFrom = dateFrom.value;
    currentDateTo = dateTo.value;
    
    // Validate date range
    if (currentDateFrom && currentDateTo) {
        const fromDate = new Date(currentDateFrom);
        const toDate = new Date(currentDateTo);
        
        if (fromDate > toDate) {
            showError('Invalid date range: "From Date" must be before "To Date"');
            return;
        }
    }
    
    // Apply filters
    displayFilteredReports();
    
    // Show success message if filters applied
    if (currentSearchTerm || currentDateFrom || currentDateTo) {
        showToast('Filters applied successfully', 'info');
    }
};

// Clear all search filters
window.clearSearchFilters = function() {
    // Clear inputs
    document.getElementById('searchReports').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    
    // Clear state
    currentSearchTerm = '';
    currentDateFrom = '';
    currentDateTo = '';
    
    // Reset status filter to 'all'
    currentStatusFilter = 'all';
    
    // Update UI
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
        if (chip.dataset.status === 'all') {
            chip.classList.add('active');
        }
    });
    
    // Refresh display
    displayFilteredReports();
    
    showToast('Filters cleared', 'info');
};

// Update search results info display
function updateSearchResultsInfo(count) {
    const resultsInfo = document.getElementById('searchResultsInfo');
    const resultsText = document.getElementById('searchResultsText');
    
    const hasFilters = currentSearchTerm || currentDateFrom || currentDateTo || currentStatusFilter !== 'all';
    
    if (hasFilters) {
        resultsInfo.style.display = 'block';
        
        let filterSummary = [];
        
        if (currentSearchTerm) {
            filterSummary.push(`Search: "${currentSearchTerm}"`);
        }
        
        if (currentDateFrom && currentDateTo) {
            filterSummary.push(`Date: ${currentDateFrom} to ${currentDateTo}`);
        } else if (currentDateFrom) {
            filterSummary.push(`Date: From ${currentDateFrom}`);
        } else if (currentDateTo) {
            filterSummary.push(`Date: Until ${currentDateTo}`);
        }
        
        if (currentStatusFilter !== 'all') {
            filterSummary.push(`Status: ${currentStatusFilter.replace(/-/g, ' ')}`);
        }
        
        resultsText.innerHTML = `
            <strong>Showing ${count} report${count !== 1 ? 's' : ''}</strong> 
            ${filterSummary.length > 0 ? '- Filters: ' + filterSummary.join(' | ') : ''}
        `;
    } else {
        resultsInfo.style.display = 'none';
    }
}

// Allow Enter key to trigger search
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchReports');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                applySearchFilters();
            }
        });
    }
    
    // Auto-apply when dates change
    if (dateFrom) {
        dateFrom.addEventListener('change', () => {
            if (currentDateFrom || currentDateTo) {
                applySearchFilters();
            }
        });
    }
    
    if (dateTo) {
        dateTo.addEventListener('change', () => {
            if (currentDateFrom || currentDateTo) {
                applySearchFilters();
            }
        });
    }
});

// ✅ MODIFIED: Create Report Card with Clickable Latest Update
function createReportCard(report, reportId) {
    const card = document.createElement('div');
    card.className = 'report-card';
    
    const statusClass = `status-${report.status.toLowerCase().replace(/[\s-]/g, '-')}`;
    const createdDate = formatFirestoreDate(report.createdAt);
    
    let imagesHtml = '';
    if (report.images && report.images.length > 0) {
        const allImages = JSON.stringify(report.images).replace(/"/g, '&quot;');
        imagesHtml = '<div class="report-images">';
        report.images.forEach((url, index) => {
            imagesHtml += `<img src="${url}" alt="Evidence ${index + 1}" onclick="openLightbox('${url}', ${allImages})" title="Click to view full size">`;
        });
        imagesHtml += '</div>';
    }
    
    // ✅ MODIFIED: Make latest update clickable
    let notesHtml = '';
    if (report.investigationNotes && report.investigationNotes.length > 0) {
        const latestNote = report.investigationNotes[report.investigationNotes.length - 1];
        const noteDate = formatFirestoreDate(latestNote.timestamp);
        notesHtml = `
            <div 
                class="report-detail latest-update-clickable" 
                style="background:#f0f7ff; padding:10px; border-radius:5px; margin-top:10px; cursor:pointer; transition: all 0.3s;"
                onclick="viewReportDetails('${reportId}', ${JSON.stringify(report).replace(/"/g, '&quot;')})"
                onmouseover="this.style.background='#e3f2fd'; this.style.transform='translateX(5px)'"
                onmouseout="this.style.background='#f0f7ff'; this.style.transform='translateX(0)'"
                title="Click to view full timeline"
            >
                <strong>📝 Latest Update:</strong> ${latestNote.note}<br>
                <small style="color:#666;">By: ${latestNote.staffName || latestNote.staffEmail} - ${noteDate}</small>
                <div style="margin-top:5px; font-size:11px; color:#3498db; font-weight:600;">
                    👉 Click to view full timeline
                </div>
            </div>
        `;
    }
    
    // Check if report can be edited/cancelled
    const canEdit = report.status === 'submitted' && isWithinEditWindow(report.createdAt);
    const canCancel = report.status === 'submitted' && isWithinCancelWindow(report.createdAt);

    let buttonsHtml = '';

    if (canEdit || canCancel) {
        buttonsHtml = `
            <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                <button 
                    class="view-details-btn" 
                    onclick="viewReportDetails('${reportId}', ${JSON.stringify(report).replace(/"/g, '&quot;')})"
                    style="flex: 1; min-width: 200px;"
                >
                    📄 View Full Details
                </button>
                ${canEdit ? `
                <button 
                    onclick="editReport('${reportId}', ${JSON.stringify(report).replace(/"/g, '&quot;')})"
                    style="flex: 1; min-width: 130px; padding: 10px 15px; background: #f39c12; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s;"
                    onmouseover="this.style.background='#e67e22'; this.style.transform='translateY(-2px)'"
                    onmouseout="this.style.background='#f39c12'; this.style.transform='translateY(0)'"
                >
                    ✏️ Edit
                </button>
                ` : ''}
                ${canCancel ? `
                <button 
                    onclick="cancelReport('${reportId}', '${report.reportId || reportId}')"
                    style="flex: 1; min-width: 130px; padding: 10px 15px; background: #e74c3c; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s;"
                    onmouseover="this.style.background='#c0392b'; this.style.transform='translateY(-2px)'"
                    onmouseout="this.style.background='#e74c3c'; this.style.transform='translateY(0)'"
                >
                    🗑️ Cancel
                </button>
                ` : ''}
            </div>
        `;
    } else {
        buttonsHtml = `
            <div style="margin-top: 15px;">
                <button class="view-details-btn" onclick="viewReportDetails('${reportId}', ${JSON.stringify(report).replace(/"/g, '&quot;')})">
                    📄 View Full Details & History
                </button>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="report-header">
            <div>
                <div class="report-type">${formatIncidentType(report.incidentType)}</div>
                <div style="color:#999; font-size:12px; margin-top:5px;">
                    <strong>ID:</strong> ${report.reportId || reportId}
                </div>
            </div>
            <div class="report-status ${statusClass}">${report.status.toUpperCase().replace(/-/g, ' ')}</div>
        </div>
        <div class="report-detail">
            <strong>📅 Submitted:</strong> ${createdDate}
        </div>
        <div class="report-detail">
            <strong>📆 Incident Date:</strong> ${report.incidentDate}
        </div>
        <div class="report-detail">
            <strong>📍 Location:</strong> ${report.location}
        </div>
        <div class="report-detail">
            <strong>📝 Description:</strong> ${report.description}
        </div>
        ${notesHtml}
        ${imagesHtml}
        ${buttonsHtml}
    `;
    
    return card;
}

// Check if report is within 1-hour edit window
function isWithinEditWindow(createdAt) {
    if (!createdAt) return false;
    
    try {
        const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000);
        const now = new Date();
        const diffMs = now - created;
        const diffHours = diffMs / (1000 * 60 * 60);
        
        return diffHours <= 1; // 1 hour edit window
    } catch (error) {
        console.error('Error checking edit window:', error);
        return false;
    }
}

// Check if report is within 10-minute cancel window
function isWithinCancelWindow(createdAt) {
    if (!createdAt) return false;
    
    try {
        const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000);
        const now = new Date();
        const diffMs = now - created;
        const diffMinutes = diffMs / (1000 * 60);
        
        return diffMinutes <= 10; // 10 minutes cancel window
    } catch (error) {
        console.error('Error checking cancel window:', error);
        return false;
    }
}

// Cancel/Delete report
window.cancelReport = async function(reportId, displayId) {
    const report = allReports.find(r => r.id === reportId);
    
    if (!report) {
        await customAlert('Report not found in your reports list.', 'error');
        return;
    }
    
    if (report.status !== 'submitted') {
        await customAlert(
            '<strong>Cannot Cancel Report</strong><br><br>This report has already been reviewed by staff.<br><br>Only reports with "Submitted" status can be cancelled.',
            'warning'
        );
        return;
    }
    
    if (!isWithinCancelWindow(report.createdAt)) {
        await customAlert(
            '<strong>Cancellation Window Expired</strong><br><br>Reports can only be cancelled within <strong>10 minutes</strong> of submission.<br><br>If you need to make changes, use the <strong>Edit</strong> button (available for 1 hour).',
            'warning'
        );
        return;
    }
    
    const created = report.createdAt.toDate ? report.createdAt.toDate() : new Date(report.createdAt.seconds * 1000);
    const now = new Date();
    const diffMs = now - created;
    const minutesElapsed = Math.floor(diffMs / (1000 * 60));
    const minutesRemaining = 10 - minutesElapsed;
    
    const confirmed = await customConfirm(
        `<strong>Delete Report: ${displayId}</strong><br><br>
        <div style="background:#fff3cd; padding:15px; border-radius:8px; border-left:4px solid #f39c12; margin:15px 0;">
            <strong>⚠️ WARNING: This action CANNOT be undone!</strong><br><br>
            The report will be <strong>permanently deleted</strong> from the system.
        </div>
        <div style="text-align:left; margin-top:15px;">
            <strong>⏱️ Time remaining:</strong> ${minutesRemaining} minute(s)<br>
            <strong>📋 Report Type:</strong> ${formatIncidentType(report.incidentType)}<br>
            <strong>📍 Location:</strong> ${report.location}
        </div>`,
        {
            title: 'Confirm Deletion',
            confirmText: '🗑️ Delete Report',
            cancelText: 'Keep Report',
            type: 'danger',
            icon: '🗑️'
        }
    );
    
    if (!confirmed) return;
    
    const confirmText = await customPrompt(
        'To confirm deletion, please type the word below exactly as shown:',
        {
            title: 'Final Confirmation',
            placeholder: 'Type DELETE here',
            confirmText: '✓ Confirm Deletion',
            cancelText: 'Cancel',
            type: 'danger',
            icon: '⚠️',
            validateText: 'DELETE'
        }
    );
    
    if (!confirmText) {
        showToast('Cancellation aborted - Report was NOT deleted', 'info');
        return;
    }
    
    showToast('Deleting report...', 'info');
    
    try {
        await deleteDoc(doc(db, 'incidentReports', reportId));
        
        await logActivity('incident_report_cancelled', {
            reportId: displayId,
            incidentType: report.incidentType,
            minutesAfterSubmission: minutesElapsed
        });
        
        await logDocumentHistory(reportId, 'report_cancelled', {
            reason: 'Cancelled by submitter within 10-minute window',
            minutesAfterSubmission: minutesElapsed
        });
        
        await customAlert(
            `<strong>Report Deleted Successfully</strong><br><br>Report <code style="background:#f8f9fa; padding:2px 8px; border-radius:4px;">${displayId}</code> has been cancelled and permanently removed from the system.`,
            'success'
        );
        
        const index = allReports.findIndex(r => r.id === reportId);
        if (index > -1) {
            allReports.splice(index, 1);
        }
        
        updateReportCounts();
        displayFilteredReports();
        
    } catch (error) {
        let userMessage = '<strong>Failed to Cancel Report</strong><br><br>';
        
        if (error.code === 'permission-denied') {
            userMessage += 'You no longer have permission to delete this report.<br><br>The 10-minute cancellation window may have expired.';
        } else if (error.code === 'not-found') {
            userMessage += 'Report not found. It may have already been deleted.';
        } else {
            userMessage += 'An error occurred. Please try again or contact support if the problem persists.';
        }
        
        await customAlert(userMessage, 'error');
        
        console.error('Cancellation error details:', {
            code: error.code,
            message: error.message,
            reportId: reportId
        });
    }
};

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

// Helper function to format Firestore Timestamp
function formatFirestoreDate(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        // If it has toDate method (Firestore Timestamp)
        if (timestamp.toDate && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().toLocaleString();
        }
        // If it has seconds property (Firestore Timestamp object)
        else if (timestamp.seconds) {
            return new Date(timestamp.seconds * 1000).toLocaleString();
        }
        // If it's already a Date object
        else if (timestamp instanceof Date) {
            return timestamp.toLocaleString();
        }
        // If it's a timestamp number
        else if (typeof timestamp === 'number') {
            return new Date(timestamp).toLocaleString();
        }
    } catch (error) {
        console.error('Error formatting date:', error);
    }
    
    return 'N/A';
}

// Edit existing report
window.editReport = async function(reportId, reportData) {
    const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
    
    // Double-check edit eligibility
    if (report.status !== 'submitted') {
        await customAlert(
            '<strong>Cannot Edit Report</strong><br><br>This report has already been reviewed by staff.<br><br>Only reports with "Submitted" status can be edited.',
            'warning'
        );
        return;
    }
    
    if (!isWithinEditWindow(report.createdAt)) {
        await customAlert(
            '<strong>Edit Window Expired</strong><br><br>Reports can only be edited within 1 hour of submission.<br><br>This report was submitted more than 1 hour ago.',
            'warning'
        );
        return;
    }
    
    // Custom confirm dialog
    const confirmed = await customConfirm(
        '<strong>Edit this report?</strong><br><br>You can update:<br><ul style="text-align:left;"><li>Incident type</li><li>Description</li><li>Location and date</li><li>Images (add/remove)</li></ul><br><small style="color:#666;">Note: All changes will be logged in the report history.</small>',
        {
            title: 'Edit Report',
            confirmText: '✏️ Start Editing',
            cancelText: 'Cancel',
            type: 'warning',
            icon: '✏️'
        }
    );
    
    if (!confirmed) return;
    
    // Pre-fill form with existing data
    document.getElementById('incidentType').value = report.incidentType;
    document.getElementById('description').value = report.description;
    document.getElementById('location').value = report.location;
    document.getElementById('incidentDate').value = report.incidentDate;
    
    if (report.locationCoordinates) {
        userLocation = report.locationCoordinates;
    }
    
    existingImages = report.images || [];
    selectedImages = [];
    
    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = '';
    
    existingImages.forEach((url, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.style.cssText = 'position: relative; border: 2px solid #3498db;';
        div.innerHTML = `
            <img src="${url}" alt="Existing ${index + 1}">
            <button type="button" class="remove-image" data-existing-index="${index}">×</button>
            <div style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(135deg, #3498db, #2980b9); color:white; font-size:10px; padding:4px; text-align:center; font-weight:600;">📁 Current</div>
        `;
        imagePreview.appendChild(div);
        
        div.querySelector('.remove-image').addEventListener('click', function() {
            removeExistingImage(parseInt(this.dataset.existingIndex));
        });
    });
    
    document.querySelector('.tab-btn[data-tab="submit"]').click();
    
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.textContent = '💾 Update Report';
    submitBtn.style.background = '#f39c12';
    submitBtn.dataset.editingReportId = reportId;
    
    showEditingNotice(report.reportId || reportId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ✅ NEW: Remove existing image during edit
window.removeExistingImage = function(index) {
    existingImages.splice(index, 1);
    refreshEditImagePreview();
};

// ✅ NEW: Refresh image preview during edit
function refreshEditImagePreview() {
    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = '';
    
    // Show existing images
    existingImages.forEach((url, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `
            <img src="${url}" alt="Existing ${index + 1}">
            <button type="button" class="remove-image" data-existing-index="${index}">×</button>
            <div style="position:absolute; bottom:2px; left:2px; background:rgba(0,0,0,0.6); color:white; font-size:10px; padding:2px 5px; border-radius:3px;">Existing</div>
        `;
        imagePreview.appendChild(div);
        
        div.querySelector('.remove-image').addEventListener('click', function() {
            removeExistingImage(parseInt(this.dataset.existingIndex));
        });
    });
    
    // Show new images
    selectedImages.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${e.target.result}" alt="New ${index + 1}">
                <button type="button" class="remove-image" data-new-index="${index}">×</button>
                <div style="position:absolute; bottom:2px; left:2px; background:rgba(46, 204, 113, 0.8); color:white; font-size:10px; padding:2px 5px; border-radius:3px;">New</div>
            `;
            imagePreview.appendChild(div);
            
            div.querySelector('.remove-image').addEventListener('click', function() {
                removeNewImage(parseInt(this.dataset.newIndex));
            });
        };
        reader.readAsDataURL(file);
    });
}

// ✅ NEW: Remove new image during edit
window.removeNewImage = function(index) {
    selectedImages.splice(index, 1);
    refreshEditImagePreview();
};

// Show editing notice banner
function showEditingNotice(displayId) {
    const existingNotice = document.getElementById('editingNotice');
    if (existingNotice) {
        existingNotice.remove();
    }
    
    const notice = document.createElement('div');
    notice.id = 'editingNotice';
    notice.style.cssText = `
        background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
        color: white;
        padding: 0;
        border-radius: 12px;
        margin-bottom: 25px;
        box-shadow: 0 8px 24px rgba(243, 156, 18, 0.4);
        overflow: hidden;
        animation: slideDown 0.4s ease;
        border: 3px solid rgba(255, 255, 255, 0.3);
    `;
    
    notice.innerHTML = `
        <div style="background: rgba(0, 0, 0, 0.15); padding: 8px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid rgba(255, 255, 255, 0.2);">
            <span style="font-size: 20px;">✏️</span>
            <span style="font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Edit Mode Active</span>
        </div>
        
        <div style="padding: 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 250px;">
                <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                    <span style="background: rgba(255, 255, 255, 0.25); padding: 4px 12px; border-radius: 6px; font-family: 'Courier New', monospace;">
                        ${displayId}
                    </span>
                </div>
                <div style="font-size: 14px; opacity: 0.95; line-height: 1.5;">
                    📝 Make your changes below, then click <strong>"Update Report"</strong> to save
                </div>
                <div style="margin-top: 12px; padding: 10px 15px; background: rgba(255, 255, 255, 0.15); border-radius: 8px; font-size: 13px; border-left: 4px solid rgba(255, 255, 255, 0.5);">
                    <strong>💡 Tip:</strong> You can update text, dates, location, and manage images (add/remove)
                </div>
            </div>
            
            <button 
                onclick="cancelEdit()" 
                style="
                    background: rgba(231, 76, 60, 0.9);
                    backdrop-filter: blur(10px);
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    padding: 12px 24px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 700;
                    font-size: 14px;
                    transition: all 0.3s;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    white-space: nowrap;
                "
                onmouseover="
                    this.style.background='rgba(192, 57, 43, 1)';
                    this.style.transform='translateY(-3px) scale(1.05)';
                    this.style.boxShadow='0 6px 20px rgba(0, 0, 0, 0.3)';
                "
                onmouseout="
                    this.style.background='rgba(231, 76, 60, 0.9)';
                    this.style.transform='translateY(0) scale(1)';
                    this.style.boxShadow='0 4px 12px rgba(0, 0, 0, 0.2)';
                "
            >
                <span style="font-size: 16px;">✖</span>
                <span>Cancel Edit</span>
            </button>
        </div>
    `;
    
    const form = document.getElementById('incidentForm');
    form.parentNode.insertBefore(notice, form);
    
    if (!document.querySelector('#editing-notice-styles')) {
        const style = document.createElement('style');
        style.id = 'editing-notice-styles';
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-30px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes pulse {
                0%, 100% {
                    box-shadow: 0 8px 24px rgba(243, 156, 18, 0.4);
                }
                50% {
                    box-shadow: 0 8px 32px rgba(243, 156, 18, 0.6);
                }
            }
            
            #editingNotice {
                animation: slideDown 0.4s ease, pulse 2s ease-in-out infinite;
            }
            
            @media (max-width: 768px) {
                #editingNotice > div:last-child {
                    flex-direction: column;
                    align-items: stretch !important;
                }
                #editingNotice button {
                    width: 100%;
                    justify-content: center;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// ✅ MODIFIED: Cancel Edit Function
window.cancelEdit = async function() {
    const confirmed = await customConfirm(
        '<strong>Cancel editing?</strong><br><br>Any unsaved changes will be lost.<br><br>Are you sure you want to discard your changes?',
        {
            title: 'Discard Changes',
            confirmText: 'Yes, Discard',
            cancelText: 'Keep Editing',
            type: 'warning',
            icon: '⚠️'
        }
    );
    
    if (!confirmed) return;
    
    document.getElementById('incidentForm').reset();
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('incidentDate').value = today;
    
    selectedImages = [];
    existingImages = [];
    document.getElementById('imagePreview').innerHTML = '';
    
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.textContent = 'Submit Report';
    submitBtn.style.background = '';
    delete submitBtn.dataset.editingReportId;
    
    const notice = document.getElementById('editingNotice');
    if (notice) {
        notice.remove();
    }
    
    document.querySelector('.tab-btn[data-tab="reports"]').click();
    showToast('Edit cancelled', 'info');
};

// ✅ MODIFIED: Update Existing Report Function
async function updateExistingReport(reportId) {
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
    
    try {
        // Validate incident date
        const incidentDate = document.getElementById('incidentDate').value;
        const selectedDate = new Date(incidentDate);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        
        if (selectedDate > today) {
            showError('Incident date cannot be in the future');
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Update Report';
            return;
        }
        
        // Get form data
        const incidentType = document.getElementById('incidentType').value;
        const description = document.getElementById('description').value;
        const location = document.getElementById('location').value;
        
        // Get original report to check what changed
        const originalReport = allReports.find(r => r.id === reportId);
        const changes = [];
        
        if (originalReport.incidentType !== incidentType) changes.push('incident type');
        if (originalReport.description !== description) changes.push('description');
        if (originalReport.location !== location) changes.push('location');
        if (originalReport.incidentDate !== incidentDate) changes.push('incident date');
        
        // ✅ NEW: Upload new images if any
        const uploadErrors = [];
        
        if (selectedImages.length > 0) {
            submitBtn.textContent = `Uploading ${selectedImages.length} new image(s)...`;
            
            for (let i = 0; i < selectedImages.length; i++) {
                try {
                    const file = selectedImages[i];
                    const timestamp = Date.now();
                    const fileExt = file.name.split('.').pop();
                    const imageNumber = existingImages.length + i + 1;
                    const storagePath = `incident-reports/${reportId}/image_${imageNumber}_${timestamp}.${fileExt}`;
                    const storageRef = ref(storage, storagePath);
                    
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    existingImages.push(url); // Add to existing images array
                } catch (uploadError) {
                    console.error(`Error uploading image ${i + 1}:`, uploadError);
                    uploadErrors.push(`Image ${i + 1}: ${uploadError.message}`);
                }
            }
            
            if (uploadErrors.length > 0) {
                console.warn('Some images failed to upload:', uploadErrors);
            }
            
            changes.push(`${selectedImages.length - uploadErrors.length} image(s) added`);
        }
        
        // Check if images were removed
        const originalImageCount = originalReport.images?.length || 0;
        const currentImageCount = existingImages.length;
        
        if (originalImageCount !== currentImageCount) {
            const removedCount = originalImageCount - currentImageCount;
            if (removedCount > 0 && !changes.includes('images')) {
                changes.push(`${removedCount} image(s) removed`);
            }
        }
        
        if (changes.length === 0) {
            alert('ℹ️ No changes detected.\n\nPlease modify at least one field to update the report.');
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Update Report';
            return;
        }
        
        submitBtn.textContent = 'Saving changes...';
        
        // ✅ Update report with new image URLs
        await updateDoc(doc(db, 'incidentReports', reportId), {
            incidentType: incidentType,
            description: description,
            location: location,
            incidentDate: incidentDate,
            locationCoordinates: userLocation || null,
            images: existingImages, // ✅ Update images array
            updatedAt: serverTimestamp(),
            editedAt: serverTimestamp(),
            editCount: (originalReport.editCount || 0) + 1,
            investigationNotes: arrayUnion({
                note: `Report edited by submitter. Changes: ${changes.join(', ')}`,
                staffEmail: currentUser.email,
                staffName: currentUserData?.fullName || currentUser.email,
                timestamp: Timestamp.now()
            })
        });
        
        // Log activity
        await logActivity('incident_report_edited', {
            reportId: originalReport.reportId || reportId,
            changedFields: changes
        });
        
        // Log to document history
        await logDocumentHistory(reportId, 'report_edited', {
            changedFields: changes,
            editNumber: (originalReport.editCount || 0) + 1
        });
        
        let successMsg = `✅ Report updated successfully!\n\nChanges made: ${changes.join(', ')}`;
        if (uploadErrors.length > 0) {
            successMsg += `\n\nNote: ${uploadErrors.length} image(s) failed to upload.`;
        }
        
        showSuccess(successMsg);
        
        // Reset form
        document.getElementById('incidentForm').reset();
        const todayDate = new Date().toISOString().split('T')[0];
        document.getElementById('incidentDate').value = todayDate;
        
        // Clear images
        selectedImages = [];
        existingImages = [];
        document.getElementById('imagePreview').innerHTML = '';
        
        // Reset submit button
        submitBtn.textContent = 'Submit Report';
        submitBtn.style.background = '';
        delete submitBtn.dataset.editingReportId;
        
        // Remove editing notice
        const notice = document.getElementById('editingNotice');
        if (notice) {
            notice.remove();
        }
        
        // Switch to reports tab after delay
        setTimeout(() => {
            document.querySelector('.tab-btn[data-tab="reports"]').click();
            hideMessages();
        }, 3000);
        
    } catch (error) {
        let userMessage = 'Failed to update report. ';
        
        if (error.code === 'permission-denied') {
            userMessage += 'You no longer have permission to edit this report. The 1-hour edit window may have expired or the report status has changed.';
        } else if (error.code === 'not-found') {
            userMessage += 'Report not found. It may have been deleted.';
        } else {
            userMessage += 'Please try again or contact support if the problem persists.';
        }
        
        showError(userMessage);
        
        console.error('Update error details:', {
            code: error.code,
            message: error.message,
            reportId: reportId
        });
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Update Report';
    }
}


function showSuccess(message) {
    const successMsg = document.getElementById('successMessage');
    successMsg.textContent = message;
    successMsg.classList.add('show');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        successMsg.classList.remove('show');
    }, 5000);
}

function showError(message) {
    const errorMsg = document.getElementById('errorMessage');
    errorMsg.textContent = message;
    errorMsg.classList.add('show');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorMsg.classList.remove('show');
    }, 5000);
}

function hideMessages() {
    document.getElementById('successMessage').classList.remove('show');
    document.getElementById('errorMessage').classList.remove('show');
}

// ==================== IMAGE LIGHTBOX FUNCTIONALITY ====================

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

// Keyboard navigation for lightbox
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

// Touch/Swipe support for mobile
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

// ==================== REPORT DETAILS MODAL ====================

window.viewReportDetails = function(reportId, reportData) {
    const modal = document.getElementById('reportModal');
    const modalBody = document.getElementById('modalBody');
    
    // Parse report data if it's a string
    const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
    
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
            imagesHtml += `<img src="${url}" alt="Evidence ${index + 1}" onclick="openLightbox('${url}', ${allImages})" style="cursor:pointer;">`;
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
        
        // Sort notes by timestamp (oldest first for timeline view)
        const sortedNotes = [...report.investigationNotes].sort((a, b) => {
            // Handle Firestore Timestamp objects
            const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp?.seconds ? new Date(a.timestamp.seconds * 1000) : new Date(0));
            const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp?.seconds ? new Date(b.timestamp.seconds * 1000) : new Date(0));
            return timeA - timeB;
        });
        
        sortedNotes.forEach((note, index) => {
            // Convert Firestore Timestamp to JavaScript Date
            let noteDate = 'Date unknown';
            if (note.timestamp) {
                if (note.timestamp.toDate) {
                    noteDate = note.timestamp.toDate().toLocaleString();
                } else if (note.timestamp.seconds) {
                    noteDate = new Date(note.timestamp.seconds * 1000).toLocaleString();
                }
            }
            const staffName = note.staffName || note.staffEmail || 'Staff';
            
            // Check if note has images
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
    } else {
        timelineHtml = `
            <div class="modal-section">
                <h3>📋 Investigation Timeline</h3>
                <p style="color:#999; font-style:italic;">No investigation updates yet. Staff will add notes as they review your report.</p>
            </div>
        `;
    }
    
    // Status badge color
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
                    <span>${report.userName || 'You'}</span>
                </div>
                <div class="info-item">
                    <strong>Submitted on:</strong>
                    <span>${formatFirestoreDate(report.createdAt)}</span>
                </div>
                <div class="info-item">
                    <strong>Incident Date:</strong>
                    <span>${report.incidentDate}</span>
                </div>
                <div class="info-item" style="grid-column: 1 / -1;">
                    <strong>Location:</strong>
                    <span>${report.location}</span>
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
};

window.closeReportModal = function() {
    document.getElementById('reportModal').classList.remove('show');
    document.body.style.overflow = '';
};

// Close modal when clicking outside
window.onclick = function(event) {
    const reportModal = document.getElementById('reportModal');
    const lightbox = document.getElementById('imageLightbox');
    
    if (event.target === reportModal) {
        closeReportModal();
    }
    if (event.target === lightbox) {
        closeLightbox();
    }
};


// Load user profile data
async function loadUserProfile() {
    if (!currentUser) return;

    try {
        // Try users collection first
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            currentUserData = userDoc.data();
            updateSidebarProfile();
            return;
        }

        // Fallback to residents collection
        try {
            const residentDoc = await getDoc(doc(db, 'residents', currentUser.email));
            if (residentDoc.exists()) {
                currentUserData = residentDoc.data();
                updateSidebarProfile();
                return;
            }
        } catch (residentError) {
            console.log('No resident document found');
        }

        // Use default data from auth
        currentUserData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUser.displayName || 'Resident User',
            firstName: currentUser.displayName?.split(' ')[0] || 'Resident',
            lastName: currentUser.displayName?.split(' ')[1] || 'User',
            role: 'resident'
        };
        
        updateSidebarProfile();

    } catch (error) {
        console.error('Error loading user profile:', error);
        
        // Use fallback data
        currentUserData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: 'Resident User',
            firstName: 'Resident',
            lastName: 'User'
        };
        
        updateSidebarProfile();
    }
}

// Update sidebar with user profile
function updateSidebarProfile() {
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userInitials = document.getElementById('userInitials');

    if (userName && currentUserData) {
        const fullName = currentUserData.fullName || 
                        `${currentUserData.firstName || ''} ${currentUserData.lastName || ''}`.trim() ||
                        'Resident User';
        
        userName.textContent = fullName;
    }

    if (userEmail && currentUser) {
        userEmail.textContent = currentUser.email;
    }

    if (userInitials) {
        userInitials.textContent = getUserInitials();
    }
}

// Highlight active navigation item based on current page
function highlightActiveNav() {
    const currentPage = window.location.pathname.split('/').pop();
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.classList.remove('active');
        const href = item.getAttribute('href');
        
        if (href && href.includes(currentPage)) {
            item.classList.add('active');
        }
    });
}

// Mobile menu toggle
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const sidebar = document.getElementById('sidebar');

if (mobileMenuToggle && sidebar) {
    mobileMenuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        mobileMenuToggle.classList.toggle('active');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024) {
            if (!sidebar.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                sidebar.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        }
    });

    // Close sidebar when clicking on a nav item on mobile
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 1024) {
                sidebar.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        });
    });
}

// Handle window resize
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (window.innerWidth > 1024) {
            sidebar?.classList.remove('active');
            mobileMenuToggle?.classList.remove('active');
        }
    }, 250);
});

// Logout handler
window.handleLogout = async function() {
    const confirmed = confirm('Are you sure you want to logout?');
    
    if (confirmed) {
        try {
            await signOut(auth);
            window.location.href = '../index.html';
        } catch (error) {
            console.error('Error signing out:', error);
            alert('Failed to logout. Please try again.');
        }
    }
};
