import { db, auth, secondaryAuth } from "../firebase-config.js";
import { 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { 
    onAuthStateChanged, 
    signOut,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// Global variables
let allStaff = [];
let charts = {};

// Check authentication and authorization
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../index.html";
        return;
    }

    try {
        const adminRef = doc(db, "config", "admin");
        const adminSnap = await getDoc(adminRef);

        if (!adminSnap.exists()) {
            alert("Unauthorized access.");
            await signOut(auth);
            window.location.href = "../index.html";
            return;
        }

        const adminData = adminSnap.data();

        // Check if user is captain or admin ONLY (not staff)
        if (adminData.email !== user.email) {
            alert("Unauthorized access. Captain/Admin only.");
            await signOut(auth);
            window.location.href = "../index.html";
            return;
        }

        // Additional check: make sure role is captain or admin
        if (adminData.role !== "captain" && adminData.role !== "admin") {
            alert("Unauthorized access. Captain/Admin only.");
            await signOut(auth);
            window.location.href = "../index.html";
            return;
        }

        // Display admin name
        document.getElementById("admin-name").textContent = `Logged in as: ${user.email}`;

        // Load all data
        await loadDashboardData();

    } catch (error) {
        console.error("Error checking authorization:", error);
        alert("Error verifying access.");
        await signOut(auth);
        window.location.href = "../index.html";
    }
});

// Logout handler
document.getElementById("logout-btn").addEventListener("click", async () => {
    if (confirm("Are you sure you want to logout?")) {
        await signOut(auth);
        window.location.href = "../index.html";
    }
});

// Load all dashboard data
async function loadDashboardData() {
    try {
        await Promise.all([
            loadStats(),
            loadStaffList(),
            loadAnalytics()
        ]);
    } catch (error) {
        console.error("Error loading dashboard data:", error);
        alert("Error loading dashboard data.");
    }
}

// Load statistics
async function loadStats() {
    try {
        // Count residents
        const residentsSnapshot = await getDocs(collection(db, "residents"));
        const totalResidents = residentsSnapshot.size;
        document.getElementById("total-residents").textContent = totalResidents;

        // Count document requests
        const requestsSnapshot = await getDocs(collection(db, "documentRequests"));
        let pendingCount = 0;
        let approvedCount = 0;
        
        requestsSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.status === "pending") pendingCount++;
            if (data.status === "approved") approvedCount++;
        });

        document.getElementById("total-documents").textContent = requestsSnapshot.size;
        document.getElementById("pending-docs").textContent = `${pendingCount} Pending`;
        document.getElementById("approved-docs").textContent = `${approvedCount} Approved`;

        // Count incidents
        const incidentsSnapshot = await getDocs(collection(db, "incidentReports"));
        document.getElementById("total-incidents").textContent = incidentsSnapshot.size;

        // Count staff
        try {
            const staffSnapshot = await getDocs(collection(db, "staff"));
            document.getElementById("total-staff").textContent = staffSnapshot.size;
        } catch (error) {
            console.error("Error counting staff:", error);
            document.getElementById("total-staff").textContent = "0";
        }
    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// Load staff list
async function loadStaffList() {
    try {
        const staffSnapshot = await getDocs(collection(db, "staff"));
        allStaff = [];

        staffSnapshot.forEach((docSnap) => {
            allStaff.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        renderStaffList(allStaff);

    } catch (error) {
        console.error("Error loading staff:", error);
        document.getElementById("staff-list").innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h4>Failed to load staff</h4>
            </div>
        `;
    }
}

// Real-time validation: Block numbers in name fields
document.getElementById("staff-first-name").addEventListener("input", function(e) {
    // Remove any numbers from the input
    this.value = this.value.replace(/[0-9]/g, '');
    updateEmailPreview();
});

document.getElementById("staff-last-name").addEventListener("input", function(e) {
    // Remove any numbers from the input
    this.value = this.value.replace(/[0-9]/g, '');
    updateEmailPreview();
});

// Render staff list
function renderStaffList(staffList) {
    const staffListContainer = document.getElementById("staff-list");

    if (staffList.length === 0) {
        staffListContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <h4>No staff accounts</h4>
                <p>Create your first staff account to get started</p>
            </div>
        `;
        return;
    }

    staffListContainer.innerHTML = "";

    staffList.forEach((staff) => {
        const staffItem = document.createElement("div");
        staffItem.className = "staff-item";

        // Build additional info display
        let additionalInfo = '';
        if (staff.age || staff.gender || staff.contactNumber || staff.birthdate) {
            const infoParts = [];
            if (staff.age) infoParts.push(`Age: ${staff.age}`);
            if (staff.birthdate) infoParts.push(`🎂 ${new Date(staff.birthdate).toLocaleDateString()}`);
            if (staff.gender) infoParts.push(staff.gender);
            if (staff.contactNumber) infoParts.push(`📞 ${staff.contactNumber}`);
            additionalInfo = `<div class="staff-details">${infoParts.join(' • ')}</div>`;
        }

        if (staff.address) {
            additionalInfo += `<div class="staff-address">📍 ${staff.address}</div>`;
        }

        staffItem.innerHTML = `
            <div class="staff-info">
                <div class="staff-name">${staff.firstName} ${staff.lastName}</div>
                <div class="staff-email">${staff.email}</div>
                ${additionalInfo}
                <span class="staff-role role-${staff.role}">${staff.role.toUpperCase()}</span>
            </div>
            <div class="staff-actions">
                <button class="btn btn-danger" onclick="deleteStaff('${staff.email}')">
                    🗑️ Delete
                </button>
            </div>
        `;

        staffListContainer.appendChild(staffItem);
    });
}

// Search staff
document.getElementById("staff-search").addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredStaff = allStaff.filter(staff => 
        staff.firstName.toLowerCase().includes(searchTerm) ||
        staff.lastName.toLowerCase().includes(searchTerm) ||
        staff.email.toLowerCase().includes(searchTerm) ||
        staff.role.toLowerCase().includes(searchTerm)
    );
    renderStaffList(filteredStaff);
});

// Auto-generate email preview as user types
document.getElementById("staff-first-name").addEventListener("input", updateEmailPreview);
document.getElementById("staff-last-name").addEventListener("input", updateEmailPreview);

function updateEmailPreview() {
    const firstName = document.getElementById("staff-first-name").value.trim().toLowerCase();
    const lastName = document.getElementById("staff-last-name").value.trim().toLowerCase();
    
    // Remove special characters except dots, hyphens, and spaces (which will become dots)
    const cleanFirstName = firstName.replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
    const cleanLastName = lastName.replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
    
    if (cleanFirstName && cleanLastName) {
        const email = `${cleanFirstName}.${cleanLastName}@BMS.com`;
        document.getElementById("staff-email-preview").value = email;
    } else {
        document.getElementById("staff-email-preview").value = "";
    }
}

// Validate contact number - only digits
document.getElementById("staff-contact").addEventListener("input", function(e) {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10);
});

// Get current location
document.getElementById("get-location-btn").addEventListener("click", async function() {
    const btn = this;
    const statusText = document.getElementById("location-status");
    const addressField = document.getElementById("staff-address");
    
    if (!navigator.geolocation) {
        statusText.textContent = "❌ Geolocation is not supported by your browser";
        statusText.style.color = "#e53e3e";
        return;
    }
    
    btn.disabled = true;
    btn.textContent = "📍 Getting location...";
    statusText.textContent = "🔄 Fetching your location...";
    statusText.style.color = "#718096";
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            try {
                // Use OpenStreetMap's Nominatim API for reverse geocoding (free)
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`
                );
                const data = await response.json();
                
                // Build address from components
                const address = data.address;
                const addressParts = [
                    address.house_number,
                    address.road || address.street,
                    address.suburb || address.neighbourhood,
                    address.city || address.municipality,
                    address.state || address.province,
                    address.country
                ].filter(Boolean);
                
                const fullAddress = addressParts.join(", ");
                addressField.value = fullAddress || `${lat}, ${lon}`;
                
                statusText.textContent = `✅ Location found! (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
                statusText.style.color = "#38a169";
                
            } catch (error) {
                console.error("Geocoding error:", error);
                addressField.value = `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
                statusText.textContent = "⚠️ Got coordinates, but couldn't get address name";
                statusText.style.color = "#dd6b20";
            }
            
            btn.disabled = false;
            btn.textContent = "📍 Use Current Location";
        },
        (error) => {
            console.error("Geolocation error:", error);
            let errorMsg = "❌ ";
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMsg += "Location access denied. Please enable location permissions.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMsg += "Location information unavailable.";
                    break;
                case error.TIMEOUT:
                    errorMsg += "Location request timed out.";
                    break;
                default:
                    errorMsg += "An unknown error occurred.";
            }
            
            statusText.textContent = errorMsg;
            statusText.style.color = "#e53e3e";
            btn.disabled = false;
            btn.textContent = "📍 Use Current Location";
        }
    );
});

// Password visibility toggle - Single icon that changes
document.getElementById("toggle-password").addEventListener("click", function() {
    const passwordInput = document.getElementById("staff-password");
    const icon = document.getElementById("password-icon");
    
    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        icon.textContent = "🔒";
    } else {
        passwordInput.type = "password";
        icon.textContent = "👁️";
    }
});

// Function to reset the form
function resetStaffForm() {
    document.getElementById("create-staff-form").reset();
    document.getElementById("staff-email-preview").value = "";
    document.getElementById("staff-age-display").value = "";
    document.getElementById("staff-birthdate").value = "";
    document.getElementById("birth-month").value = "";
    document.getElementById("birth-day").value = "";
    document.getElementById("birth-year").value = "";
    document.getElementById("location-status").textContent = "💡 You can type manually or use your current location";
    document.getElementById("location-status").style.color = "#718096";
    
    // Reset password visibility
    document.getElementById("staff-password").type = "password";
    document.getElementById("password-icon").textContent = "👁️";
}

// Create staff modal handlers
document.getElementById("create-staff-btn").addEventListener("click", () => {
    resetStaffForm();
    document.getElementById("create-staff-modal").showModal();
});

// Close button (Cancel)
document.getElementById("close-staff-modal").addEventListener("click", () => {
    resetStaffForm();
    document.getElementById("create-staff-modal").close();
});

// Close button (X)
document.getElementById("close-staff-modal-x").addEventListener("click", () => {
    resetStaffForm();
    document.getElementById("create-staff-modal").close();
});

// Helper function to generate unique email if already exists
async function generateUniqueEmail(firstName, lastName) {
    const cleanFirstName = firstName.toLowerCase().replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
    const cleanLastName = lastName.toLowerCase().replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
    
    let baseEmail = `${cleanFirstName}.${cleanLastName}@bms.com`;
    let finalEmail = baseEmail;
    let counter = 1;
    
    // Check if email exists in Firestore
    while (await checkIfStaffExists(finalEmail)) {
        finalEmail = `${cleanFirstName}.${cleanLastName}${counter}@bms.com`;
        counter++;
    }
    
    return {
        email: finalEmail,
        isModified: finalEmail !== baseEmail,
        originalEmail: baseEmail
    };
}

// Check if staff exists in Firestore
async function checkIfStaffExists(email) {
    try {
        const staffDoc = await getDoc(doc(db, "staff", email));
        return staffDoc.exists();
    } catch (error) {
        console.error("Error checking staff existence:", error);
        return false;
    }
}

// Create staff form submission
document.getElementById("create-staff-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector(".btn-primary");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    const firstName = document.getElementById("staff-first-name").value.trim();
    const lastName = document.getElementById("staff-last-name").value.trim();
    const password = document.getElementById("staff-password").value;
    const birthdate = document.getElementById("staff-birthdate").value;
    const gender = document.getElementById("staff-gender").value;
    const contact = document.getElementById("staff-contact").value.trim();
    const address = document.getElementById("staff-address").value.trim();
    const role = document.getElementById("staff-role").value;

    // Validate name (no numbers)
    const namePattern = /^[A-Za-z\s\.\-']+$/;
    if (!namePattern.test(firstName) || !namePattern.test(lastName)) {
        alert("❌ Names can only contain letters, spaces, hyphens (-), periods (.), and apostrophes (')");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        return;
    }

    // Validate contact number (PH format - 10 digits)
    if (!/^[0-9]{10}$/.test(contact)) {
        alert("❌ Contact number must be exactly 10 digits\n\nExample: 9123456789");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        return;
    }

    // Calculate age
    const birthDate = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    // Check minimum age
    if (age < 18) {
        alert("❌ Staff member must be at least 18 years old");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        return;
    }

    // Block creation of captain/admin roles
    if (role === "captain" || role === "admin") {
        alert("❌ Cannot create Captain or Admin accounts.\n\nOnly one admin account exists in config/admin.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        return;
    }

    // Generate unique email (with number suffix if needed)
    const emailResult = await generateUniqueEmail(firstName, lastName);
    const email = emailResult.email;

    // If email was modified, ask for confirmation
    if (emailResult.isModified) {
        const confirmMsg = `⚠️ An account with the email "${emailResult.originalEmail}" already exists.\n\n` +
                          `The new email will be: "${email}"\n\n` +
                          `Do you want to proceed with this email?`;
        
        if (!confirm(confirmMsg)) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Create Account";
            return;
        }
    }

    // Full contact number with country code
    const fullContactNumber = `+63${contact}`;

    try {
        // Generate unique email (with number suffix if needed)
        const emailResult = await generateUniqueEmail(firstName, lastName);
        let email = emailResult.email;
        let authAccountCreated = false;

        // Try to create user in Firebase Auth
        try {
            const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            authAccountCreated = true;
            console.log("✅ Firebase Auth account created:", email);
        } catch (authError) {
            if (authError.code === "auth/email-already-in-use") {
                console.warn("⚠️ Email already exists in Firebase Auth:", email);
                
                // Check if this email exists in Firestore staff collection
                const existsInFirestore = await checkIfStaffExists(email);
                
                if (existsInFirestore) {
                    // Email exists in both Auth and Firestore - truly duplicate
                    alert(`❌ This staff member already has an active account.\n\nEmail: ${email}\n\nPlease use a different name.`);
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Create Account";
                    return;
                } else {
                    // Email exists in Auth but NOT in Firestore (deleted staff account)
                    // Generate a new numbered email
                    let counter = 1;
                    let newEmail = email;
                    let foundAvailable = false;
                    
                    while (!foundAvailable && counter < 100) {
                        const cleanFirstName = firstName.toLowerCase().replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
                        const cleanLastName = lastName.toLowerCase().replace(/[^a-z\s\.\-']/g, '').replace(/\s+/g, '.');
                        newEmail = `${cleanFirstName}.${cleanLastName}${counter}@bms.com`;
                        
                        const authExists = await checkIfStaffExists(newEmail);
                        if (!authExists) {
                            foundAvailable = true;
                            email = newEmail;
                            
                            const confirmMsg = `⚠️ The email "${emailResult.email}" already exists in the system.\n\n` +
                                              `A new email will be created: "${email}"\n\n` +
                                              `Do you want to proceed?`;
                            
                            if (!confirm(confirmMsg)) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = "Create Account";
                                return;
                            }
                            
                            // Try creating with the new email
                            try {
                                await createUserWithEmailAndPassword(secondaryAuth, email, password);
                                authAccountCreated = true;
                                console.log("✅ Firebase Auth account created with numbered email:", email);
                            } catch (retryError) {
                                throw retryError;
                            }
                        }
                        counter++;
                    }
                    
                    if (!foundAvailable) {
                        alert("❌ Unable to generate a unique email. Please contact support.");
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Create Account";
                        return;
                    }
                }
            } else {
                throw authError;
            }
        }

        // If we successfully created the auth account, add to Firestore
        if (authAccountCreated) {
            // Prepare staff data
            const staffData = {
                email: email,
                firstName: firstName,
                lastName: lastName,
                birthdate: birthdate,
                age: age,
                gender: gender,
                contactNumber: fullContactNumber,
                address: address,
                role: role,
                createdAt: new Date(),
                isActive: true
            };

            // Add staff to Firestore
            await setDoc(doc(db, "staff", email), staffData);

            // Sign out the newly created user from secondary auth immediately
            await signOut(secondaryAuth);

            // Show success message
            let successMsg = `✅ Staff account created successfully!\n\n👤 Name: ${firstName} ${lastName}\n📧 Email: ${email}\n🔑 Password: ${password}\n📱 Contact: ${fullContactNumber}\n🎂 Age: ${age} years old\n\n⚠️ Please save these credentials and share them with the staff member.`;
            
            if (email !== emailResult.email) {
                successMsg += `\n\n💡 Note: A number was added to the email because the original email already existed.`;
            }
            
            alert(successMsg);

            resetStaffForm();
            document.getElementById("create-staff-modal").close();
            
            // Reload staff list
            await loadStaffList();
            await loadStats();
        }

    } catch (error) {
        console.error("Error creating staff:", error);
        if (error.code === "auth/weak-password") {
            alert("❌ Password should be at least 6 characters.");
        } else {
            alert("❌ Error creating staff account: " + error.message);
        }
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Create Account";
});

// Delete staff
window.deleteStaff = async function(email) {
    if (!confirm(`Are you sure you want to delete ${email}?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        // Delete from Firestore
        await deleteDoc(doc(db, "staff", email));

        alert("Staff account deleted successfully!");
        
        // Reload staff list
        await loadStaffList();
        await loadStats();

    } catch (error) {
        console.error("Error deleting staff:", error);
        alert("Error deleting staff account: " + error.message);
    }
};

// Populate birth day dropdown (1-31)
function populateBirthDays() {
    const daySelect = document.getElementById("birth-day");
    daySelect.innerHTML = '<option value="">Day</option>';
    for (let i = 1; i <= 31; i++) {
        const day = i.toString().padStart(2, '0');
        daySelect.innerHTML += `<option value="${day}">${i}</option>`;
    }
}

// Populate birth year dropdown (18 years ago to 100 years ago)
function populateBirthYears() {
    const yearSelect = document.getElementById("birth-year");
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 100;
    const maxYear = currentYear - 18;
    
    yearSelect.innerHTML = '<option value="">Year</option>';
    for (let year = maxYear; year >= minYear; year--) {
        yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
    }
}

// Initialize dropdowns on page load
document.addEventListener('DOMContentLoaded', () => {
    populateBirthDays();
    populateBirthYears();
});

// Update hidden birthdate field and calculate age when any dropdown changes
function updateBirthdateAndAge() {
    const month = document.getElementById("birth-month").value;
    const day = document.getElementById("birth-day").value;
    const year = document.getElementById("birth-year").value;
    
    if (month && day && year) {
        // Validate day for the selected month
        const daysInMonth = new Date(year, month, 0).getDate();
        const selectedDay = parseInt(day);
        
        if (selectedDay > daysInMonth) {
            alert(`❌ Invalid date: ${getMonthName(month)} ${year} only has ${daysInMonth} days`);
            document.getElementById("birth-day").value = "";
            document.getElementById("staff-birthdate").value = "";
            document.getElementById("staff-age-display").value = "";
            return;
        }
        
        // Create date in YYYY-MM-DD format
        const birthdate = `${year}-${month}-${day}`;
        document.getElementById("staff-birthdate").value = birthdate;
        
        // Calculate age
        const birthDate = new Date(birthdate);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        document.getElementById("staff-age-display").value = age + " years old";
    } else {
        document.getElementById("staff-birthdate").value = "";
        document.getElementById("staff-age-display").value = "";
    }
}

// Helper function to get month name
function getMonthName(monthNum) {
    const months = ["", "January", "February", "March", "April", "May", "June", 
                   "July", "August", "September", "October", "November", "December"];
    return months[parseInt(monthNum)];
}

// Add event listeners to dropdowns
document.getElementById("birth-month").addEventListener("change", updateBirthdateAndAge);
document.getElementById("birth-day").addEventListener("change", updateBirthdateAndAge);
document.getElementById("birth-year").addEventListener("change", updateBirthdateAndAge);

// Load analytics and create charts
async function loadAnalytics() {
    try {
        const requestsSnapshot = await getDocs(collection(db, "documentRequests"));
        const requests = [];
        
        requestsSnapshot.forEach((doc) => {
            requests.push({
                id: doc.id,
                ...doc.data()
            });
        });

        const incidentsSnapshot = await getDocs(collection(db, "incidentReports"));
        const incidents = [];
        
        incidentsSnapshot.forEach((doc) => {
            incidents.push({
                id: doc.id,
                ...doc.data()
            });
        });

        createMostRequestedDocumentsChart(requests);
        createRequestTrendsChart(requests);
        createIncidentFrequencyChart(incidents);
        createRequestStatusChart(requests);

    } catch (error) {
        console.error("Error loading analytics:", error);
    }
}

// Most Requested Documents Chart
function createMostRequestedDocumentsChart(requests) {
    const documentCounts = {};
    
    requests.forEach(req => {
        const docType = req.documentType || "Unknown";
        documentCounts[docType] = (documentCounts[docType] || 0) + 1;
    });

    const sorted = Object.entries(documentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const ctx = document.getElementById("documentsChart");
    
    if (charts.documentsChart) {
        charts.documentsChart.destroy();
    }

    charts.documentsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: sorted.map(([label]) => label),
            datasets: [{
                label: "Requests",
                data: sorted.map(([, count]) => count),
                backgroundColor: [
                    "rgba(102, 126, 234, 0.8)",
                    "rgba(118, 75, 162, 0.8)",
                    "rgba(76, 175, 80, 0.8)",
                    "rgba(255, 167, 38, 0.8)",
                    "rgba(239, 83, 80, 0.8)"
                ],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Request Trends Chart (Last 6 months)
function createRequestTrendsChart(requests) {
    const monthCounts = {};
    const months = [];
    
    for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        months.push(monthYear);
        monthCounts[monthYear] = 0;
    }

    requests.forEach(req => {
        if (req.requestedAt) {
            const date = req.requestedAt.seconds 
                ? new Date(req.requestedAt.seconds * 1000) 
                : new Date(req.requestedAt);
            const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            
            if (monthCounts.hasOwnProperty(monthYear)) {
                monthCounts[monthYear]++;
            }
        }
    });

    const ctx = document.getElementById("trendsChart");
    
    if (charts.trendsChart) {
        charts.trendsChart.destroy();
    }

    charts.trendsChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: months,
            datasets: [{
                label: "Requests",
                data: months.map(month => monthCounts[month]),
                borderColor: "rgba(102, 126, 234, 1)",
                backgroundColor: "rgba(102, 126, 234, 0.1)",
                fill: true,
                tension: 0.4,
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Incident Frequency Chart
function createIncidentFrequencyChart(incidents) {
    const monthCounts = {};
    const months = [];
    
    for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        months.push(monthYear);
        monthCounts[monthYear] = 0;
    }

    incidents.forEach(incident => {
        const dateField = incident.reportedAt || incident.createdAt || incident.submittedAt || incident.timestamp;
        
        if (dateField) {
            const date = dateField.seconds 
                ? new Date(dateField.seconds * 1000) 
                : new Date(dateField);
            const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            
            if (monthCounts.hasOwnProperty(monthYear)) {
                monthCounts[monthYear]++;
            }
        }
    });

    const ctx = document.getElementById("incidentsChart");
    
    if (charts.incidentsChart) {
        charts.incidentsChart.destroy();
    }

    charts.incidentsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: months,
            datasets: [{
                label: "Incidents",
                data: months.map(month => monthCounts[month]),
                backgroundColor: "rgba(239, 83, 80, 0.8)",
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Request Status Chart
function createRequestStatusChart(requests) {
    const statusCounts = {
        pending: 0,
        approved: 0,
        rejected: 0
    };

    requests.forEach(req => {
        const status = req.status || "pending";
        if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
        }
    });

    const ctx = document.getElementById("statusChart");
    
    if (charts.statusChart) {
        charts.statusChart.destroy();
    }

    charts.statusChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Pending", "Approved", "Rejected"],
            datasets: [{
                data: [statusCounts.pending, statusCounts.approved, statusCounts.rejected],
                backgroundColor: [
                    "rgba(255, 167, 38, 0.8)",
                    "rgba(76, 175, 80, 0.8)",
                    "rgba(239, 83, 80, 0.8)"
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    });
}