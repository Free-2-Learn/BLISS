import { auth, db } from "../firebase-config.js";
import { 
    collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, orderBy, 
    limit, startAfter, updateDoc, setDoc, arrayUnion, Timestamp 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { isCaptainOrStaff } from "../js/auth-helper.js";
import { goToDashboard } from "../js/navigation-helper.js";
import { getUserData } from "../js/auth-helper.js";

// Firestore references
const announcementsRef = collection(db, "announcements");

// DOM Elements
const announcementList = document.getElementById("announcement-list");
const postButton = document.getElementById("post-announcement");
const fileInput = document.getElementById("announcement-image");
const fileButton = document.getElementById("custom-file-button");
const imagePreview = document.getElementById("image-preview");
const announcementInput = document.getElementById("announcement-input");
const announcementTitle = document.getElementById("announcement-title");
const loadMoreButton = document.getElementById("load-more");

// Global variables
let lastVisible = null;
const PAGE_SIZE = 5;
let currentUserRole = null;
let currentUserData = null;
let selectedImages = [];

// ========== LOGGING FUNCTIONS ==========

// Log activity to activityLogs collection
async function logActivity(action, details = {}) {
    if (!auth.currentUser || !currentUserData) return;

    const userId = auth.currentUser.email.toLowerCase();
    const fullName = currentUserData?.fullName || auth.currentUser.email;

    try {
        const logRef = doc(db, 'activityLogs', userId);

        await setDoc(logRef, {
            userId: userId,
            userName: fullName,
            userRole: currentUserData?.role || 'staff',
            activities: arrayUnion({
                action: action,
                module: 'announcements',
                details: details,
                timestamp: Timestamp.now()
            })
        }, { merge: true });
        
        console.log(`✅ Activity logged: ${action}`);
    } catch (error) {
        console.error("Error logging activity:", error);
    }
}

// Log to document history
async function logDocumentHistory(announcementId, action, details = {}) {
    if (!auth.currentUser || !currentUserData) return;

    try {
        const historyData = {
            action: action,
            module: 'announcements',
            announcementId: announcementId,
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email,
            userName: currentUserData?.fullName || auth.currentUser.email,
            userRole: currentUserData?.role || 'staff',
            timestamp: Timestamp.now(),
            details: details
        };

        const historyRef = collection(db, 'documentHistory', announcementId, 'logs');
        await addDoc(historyRef, historyData);
        
        console.log(`✅ Document history logged for announcement: ${announcementId}`);
    } catch (error) {
        console.error('Error logging document history:', error);
    }
}

// ========== AUTHENTICATION ==========

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("🚫 No user logged in. Redirecting to login.");
        window.location.href = "../index.html";
        return;
    }

    const accessCheck = await isCaptainOrStaff(user);

    if (!accessCheck.hasAccess) {
        console.warn("🚫 Unauthorized access. Redirecting...");
        alert("Access denied. Staff or Captain privileges required.");
        window.location.href = "../index.html";
        return;
    }

    console.log(`✅ User verified as ${accessCheck.role}`);
    currentUserRole = accessCheck.role;

    // Get user data
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

    console.log(`🔍 Current user role: ${currentUserRole}`);
    console.log(`📋 Will show create form: ${accessCheck.role === 'captain' || accessCheck.role === 'staff'}`);

    // Show form for BOTH captain AND staff
    const formContainer = document.getElementById("announcement-form-container");
    if (accessCheck.role === 'captain' || accessCheck.role === 'staff') {
        if (formContainer) {
            formContainer.style.display = "block";
            console.log("✅ Announcement form shown for captain/staff");
        }
    } else {
        console.log("⚠️ Form hidden - user is not captain or staff");
        if (formContainer) {
            formContainer.style.display = "none";
        }
    }
    
    setupBackButton();
    setupLogout();
    loadAnnouncements();
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

// Setup logout
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

// ========== LOAD ANNOUNCEMENTS ==========

async function loadAnnouncements(initialLoad = true) {
    let queryConstraints = [orderBy("date", "desc"), limit(PAGE_SIZE)];

    if (!initialLoad && lastVisible) {
        queryConstraints.push(startAfter(lastVisible));
    }

    try {
        const querySnapshot = await getDocs(query(announcementsRef, ...queryConstraints));

        if (querySnapshot.empty) {
            console.log("No more announcements to load.");
            loadMoreButton.style.display = "none";
            
            if (initialLoad && announcementList.children.length === 0) {
                announcementList.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: #718096;">
                        <i class="fas fa-bullhorn" style="font-size: 64px; color: #cbd5e0; margin-bottom: 20px;"></i>
                        <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">No Announcements Yet</p>
                        <p style="font-size: 14px;">Be the first to create an announcement!</p>
                    </div>
                `;
            }
            return;
        }

        querySnapshot.forEach((doc) => displayAnnouncement(doc));

        // Check if there's more data
        if (querySnapshot.docs.length < PAGE_SIZE) {
            loadMoreButton.style.display = "none";
        } else {
            loadMoreButton.style.display = "block";
        }

        lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        console.log(`📢 Loaded ${querySnapshot.docs.length} announcements`);
        console.log(`👤 Current role for buttons: ${currentUserRole}`);
        
        // Update stats
        updateStats();
    } catch (error) {
        console.error("Error loading announcements:", error);
        announcementList.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #f56565;">
                <i class="fas fa-exclamation-circle" style="font-size: 64px; margin-bottom: 20px;"></i>
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Error Loading Announcements</p>
                <p style="font-size: 14px;">${error.message}</p>
            </div>
        `;
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
            const announcementDate = new Date(data.date);
            announcementDate.setHours(0, 0, 0, 0);
            if (announcementDate.getTime() === today.getTime()) {
                todayCount++;
            }
        });
        
        document.getElementById('total-announcements').textContent = total;
        document.getElementById('today-announcements').textContent = todayCount;
    } catch (error) {
        console.error("Error updating stats:", error);
    }
}

// Display single announcement
function displayAnnouncement(doc, prepend = false) {
    const announcement = doc.data();
    const li = document.createElement("li");
    li.setAttribute("id", `announcement-${doc.id}`);

    const textFormatted = announcement.text
        .replace(/</g, "&lt;")  
        .replace(/>/g, "&gt;")  
        .replace(/\n/g, "<br>") 
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    
    // Add title if exists
    let titleHTML = '';
    if (announcement.title) {
        titleHTML = `
            <div class="announcement-title">
                <i class="fas fa-bullhorn"></i>
                ${announcement.title}
            </div>
        `;
    }

    let imagesHTML = "";
    if (announcement.images && Array.isArray(announcement.images) && announcement.images.length > 0) {
        imagesHTML = `<div class="image-container" style="display: flex; gap: 10px; flex-wrap: wrap; margin: 15px 0;">` + 
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

    const dateFormatted = new Date(announcement.date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Get poster name
    const posterName = announcement.postedBy || 'Unknown';
    
    // Check if edited
    let editedIndicator = '';
    if (announcement.editedAt) {
        const editedDate = new Date(announcement.editedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const editedBy = announcement.editedBy || 'Unknown';
        editedIndicator = `
            <small style="color: #718096; font-style: italic;">
                <i class="fas fa-edit"></i> Edited by ${editedBy} on ${editedDate}
            </small>
        `;
    }

    // Show edit/delete buttons for BOTH captain AND staff
    let actionButtons = '';
    if (currentUserRole === 'captain' || currentUserRole === 'staff') {
        actionButtons = `
            <button class="edit-btn" data-id="${doc.id}">
                <i class="fas fa-edit"></i> Edit
            </button>
            <button class="delete-btn" data-id="${doc.id}">
                <i class="fas fa-trash"></i> Delete
            </button>
        `;
    }

    li.innerHTML = `
        ${titleHTML}
        <p class="announcement-text">${textFormatted}</p>
        ${imagesHTML}
        <div style="display: flex; gap: 20px; align-items: center; margin-top: 15px; flex-wrap: wrap;">
            <small style="flex: 1;"><i class="fas fa-calendar"></i> ${dateFormatted}</small>
            <small><i class="fas fa-user"></i> Posted by: <strong>${posterName}</strong></small>
        </div>
        ${editedIndicator}
        <div style="margin-top: 15px;">
            ${actionButtons}
        </div>
    `;

    if (prepend) {
        announcementList.prepend(li);
    } else {
        announcementList.appendChild(li);
    }

    // Add event listeners for edit/delete buttons
    if (currentUserRole === 'captain' || currentUserRole === 'staff') {
        const editBtn = li.querySelector(".edit-btn");
        const deleteBtn = li.querySelector(".delete-btn");
        
        if (editBtn) {
            editBtn.addEventListener("click", () => openEditModal(doc.id, announcement));
        }
        if (deleteBtn) {
            deleteBtn.addEventListener("click", () => handleDelete(doc.id));
        }
    }
}

// ========== IMAGE HANDLING ==========

let imageList = [];
let currentIndex = 0;

window.openImageModal = function(announcementId, index) {
    const images = document.querySelectorAll(`img[data-id="${announcementId}"]`);
    imageList = Array.from(images).map(img => img.src);
    currentIndex = index;

    const modal = document.getElementById("image-modal");
    const modalImage = document.getElementById("modal-image");
    const counter = document.getElementById("image-counter");

    modalImage.src = imageList[currentIndex];
    counter.textContent = `${currentIndex + 1} / ${imageList.length}`;
    modal.style.display = "flex";
};

window.closeImageModal = function() {
    document.getElementById("image-modal").style.display = "none";
};

window.prevImage = function() {
    if (currentIndex > 0) {
        currentIndex--;
        document.getElementById("modal-image").src = imageList[currentIndex];
        document.getElementById("image-counter").textContent = `${currentIndex + 1} / ${imageList.length}`;
    }
};

window.nextImage = function() {
    if (currentIndex < imageList.length - 1) {
        currentIndex++;
        document.getElementById("modal-image").src = imageList[currentIndex];
        document.getElementById("image-counter").textContent = `${currentIndex + 1} / ${imageList.length}`;
    }
};

// Image modal button events
document.getElementById('close-btn').addEventListener('click', closeImageModal);
document.getElementById('prev-btn').addEventListener('click', prevImage);
document.getElementById('next-btn').addEventListener('click', nextImage);

// ========== FILE UPLOAD ==========

fileButton.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        Array.from(fileInput.files).forEach((file) => {
            if (!selectedImages.some(img => img.name === file.name)) {
                selectedImages.push(file);
                displayImagePreview(file);
            }
        });
    }
    fileInput.value = "";
});

function displayImagePreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const imgContainer = document.createElement("div");
        imgContainer.classList.add("image-container");

        const img = document.createElement("img");
        img.src = e.target.result;

        const removeBtn = document.createElement("button");
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.classList.add("remove-btn");

        removeBtn.addEventListener("click", () => {
            selectedImages = selectedImages.filter(img => img.name !== file.name);
            imgContainer.remove();
        });

        imgContainer.appendChild(img);
        imgContainer.appendChild(removeBtn);
        imagePreview.appendChild(imgContainer);
    };
    reader.readAsDataURL(file);
}

// ========== UPLOAD TO IMGBB ==========

async function uploadImages(files) {
    const apiKey = "fefe8e044819c8327dd6610fc3fe67a0";
    let uploadedUrls = [];

    for (const file of files) {
        try {
            const formData = new FormData();
            formData.append("image", file);

            const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
                method: "POST",
                body: formData
            });

            const result = await response.json();
            if (result.success) {
                uploadedUrls.push(result.data.url);
            }
        } catch (error) {
            console.error("Error uploading image:", error);
        }
    }

    return uploadedUrls;
}

// ========== POST ANNOUNCEMENT ==========

announcementInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
});

async function postAnnouncement() {
    const title = announcementTitle ? announcementTitle.value.trim() : '';
    const text = announcementInput.value.trim();

    if (!text) {
        alert("Please enter announcement text.");
        return;
    }

    postButton.disabled = true;
    postButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

    let imageUrls = await uploadImages(selectedImages);

    // Get poster name
    const postedBy = currentUserData?.fullName || auth.currentUser?.email || 'Unknown';

    try {
        const docRef = await addDoc(announcementsRef, {
            title: title || null,
            text,
            images: imageUrls.length > 0 ? imageUrls : null,
            postedBy: postedBy,
            postedById: auth.currentUser?.uid || null,
            date: new Date().toISOString(),
        });

        const newAnnouncement = await getDoc(docRef);
        displayAnnouncement(newAnnouncement, true);
        
        // Log activity
        await logActivity('announcement_created', {
            announcementId: docRef.id,
            title: title || 'No title',
            textPreview: text.substring(0, 50) + '...',
            imageCount: imageUrls.length,
            postedBy: postedBy
        });
        
        // Log document history
        await logDocumentHistory(docRef.id, 'announcement_created', {
            title: title,
            textPreview: text.substring(0, 100),
            imageCount: imageUrls.length,
            postedBy: postedBy
        });
        
        alert("✅ Announcement posted successfully!");

        // Clear form
        if (announcementTitle) announcementTitle.value = "";
        announcementInput.value = "";
        selectedImages = [];
        imagePreview.innerHTML = "";
        
        updateStats();
    } catch (error) {
        console.error("Error posting announcement:", error);
        alert("❌ Failed to post announcement.");
    }

    postButton.disabled = false;
    postButton.innerHTML = '<i class="fas fa-paper-plane"></i> Post Announcement';
}

postButton.addEventListener("click", postAnnouncement);
loadMoreButton.addEventListener("click", () => loadAnnouncements(false));

// ========== DELETE ANNOUNCEMENT ==========

async function handleDelete(announcementId) {
    if (!confirm("Are you sure you want to delete this announcement?")) return;

    try {
        // Get announcement data before deleting
        const announcementDoc = await getDoc(doc(db, "announcements", announcementId));
        const announcementData = announcementDoc.data();
        
        await deleteDoc(doc(db, "announcements", announcementId));
        document.getElementById(`announcement-${announcementId}`).remove();
        
        // Log activity
        await logActivity('announcement_deleted', {
            announcementId: announcementId,
            textPreview: announcementData.text.substring(0, 50) + '...'
        });
        
        // Log document history
        await logDocumentHistory(announcementId, 'announcement_deleted', {
            textPreview: announcementData.text.substring(0, 100)
        });
        
        alert("✅ Announcement deleted successfully!");
        updateStats();
    } catch (error) {
        console.error("Error deleting announcement:", error);
        alert("❌ Failed to delete announcement.");
    }
}

// ========== EDIT ANNOUNCEMENT ==========

const editModal = document.getElementById("edit-modal");
const editTitle = document.getElementById("edit-title");
const editText = document.getElementById("edit-text");
const editImagePreview = document.getElementById("edit-image-preview");
const editImageInput = document.getElementById("edit-image-input");
const saveButton = document.getElementById("save-edit");
const closeModals = document.querySelectorAll(".close-modal");

let currentEditId = null;
let currentImages = [];

function openEditModal(docId, announcement) {
    currentEditId = docId;
    editTitle.value = announcement.title || '';
    editText.value = announcement.text;
    currentImages = Array.isArray(announcement.images) ? [...announcement.images] : [];

    editImagePreview.innerHTML = currentImages
        .map((image, index) => 
            `<div class="image-container">
                <img src="${image}">
                <button class="remove-img" data-index="${index}">
                    <i class="fas fa-times"></i>
                </button>
            </div>`
        ).join("");

    editModal.classList.add("show");

    document.querySelectorAll(".remove-img").forEach(button => {
        button.addEventListener("click", function () {
            const index = this.getAttribute("data-index");
            currentImages.splice(index, 1);
            openEditModal(docId, { title: editTitle.value, text: editText.value, images: currentImages });
        });
    });
}

closeModals.forEach(btn => {
    btn.addEventListener("click", () => {
        editModal.classList.remove("show");
    });
});

editImageInput.addEventListener("change", function () {
    const files = Array.from(editImageInput.files);
    const fileReaders = files.map(file => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    });

    Promise.all(fileReaders).then(images => {
        currentImages = currentImages.concat(images);
        openEditModal(currentEditId, { title: editTitle.value, text: editText.value, images: currentImages });
    });
});

saveButton.addEventListener("click", async () => {
    const newTitle = editTitle.value.trim();
    const newText = editText.value.trim();

    const newFiles = Array.from(editImageInput.files);
    const alreadyUploadedImages = currentImages.filter(img => img.startsWith("http"));

    try {
        let newImageUrls = [];

        if (newFiles.length > 0) {
            newImageUrls = await uploadImages(newFiles);
        }

        const updatedImages = [...alreadyUploadedImages, ...newImageUrls];
        
        // Get editor name
        const editedBy = currentUserData?.fullName || auth.currentUser?.email || 'Unknown';

        await updateDoc(doc(db, "announcements", currentEditId), {
            title: newTitle || null,
            text: newText,
            images: updatedImages.length > 0 ? updatedImages : null,
            editedAt: new Date().toISOString(),
            editedBy: editedBy,
            editedById: auth.currentUser?.uid || null
        });
        
        // Log activity
        await logActivity('announcement_updated', {
            announcementId: currentEditId,
            title: newTitle || 'No title',
            textPreview: newText.substring(0, 50) + '...',
            imageCount: updatedImages.length,
            editedBy: editedBy
        });
        
        // Log document history
        await logDocumentHistory(currentEditId, 'announcement_updated', {
            title: newTitle,
            textPreview: newText.substring(0, 100),
            imageCount: updatedImages.length,
            editedBy: editedBy
        });

        alert("✅ Announcement updated successfully!");
        editModal.classList.remove("show");
        location.reload();
    } catch (error) {
        console.error("Error updating announcement:", error);
        alert("❌ Failed to update announcement.");
    }
});