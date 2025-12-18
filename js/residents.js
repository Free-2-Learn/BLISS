import { db, auth, secondaryAuth } from "../firebase-config.js";
import { 
    collection, 
    getDocs, 
    updateDoc, 
    deleteDoc, 
    doc, 
    setDoc, 
    getDoc,
    addDoc,
    arrayUnion,
    serverTimestamp,
    Timestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { isCaptainOrStaff } from "./auth-helper.js";
import { goToDashboard } from "./navigation-helper.js";
import { getUserData } from "./auth-helper.js";

// Global variables
const residentsRef = collection(db, "residents");
let allResidents = [];
let sortOrder = "asc";
let currentUserRole = null;
let currentUserData = null;
let currentUser = null;

// Utility to calculate age from birthdate
function calculateAge(birthdate) {
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
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
        console.warn("🚫 Unauthorized access. Staff or Captain required.");
        alert("Access denied. Staff or Captain privileges required.");
        window.location.href = "../index.html";
        return;
    }

    console.log(`✅ User verified as ${accessCheck.role}`);
    currentUserRole = accessCheck.role;
    currentUser = user; // ADD THIS LINE
    
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
    
    // Initialize everything after auth is confirmed
    initializePage();
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

// Initialize page
function initializePage() {
    console.log("Initializing page...");
    
    // Setup modal buttons
    const openAddResidentModalButton = document.getElementById("openAddResidentModal");
    if (openAddResidentModalButton) {
        openAddResidentModalButton.addEventListener("click", openAddResidentModal);
    }
    
    // Setup forms
    const addResidentForm = document.getElementById("add-resident-form");
    if (addResidentForm) {
        addResidentForm.addEventListener("submit", handleAddResident);
    }
    
    const editResidentForm = document.getElementById("edit-resident-form");
    if (editResidentForm) {
        editResidentForm.addEventListener("submit", handleEditResident);
    }
    
    // Setup input validation
    setupInputValidation();
    setupBirthdateListeners();
    
    // Load residents
    loadResidents();
}

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
                module: 'residents',
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

window.loadResidents = loadResidents;

// Open Add Resident Modal
function openAddResidentModal() {
    const modal = document.getElementById("addResidentModal");
    if (modal) {
        modal.style.display = "block";
    }
}

// Close Add Resident Modal
window.closeAddResidentModal = function() {
    const modal = document.getElementById("addResidentModal");
    if (modal) {
        modal.style.display = "none";
        document.getElementById("add-resident-form").reset();
    }
};

// Close Edit Resident Modal
window.closeEditModal = function() {
    const modal = document.getElementById("editResidentModal");
    if (modal) {
        modal.style.display = "none";
    }
};

// Load residents from Firestore
async function loadResidents() {
    const residentsGrid = document.getElementById("residents-grid");
    
    if (!residentsGrid) {
        console.error("residents-grid element not found!");
        return;
    }
    
    residentsGrid.innerHTML = `
        <div class="loading-card">
            <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #667eea; margin-bottom: 20px;"></i>
            <p style="font-size: 18px; color: #718096;">Loading residents...</p>
        </div>
    `;

    try {
        console.log("Fetching residents from Firestore...");
        const querySnapshot = await getDocs(residentsRef);
        let residents = [];
        let activeCount = 0;
        let inactiveCount = 0;

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (!data.firstName || !data.lastName) {
                console.warn(`Skipping resident with missing name fields: ${docSnap.id}`);
                return;
            }

            residents.push(data);

            if (data.status === "Active") {
                activeCount++;
            } else if (data.status === "Inactive") {
                inactiveCount++;
            }
        });

        console.log(`✅ Loaded ${residents.length} residents`);
        allResidents = residents;

        // Update stats
        const totalResidentsElem = document.getElementById("total-residents");
        const activeResidentsElem = document.getElementById("active-residents");
        const inactiveResidentsElem = document.getElementById("inactive-residents");

        if (totalResidentsElem) totalResidentsElem.textContent = residents.length;
        if (activeResidentsElem) activeResidentsElem.textContent = activeCount;
        if (inactiveResidentsElem) inactiveResidentsElem.textContent = inactiveCount;

        // Sort and render
        residents.sort((a, b) => {
            const fullNameA = `${a.firstName} ${a.middleName || ""} ${a.lastName}`.toLowerCase();
            const fullNameB = `${b.firstName} ${b.middleName || ""} ${b.lastName}`.toLowerCase();
            return sortOrder === "asc" ? fullNameA.localeCompare(fullNameB) : fullNameB.localeCompare(fullNameA);
        });

        renderResidentRows(residents);

    } catch (error) {
        console.error("❌ Error loading residents:", error);
        residentsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-circle" style="color: #f56565;"></i>
                <p style="font-size: 18px;">Error loading residents</p>
                <p style="font-size: 14px; color: #a0aec0; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Render resident rows - UPDATED FOR CARD LAYOUT
function renderResidentRows(residentsToRender) {
    const residentsGrid = document.getElementById("residents-grid");
    residentsGrid.innerHTML = "";

    if (residentsToRender.length === 0) {
        residentsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p style="font-size: 18px; color: #a0aec0;">No residents found</p>
                <p style="font-size: 14px; margin-top: 10px;">Try adjusting your search or filters</p>
            </div>
        `;
        return;
    }

    residentsToRender.forEach((resident) => {
        const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;
        const initials = `${resident.firstName.charAt(0)}${resident.lastName.charAt(0)}`.toUpperCase();
        const age = calculateAge(resident.birthdate);
        const status = resident.status || 'Active';

        const card = document.createElement("div");
        card.className = "resident-card";
        card.setAttribute("data-id", resident.id);
        card.innerHTML = `
            <div class="resident-card-header">
                <div style="display: flex; align-items: center; flex: 1;">
                    <div class="resident-avatar">${initials}</div>
                    <div class="resident-info">
                        <div class="resident-name">${fullName}</div>
                        <div class="resident-email">
                            <i class="fas fa-envelope"></i> ${resident.email || 'No email'}
                        </div>
                    </div>
                </div>
                <span class="status-badge ${status.toLowerCase()}" id="status-${resident.id}">${status}</span>
            </div>
            
            <div class="resident-details">
                <div class="detail-item">
                    <i class="fas fa-phone"></i>
                    <span class="detail-label">Contact:</span>
                    <span class="detail-value">${resident.contactNumber || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <span class="detail-label">Address:</span>
                    <span class="detail-value">${resident.address || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <i class="fas fa-birthday-cake"></i>
                    <span class="detail-label">Age / DOB:</span>
                    <span class="detail-value">${age} years / ${resident.birthdate || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <i class="fas fa-venus-mars"></i>
                    <span class="detail-label">Gender:</span>
                    <span class="detail-value">${resident.gender || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <i class="fas fa-heart"></i>
                    <span class="detail-label">Civil Status:</span>
                    <span class="detail-value">${resident.civilStatus || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <i class="fas fa-briefcase"></i>
                    <span class="detail-label">Occupation:</span>
                    <span class="detail-value">${resident.occupation || 'N/A'}</span>
                </div>
            </div>

            <div class="resident-actions">
                <button class="btn-action btn-view" onclick="viewResidentDetails('${resident.id}')">
                    <i class="fas fa-eye"></i> View
                </button>
                <button class="btn-action btn-edit" onclick="openEditModal('${resident.id}')">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-action btn-toggle" onclick="toggleStatus('${resident.id}', '${status}')">
                    <i class="fas fa-exchange-alt"></i> Toggle
                </button>
                <button class="btn-action btn-delete" onclick="deleteResident('${resident.id}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
        residentsGrid.appendChild(card);
    });
}

// Toggle sorting
window.toggleSorting = function() {
    sortOrder = sortOrder === "asc" ? "desc" : "asc";
    const sortIcon = document.getElementById("sortIcon");
    if (sortIcon) {
        sortIcon.innerText = sortOrder === "asc" ? "▲" : "▼";
    }
    loadResidents();
};

// Search residents
window.searchResidents = function() {
    const query = document.getElementById("search-bar").value.trim().toLowerCase();
    const filteredResidents = allResidents
        .map(resident => {
            const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`.toLowerCase();
            const email = (resident.email || "").toLowerCase();
            const contact = (resident.contactNumber || "").toLowerCase();
            const searchText = `${fullName} ${email} ${contact}`;
            const index = searchText.indexOf(query);
            return { resident, rank: index === -1 ? Infinity : index };
        })
        .filter(item => item.rank !== Infinity)
        .sort((a, b) => a.rank - b.rank)
        .map(item => item.resident);

    const displayList = query ? filteredResidents : allResidents;
    renderResidentRows(displayList);
};

// Open Edit Modal
window.openEditModal = async function(residentId) {
    const residentRef = doc(db, "residents", residentId);
    const residentDoc = await getDoc(residentRef);

    if (!residentDoc.exists()) {
        alert("Resident not found.");
        return;
    }

    const resident = residentDoc.data();

    document.getElementById("edit-resident-id").value = residentId;
    document.getElementById("edit-first-name").value = resident.firstName || "";
    document.getElementById("edit-middle-name").value = resident.middleName || "";
    document.getElementById("edit-last-name").value = resident.lastName || "";
    document.getElementById("edit-age").value = resident.age || "";
    document.getElementById("edit-birthdate").value = resident.birthdate || "";
    document.getElementById("edit-gender").value = resident.gender || "";
    document.getElementById("edit-civil-status").value = resident.civilStatus || "";
    document.getElementById("edit-contact-number").value = resident.contactNumber || "";
    document.getElementById("edit-address").value = resident.address || "";
    document.getElementById("edit-occupation").value = resident.occupation || "";
    document.getElementById("edit-education").value = resident.education || "";
    document.getElementById("edit-special-categories").value = resident.specialCategories || "";
    document.getElementById("edit-voter-info").value = resident.voterInfo || "";

    document.getElementById("editResidentModal").style.display = "block";
};

// Handle Edit Resident Form
async function handleEditResident(event) {
    event.preventDefault();

    const residentId = document.getElementById("edit-resident-id").value;
    const updatedData = {
        firstName: document.getElementById("edit-first-name").value.trim(),
        middleName: document.getElementById("edit-middle-name").value.trim(),
        lastName: document.getElementById("edit-last-name").value.trim(),
        age: parseInt(document.getElementById("edit-age").value),
        birthdate: document.getElementById("edit-birthdate").value,
        gender: document.getElementById("edit-gender").value,
        civilStatus: document.getElementById("edit-civil-status").value,
        contactNumber: document.getElementById("edit-contact-number").value,
        address: document.getElementById("edit-address").value,
        occupation: document.getElementById("edit-occupation").value,
        education: document.getElementById("edit-education").value,
        specialCategories: document.getElementById("edit-special-categories").value,
        voterInfo: document.getElementById("edit-voter-info").value
    };

    try {
        await updateDoc(doc(db, "residents", residentId), updatedData);
        alert("Resident updated successfully!");
        closeEditModal();
        loadResidents();
    } catch (error) {
        console.error("Error updating resident:", error);
        alert("Failed to update resident.");
    }
}

// Delete resident
window.deleteResident = async function(id) {
    try {
        const residentDocRef = doc(db, "residents", id);
        const residentDoc = await getDoc(residentDocRef);

        if (!residentDoc.exists()) {
            alert("Resident not found.");
            return;
        }

        const residentData = residentDoc.data();
        const fullName = `${residentData.firstName} ${residentData.middleName || ''} ${residentData.lastName}`.trim();
        
        const confirmation = confirm(`Are you sure you want to delete ${fullName}?\n\nThis will move them to the archive.`);
        
        if (!confirmation) return;

        // Move to backup with timestamp
        const backupRef = doc(db, "backupResidents", id);
        await setDoc(backupRef, {
            ...residentData,
            archivedAt: new Date(),
            archivedBy: auth.currentUser.uid
        });

        // Delete from residents
        await deleteDoc(residentDocRef);

        // Log activity (analytics)
        await logActivity('deleted_resident', {
            residentId: id,
            residentName: fullName,
            residentEmail: residentData.email
        });
        
        // Log document history (in backup collection)
        await logDocumentHistory(id, 'resident_archived', {
            residentName: fullName,
            email: residentData.email,
            archivedBy: auth.currentUser.email
        });

        alert(`${fullName} has been archived successfully.`);
        loadResidents();
    } catch (error) {
        console.error("Error deleting resident:", error);
        alert("Failed to delete resident.");
    }
};

// Toggle status - OPTIMIZED (only updates the status badge, doesn't reload everything)
window.toggleStatus = async function(id, currentStatus) {
    try {
        const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
        
        // Update in Firestore
        const residentDocRef = doc(db, "residents", id);
        await updateDoc(residentDocRef, { 
            status: newStatus,
            updatedAt: new Date()
        });

        // Get resident for logging
        const resident = allResidents.find(r => r.id === id);
        const fullName = resident ? `${resident.firstName} ${resident.lastName}` : 'Unknown';
        
        // Log activity (analytics)
        await logActivity('status_changed', {
            residentId: id,
            residentName: fullName,
            oldStatus: currentStatus,
            newStatus: newStatus
        });
        
        await logDocumentHistory(id, 'status_changed', {
            residentName: fullName,
            oldStatus: currentStatus,
            newStatus: newStatus
        });

        // Update UI immediately without reloading
        const statusBadge = document.getElementById(`status-${id}`);
        if (statusBadge) {
            statusBadge.className = `status-badge ${newStatus.toLowerCase()}`;
            statusBadge.textContent = newStatus;
        }

        // Update the button's onclick attribute to reflect new status
        const card = document.querySelector(`.resident-card[data-id="${id}"]`);
        if (card) {
            const toggleBtn = card.querySelector('.btn-toggle');
            if (toggleBtn) {
                toggleBtn.onclick = () => toggleStatus(id, newStatus);
            }
        }

        // Update stats counters
        const activeResidentsElem = document.getElementById("active-residents");
        const inactiveResidentsElem = document.getElementById("inactive-residents");

        if (activeResidentsElem && inactiveResidentsElem) {
            const activeCount = parseInt(activeResidentsElem.textContent);
            const inactiveCount = parseInt(inactiveResidentsElem.textContent);

            if (newStatus === "Active") {
                activeResidentsElem.textContent = activeCount + 1;
                inactiveResidentsElem.textContent = inactiveCount - 1;
            } else {
                activeResidentsElem.textContent = activeCount - 1;
                inactiveResidentsElem.textContent = inactiveCount + 1;
            }
        }

        // Update the resident in allResidents array
        const residentIndex = allResidents.findIndex(r => r.id === id);
        if (residentIndex !== -1) {
            allResidents[residentIndex].status = newStatus;
        }

        console.log(`✅ Status updated: ${id} -> ${newStatus}`);
    } catch (error) {
        console.error("Error updating resident status:", error);
        alert("Failed to update status.");
    }
};

// Handle Add Resident Form
async function handleAddResident(event) {
    event.preventDefault();

    const addResidentButton = document.getElementById("submitAddResident");
    const addResidentText = document.getElementById("addResidentText");
    const addResidentLoader = document.getElementById("addResidentLoader");

    if (addResidentText) addResidentText.style.display = "none";
    if (addResidentLoader) addResidentLoader.style.display = "inline-block";
    if (addResidentButton) addResidentButton.disabled = true;

    const firstName = document.getElementById("first-name").value.trim();
    const lastName = document.getElementById("last-name").value.trim();
    const middleName = document.getElementById("middle-name").value.trim();

    try {
        const email = await generateUniqueEmail(firstName, lastName);
        const password = "Resident123";
        const customId = email.toLowerCase();

        const age = parseInt(document.getElementById("age").value);
        const birthdate = document.getElementById("birthdate").value;
        const gender = document.getElementById("gender").value;
        const civilStatus = document.getElementById("civil-status").value;
        const contactNumber = document.getElementById("contact-number").value.trim();
        const address = document.getElementById("address").value.trim();
        const occupation = document.getElementById("occupation").value.trim();
        const education = document.getElementById("education").value;
        const specialCategories = document.getElementById("special-categories").value;
        const voterInfo = document.getElementById("voter-info").value.trim();

        // Try to create auth account with retry logic
        let authCreated = false;
        let retryCount = 0;
        const maxRetries = 5;
        let currentEmail = email;

        while (!authCreated && retryCount < maxRetries) {
            try {
                await createUserWithEmailAndPassword(secondaryAuth, currentEmail, password);
                authCreated = true;
                console.log(`✅ Auth account created: ${currentEmail}`);
            } catch (authError) {
                if (authError.code === 'auth/email-already-in-use') {
                    console.warn(`⚠️ Email ${currentEmail} already in use, generating new one...`);
                    retryCount++;
                    // Generate new email with counter
                    const baseEmail = `${firstName.toLowerCase().replace(/\s+/g, '.')}.${lastName.toLowerCase()}`;
                    currentEmail = `${baseEmail}${retryCount}@BMS.com`.toLowerCase();
                } else {
                    // Other auth errors should be thrown
                    throw authError;
                }
            }
        }

        if (!authCreated) {
            throw new Error('Unable to create unique email after multiple attempts');
        }

        // Update customId to match the email that was successfully created
        const finalCustomId = currentEmail.toLowerCase();

        // Save to Firestore
        await setDoc(doc(db, "residents", finalCustomId), {
            id: finalCustomId,
            firstName,
            lastName,
            middleName,
            email: currentEmail,
            age,
            birthdate,
            gender,
            civilStatus,
            contactNumber,
            address,
            occupation,
            education,
            specialCategories,
            voterInfo,
            status: "Active",
            createdAt: new Date()
        });

        // Log activity (analytics)
        const fullName = `${firstName} ${middleName} ${lastName}`.trim();
        await logActivity('created_resident', {
            residentId: finalCustomId,
            residentName: fullName,
            residentEmail: currentEmail
        });
        
        await logDocumentHistory(finalCustomId, 'resident_created', {
            residentName: fullName,
            email: currentEmail
        });

        alert("Resident added successfully!");
        closeAddResidentModal();
        loadResidents();
    } catch (error) {
        console.error("Error adding resident:", error);
        alert(`Failed to add resident: ${error.message}`);
    } finally {
        if (addResidentText) addResidentText.style.display = "inline";
        if (addResidentLoader) addResidentLoader.style.display = "none";
        if (addResidentButton) addResidentButton.disabled = false;
    }
}

// Generate unique email
async function generateUniqueEmail(firstName, lastName) {
    const processedFirstName = firstName.trim().toLowerCase().replace(/\s+/g, '.');
    const processedLastName = lastName.trim().toLowerCase();
    
    let baseEmail = `${processedFirstName}.${processedLastName}`;
    let email = `${baseEmail}@BMS.com`;
    let count = 1;

    while (true) {
        try {
            const residentRef = doc(db, "residents", email);
            const backupRef = doc(db, "backupResidents", email);

            const [residentSnap, backupSnap] = await Promise.all([
                getDoc(residentRef),
                getDoc(backupRef)
            ]);

            if (!residentSnap.exists() && !backupSnap.exists()) {
                return email;
            }

            email = `${baseEmail}${count}@BMS.com`;
            count++;
        } catch (error) {
            console.error("Error checking email:", error);
            return email;
        }
    }
}

// Setup birthdate listeners
function setupBirthdateListeners() {
    const birthdateInput = document.getElementById("birthdate");
    const editBirthdateInput = document.getElementById("edit-birthdate");

    if (birthdateInput) {
        birthdateInput.addEventListener("change", function() {
            const ageField = document.getElementById("age");
            if (this.value && ageField) {
                const age = calculateAge(this.value);
                ageField.value = isNaN(age) ? "" : age;
            }
        });
    }

    if (editBirthdateInput) {
        editBirthdateInput.addEventListener("change", function() {
            const ageField = document.getElementById("edit-age");
            if (this.value && ageField) {
                const age = calculateAge(this.value);
                ageField.value = isNaN(age) ? "" : age;
            }
        });
    }
}

// Setup input validation
function setupInputValidation() {
    // Name fields - only letters and spaces
    document.querySelectorAll("#first-name, #middle-name, #last-name, #edit-first-name, #edit-middle-name, #edit-last-name").forEach(input => {
        if (input) {
            input.addEventListener("input", function() {
                this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
            });
        }
    });

    // Phone number validation
    document.querySelectorAll(".phone-input").forEach(inputField => {
        if (inputField) {
            inputField.addEventListener("input", function(event) {
                let input = event.target.value.replace(/[^0-9]/g, "");

                if (!input.startsWith("63")) {
                    input = "63" + input;
                }

                if (input.startsWith("630")) {
                    input = "63" + input.substring(3);
                }

                if (input.length > 12) {
                    input = input.slice(0, 12);
                }

                event.target.value = "+" + input.slice(0, 2) + " " + input.slice(2);
            });
        }
    });

    // Age fields - prevent special characters
    document.querySelectorAll("#age, #edit-age").forEach(input => {
        if (input) {
            input.addEventListener("keydown", function(event) {
                if (["e", "E", "+", "-", "."].includes(event.key)) {
                    event.preventDefault();
                }
            });
            input.addEventListener("input", function() {
                this.value = this.value.replace(/\D/g, "");
            });
        }
    });
}

// Filter by status
window.filterByStatus = function() {
    const filterValue = document.getElementById("status-filter").value;
    
    let filtered = allResidents;
    
    if (filterValue !== "all") {
        filtered = allResidents.filter(r => r.status === filterValue);
    }
    
    renderResidentRows(filtered);
};

// View resident details - REDESIGNED (with activity logging)
window.viewResidentDetails = function(id) {
    const resident = allResidents.find(r => r.id === id);
    if (!resident) return;

    const fullName = `${resident.firstName} ${resident.middleName || ""} ${resident.lastName}`;
    const initials = `${resident.firstName.charAt(0)}${resident.lastName.charAt(0)}`.toUpperCase();
    const age = calculateAge(resident.birthdate);
    const status = resident.status || 'Active';

    const modal = document.getElementById('viewDetailsModal');
    const modalBody = document.getElementById('view-details-body');

    modalBody.innerHTML = `
        <div class="view-details-container">
            <!-- Header with Avatar -->
            <div class="view-details-header">
                <div class="view-details-avatar">${initials}</div>
                <div class="view-details-name">
                    <h3>${fullName}</h3>
                    <p><i class="fas fa-envelope"></i> ${resident.email || 'No email provided'}</p>
                </div>
                <span class="view-status-badge ${status.toLowerCase()}">
                    <i class="fas fa-circle"></i> ${status}
                </span>
            </div>

            <!-- Personal Information -->
            <div class="view-section">
                <h4 class="view-section-title">
                    <i class="fas fa-user"></i> Personal Information
                </h4>
                <div class="view-details-grid">
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-id-card"></i> First Name
                        </div>
                        <div class="view-detail-value">${resident.firstName}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-id-card"></i> Middle Name
                        </div>
                        <div class="view-detail-value">${resident.middleName || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-id-card"></i> Last Name
                        </div>
                        <div class="view-detail-value">${resident.lastName}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-birthday-cake"></i> Age
                        </div>
                        <div class="view-detail-value">${age} years old</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-calendar"></i> Birthdate
                        </div>
                        <div class="view-detail-value">${resident.birthdate || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-venus-mars"></i> Gender
                        </div>
                        <div class="view-detail-value">${resident.gender || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-heart"></i> Civil Status
                        </div>
                        <div class="view-detail-value">${resident.civilStatus || 'N/A'}</div>
                    </div>
                </div>
            </div>

            <!-- Contact Information -->
            <div class="view-section">
                <h4 class="view-section-title">
                    <i class="fas fa-address-book"></i> Contact Information
                </h4>
                <div class="view-details-grid">
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-phone"></i> Contact Number
                        </div>
                        <div class="view-detail-value">${resident.contactNumber || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item full-width">
                        <div class="view-detail-label">
                            <i class="fas fa-map-marker-alt"></i> Address
                        </div>
                        <div class="view-detail-value">${resident.address || 'N/A'}</div>
                    </div>
                </div>
            </div>

            <!-- Additional Information -->
            <div class="view-section">
                <h4 class="view-section-title">
                    <i class="fas fa-info-circle"></i> Additional Information
                </h4>
                <div class="view-details-grid">
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-briefcase"></i> Occupation
                        </div>
                        <div class="view-detail-value">${resident.occupation || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-graduation-cap"></i> Education
                        </div>
                        <div class="view-detail-value">${resident.education || 'N/A'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-star"></i> Special Categories
                        </div>
                        <div class="view-detail-value">${resident.specialCategories || 'None'}</div>
                    </div>
                    <div class="view-detail-item">
                        <div class="view-detail-label">
                            <i class="fas fa-vote-yea"></i> Voter Info
                        </div>
                        <div class="view-detail-value">${resident.voterInfo || 'N/A'}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'block';
    
    // Log activity (analytics) - viewing is tracked
    logActivity('viewed_resident_details', {
        residentId: id,
        residentName: fullName
    });
};

// Close view modal
window.closeViewModal = function() {
    const modal = document.getElementById('viewDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
};