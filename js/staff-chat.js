import { db, auth } from "../firebase-config.js";
import { 
    collection, 
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    updateDoc,
    addDoc,
    serverTimestamp,
    getDoc,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// Global variables
let currentFilter = 'waiting';
let selectedChatId = null;
let currentUser = null;
let allChats = [];
let unsubscribeMessages = null;
let currentUserRole = null;
let currentChatData = null;
let isSendingMessage = false; // Prevent duplicate sends
let allStaff = []; // Store all staff members

// Check authentication and authorization
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../index.html";
        return;
    }

    try {
        // Check if user is staff or captain
        const staffRef = doc(db, "staff", user.email);
        const staffSnap = await getDoc(staffRef);

        const adminRef = doc(db, "config", "admin");
        const adminSnap = await getDoc(adminRef);

        const isStaff = staffSnap.exists();
        const isCaptain = adminSnap.exists() && adminSnap.data().email === user.email;

        if (!isStaff && !isCaptain) {
            alert("Unauthorized access. Staff/Captain only.");
            await signOut(auth);
            window.location.href = "../index.html";
            return;
        }

        currentUser = user;
        currentUserRole = isCaptain ? 'captain' : 'staff';
        
        // Setup back button based on role
        const backButton = document.getElementById("back-button");
        
        if (isStaff) {
            const staffData = staffSnap.data();
            document.getElementById("staff-name").textContent = 
                `Logged in as: ${staffData.firstName} ${staffData.lastName} (Staff)`;
            backButton.href = "dashboard-staff.html";
            backButton.textContent = "← Back to Staff Dashboard";
        } else if (isCaptain) {
            document.getElementById("staff-name").textContent = 
                `Logged in as: ${user.email} (Captain)`;
            backButton.href = "dashboard-captain.html";
            backButton.textContent = "← Back to Captain Dashboard";
        }

        // Load all staff for transfer dropdown
        await loadAllStaff();

        // Initialize dashboard
        initializeDashboard();

    } catch (error) {
        console.error("Error checking authorization:", error);
        alert("Error verifying access.");
        await signOut(auth);
        window.location.href = "../index.html";
    }
});

// Load all staff members
async function loadAllStaff() {
    try {
        const staffSnapshot = await getDocs(collection(db, "staff"));
        allStaff = [];
        
        staffSnapshot.forEach((doc) => {
            const staffData = doc.data();
            allStaff.push({
                email: doc.id,
                firstName: staffData.firstName,
                lastName: staffData.lastName,
                fullName: `${staffData.firstName} ${staffData.lastName}`
            });
        });

        // Also add captain
        const adminSnap = await getDoc(doc(db, "config", "admin"));
        if (adminSnap.exists()) {
            const adminEmail = adminSnap.data().email;
            allStaff.push({
                email: adminEmail,
                firstName: "Captain",
                lastName: "",
                fullName: `Captain (${adminEmail})`
            });
        }
    } catch (error) {
        console.error("Error loading staff:", error);
    }
}

// Logout handler
document.getElementById("logout-btn").addEventListener("click", async () => {
    if (confirm("Are you sure you want to logout?")) {
        await signOut(auth);
        window.location.href = "../index.html";
    }
});

// Initialize dashboard
function initializeDashboard() {
    setupEventListeners();
    loadChats();
}

// Setup event listeners
function setupEventListeners() {
    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderChatList();
        });
    });

    // Search
    document.getElementById('search-chats').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        renderChatList(searchTerm);
    });

    // Send message
    document.getElementById('send-message-btn').addEventListener('click', sendMessage);
    
    // Message input - Enter to send, Shift+Enter for new line
    document.getElementById('message-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    document.getElementById('message-input').addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Take over chat
    document.getElementById('take-over-btn').addEventListener('click', takeOverChat);

    // Transfer chat
    document.getElementById('transfer-chat-btn').addEventListener('click', showTransferModal);

    // Resolve chat
    document.getElementById('resolve-chat-btn').addEventListener('click', resolveChat);

    // Delete chat
    document.getElementById('delete-chat-btn').addEventListener('click', deleteChat);
}

// Load all chats with real-time updates
function loadChats() {
    const chatsQuery = query(
        collection(db, "chats"),
        orderBy("createdAt", "desc")
    );

    onSnapshot(chatsQuery, (snapshot) => {
        allChats = [];
        
        snapshot.forEach((doc) => {
            const chatData = doc.data();
            allChats.push({
                id: doc.id,
                ...chatData
            });
        });

        updateStatistics();
        renderChatList();
        
        // Check for pending transfer requests
        checkPendingTransfers();
    });
}

// Check for pending transfer requests
function checkPendingTransfers() {
    const pendingTransfers = allChats.filter(chat => 
        chat.pendingTransferTo === currentUser.email && 
        chat.transferStatus === 'pending'
    );

    if (pendingTransfers.length > 0) {
        showTransferNotification(pendingTransfers[0]);
    }
}

// Show transfer notification
function showTransferNotification(chat) {
    const notification = document.getElementById('transfer-notification');
    if (!notification) {
        // Create notification element if it doesn't exist
        const notifDiv = document.createElement('div');
        notifDiv.id = 'transfer-notification';
        notifDiv.className = 'transfer-notification';
        notifDiv.innerHTML = `
            <div class="notification-content">
                <p><strong>🔔 Transfer Request</strong></p>
                <p>${chat.pendingTransferFrom} wants to transfer a chat from ${chat.residentEmail} to you.</p>
                <div class="notification-actions">
                    <button class="btn btn-success btn-sm" onclick="acceptTransfer('${chat.id}')">✓ Accept</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectTransfer('${chat.id}')">✗ Reject</button>
                </div>
            </div>
        `;
        document.body.appendChild(notifDiv);
    }
}

// Accept transfer
window.acceptTransfer = async function(chatId) {
    try {
        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        
        if (!chatSnap.exists()) return;
        
        const chatData = chatSnap.data();
        
        await updateDoc(chatRef, {
            takenOverBy: currentUser.email,
            transferredAt: serverTimestamp(),
            transferredFrom: chatData.pendingTransferFrom,
            transferStatus: 'accepted',
            pendingTransferTo: null,
            pendingTransferFrom: null
        });

        // Add system message
        await addDoc(collection(db, "chats", chatId, "messages"), {
            message: `🔄 ${currentUser.email} accepted the chat transfer.`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        // Remove notification
        const notification = document.getElementById('transfer-notification');
        if (notification) notification.remove();

        alert("Transfer accepted! You can now handle this chat.");
        
    } catch (error) {
        console.error("Error accepting transfer:", error);
        alert("Failed to accept transfer.");
    }
};

// Reject transfer
window.rejectTransfer = async function(chatId) {
    try {
        await updateDoc(doc(db, "chats", chatId), {
            transferStatus: 'rejected',
            pendingTransferTo: null,
            pendingTransferFrom: null
        });

        // Add system message
        await addDoc(collection(db, "chats", chatId, "messages"), {
            message: `❌ ${currentUser.email} rejected the chat transfer.`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        // Remove notification
        const notification = document.getElementById('transfer-notification');
        if (notification) notification.remove();

        alert("Transfer rejected.");
        
    } catch (error) {
        console.error("Error rejecting transfer:", error);
        alert("Failed to reject transfer.");
    }
};

// Update statistics
function updateStatistics() {
    const counts = {
        waiting: 0,
        active: 0,
        bot: 0,
        resolved: 0 // Changed from 'closed' to 'resolved'
    };

    allChats.forEach(chat => {
        // Also count 'closed' as 'resolved' for backwards compatibility
        if (chat.status === 'closed' || chat.status === 'resolved') {
            counts.resolved++;
        } else if (counts.hasOwnProperty(chat.status)) {
            counts[chat.status]++;
        }
    });

    document.getElementById('waiting-count').textContent = counts.waiting;
    document.getElementById('active-count').textContent = counts.active;
    document.getElementById('bot-count').textContent = counts.bot;
    document.getElementById('closed-count').textContent = counts.resolved; // Update display

    document.getElementById('tab-waiting').textContent = counts.waiting;
    document.getElementById('tab-active').textContent = counts.active;
    document.getElementById('tab-bot').textContent = counts.bot;
    document.getElementById('tab-closed').textContent = counts.resolved; // Update display
}


// Render chat list
function renderChatList(searchTerm = '') {
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';

    // Filter chats
    let filteredChats = allChats.filter(chat => {
        // Handle 'closed' filter to show both 'closed' and 'resolved'
        if (currentFilter === 'closed') {
            if (chat.status !== 'closed' && chat.status !== 'resolved') {
                return false;
            }
        } else if (currentFilter !== 'all' && chat.status !== currentFilter) {
            return false;
        }

        if (searchTerm) {
            const name = (chat.residentName || '').toLowerCase();
            const email = (chat.residentEmail || '').toLowerCase();
            return name.includes(searchTerm) || email.includes(searchTerm);
        }

        return true;
    });

    if (filteredChats.length === 0) {
        chatList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: #a0aec0;">
                <div style="font-size: 48px; margin-bottom: 10px;">💬</div>
                <p>No chats found</p>
            </div>
        `;
        return;
    }

    filteredChats.forEach(chat => {
        const chatItem = createChatItem(chat);
        chatList.appendChild(chatItem);
    });
}

// Create chat item element
function createChatItem(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.setAttribute('data-chat-id', chat.id);
    
    if (chat.id === selectedChatId) {
        div.classList.add('active');
    }
    
    if (chat.unreadStaff) {
        div.classList.add('unread');
    }

    const time = formatTime(chat.createdAt);
    const lastMsg = chat.lastMessage?.text || 'No messages yet';
    const preview = lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg;
    
    // Show 'resolved' for both 'closed' and 'resolved' status
    const displayStatus = (chat.status === 'closed' || chat.status === 'resolved') ? 'resolved' : chat.status;

    div.innerHTML = `
        <div class="chat-item-header">
            <span class="resident-name">${chat.residentName || chat.residentEmail}</span>
            <span class="chat-time">${time}</span>
        </div>
        <div class="chat-preview">${preview}</div>
        <div class="chat-meta">
            <span class="status-badge ${displayStatus}">${displayStatus.toUpperCase()}</span>
            ${chat.unreadStaff ? '<span class="unread-badge">NEW</span>' : ''}
        </div>
    `;

    div.addEventListener('click', () => {
        selectChat(chat.id);
    });

    return div;
}

// Select a chat
function selectChat(chatId) {
    selectedChatId = chatId;
    
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const selectedItem = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
    }
    
    loadChatConversation(chatId);
}

// Load chat conversation
async function loadChatConversation(chatId) {
    try {
        const chatDoc = await getDoc(doc(db, "chats", chatId));
        
        if (!chatDoc.exists()) return;

        const chatData = chatDoc.data();
        currentChatData = chatData;

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('chat-area').style.display = 'flex';

        document.getElementById('resident-name').textContent = 
            chatData.residentName || chatData.residentEmail;
        document.getElementById('resident-email').textContent = chatData.residentEmail;

        const statusBadge = document.getElementById('chat-status-badge');
        const displayStatus = (chatData.status === 'closed' || chatData.status === 'resolved') ? 'resolved' : chatData.status;
        statusBadge.className = `status-badge ${displayStatus}`;
        statusBadge.textContent = displayStatus.toUpperCase();

        const takeOverBtn = document.getElementById('take-over-btn');
        const transferBtn = document.getElementById('transfer-chat-btn');
        const resolveBtn = document.getElementById('resolve-chat-btn');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-message-btn');
        const deleteBtn = document.getElementById('delete-chat-btn');

        const isOwner = chatData.takenOverBy === currentUser.email;
        const isCaptain = currentUserRole === 'captain';
        const isResolved = chatData.status === 'resolved' || chatData.status === 'closed';

        if (chatData.status === 'waiting') {
            takeOverBtn.style.display = 'block';
            transferBtn.style.display = 'none';
            resolveBtn.style.display = 'none';
            messageInput.disabled = true;
            messageInput.placeholder = "Take over this chat to start responding...";
            sendBtn.disabled = true;
            
        } else if (chatData.status === 'active') {
            takeOverBtn.style.display = 'none';
            
            if (isOwner || isCaptain) {
                transferBtn.style.display = 'block';
                resolveBtn.style.display = 'block';
                messageInput.disabled = false;
                messageInput.placeholder = "Type your message...";
                sendBtn.disabled = false;
            } else {
                transferBtn.style.display = 'block';
                resolveBtn.style.display = 'none';
                messageInput.disabled = true;
                messageInput.placeholder = `This chat is handled by ${chatData.takenOverBy}. You can request a transfer.`;
                sendBtn.disabled = true;
            }
            
        } else if (chatData.status === 'bot') {
            takeOverBtn.style.display = 'none';
            transferBtn.style.display = 'none';
            resolveBtn.style.display = 'none';
            messageInput.disabled = true;
            messageInput.placeholder = "This chat is being handled by the bot...";
            sendBtn.disabled = true;
            
        } else if (isResolved) {
            // Resolved chats
            takeOverBtn.style.display = 'none';
            transferBtn.style.display = 'none';
            
            // Only captain or original owner can reopen
            if (isCaptain || isOwner) {
                resolveBtn.style.display = 'block';
                resolveBtn.textContent = '🔄 Reopen Chat';
                resolveBtn.className = 'btn btn-warning';
            } else {
                resolveBtn.style.display = 'none';
            }
            
            messageInput.disabled = true;
            messageInput.placeholder = "This chat is resolved.";
            sendBtn.disabled = true;
        }

        if (deleteBtn && isCaptain) {
            deleteBtn.style.display = isResolved ? 'block' : 'none';
        }

        const chatOwnerInfo = document.getElementById('chat-owner-info');
        if (chatData.status === 'active' && chatData.takenOverBy) {
            chatOwnerInfo.style.display = 'block';
            chatOwnerInfo.textContent = `Handled by: ${chatData.takenOverBy}`;
        } else if (isResolved && chatData.resolvedBy) {
            chatOwnerInfo.style.display = 'block';
            chatOwnerInfo.textContent = `Resolved by: ${chatData.resolvedBy} on ${chatData.resolvedAt ? new Date(chatData.resolvedAt.seconds * 1000).toLocaleString() : 'recently'}`;
        } else {
            chatOwnerInfo.style.display = 'none';
        }

        if (chatData.unreadStaff) {
            await updateDoc(doc(db, "chats", chatId), {
                unreadStaff: false
            });
        }

        loadMessages(chatId);

    } catch (error) {
        console.error("Error loading chat:", error);
    }
}

// Load messages with real-time updates
function loadMessages(chatId) {
    if (unsubscribeMessages) {
        unsubscribeMessages();
    }

    const messagesQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("timestamp", "asc")
    );

    unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        const messagesArea = document.getElementById('messages-area');
        messagesArea.innerHTML = '';

        snapshot.forEach((doc) => {
            const message = doc.data();
            const messageEl = createMessageElement(message);
            messagesArea.appendChild(messageEl);
        });

        messagesArea.scrollTop = messagesArea.scrollHeight;
    });
}

// Create message element
function createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `message ${message.sender}`;

    const time = message.timestamp ? 
        new Date(message.timestamp.seconds * 1000).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        }) : 'Just now';

    let avatar = '🤖';
    let label = 'Bot';
    
    if (message.sender === 'user') {
        avatar = '👤';
        label = 'Resident';
    } else if (message.sender === 'staff') {
        avatar = '👨‍💼';
        label = 'Staff';
    } else if (message.sender === 'system') {
        avatar = '⚙️';
        label = 'System';
    }

    // ✅ FIX: Only escape USER messages for security
    // Bot, staff, and system messages should render HTML properly
    let formattedMessage;
    if (message.sender === 'user') {
        // Escape user input for security, then replace newlines
        formattedMessage = escapeHtml(message.message).replace(/\n/g, '<br>');
    } else {
        // Don't escape bot/staff/system messages - they may contain intentional HTML/formatting
        formattedMessage = message.message.replace(/\n/g, '<br>');
    }

    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            <div class="message-bubble">${formattedMessage}</div>
            <div class="message-time">${label} • ${time}</div>
        </div>
    `;

    return div;
}

// Send message with debouncing
async function sendMessage() {
    if (!selectedChatId || !currentChatData) return;

    // PREVENT DUPLICATE SENDS
    if (isSendingMessage) {
        console.log("Already sending a message, please wait...");
        return;
    }

    const isOwner = currentChatData.takenOverBy === currentUser.email;
    const isCaptain = currentUserRole === 'captain';
    
    if (currentChatData.status !== 'active') {
        alert("You must take over this chat first!");
        return;
    }
    
    if (!isOwner && !isCaptain) {
        alert("You cannot send messages in this chat.");
        return;
    }

    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message) return;

    try {
        isSendingMessage = true; // Lock sending
        const sendBtn = document.getElementById('send-message-btn');
        sendBtn.disabled = true;

        // Clear input immediately to prevent re-sends
        input.value = '';
        input.style.height = 'auto';

        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
            message: message,
            sender: "staff",
            timestamp: serverTimestamp()
        });

        await updateDoc(doc(db, "chats", selectedChatId), {
            lastMessage: {
                text: message,
                sender: "staff",
                timestamp: serverTimestamp()
            },
            unreadResident: true
        });

        // Wait 500ms before allowing next send
        setTimeout(() => {
            isSendingMessage = false;
            sendBtn.disabled = false;
        }, 500);

    } catch (error) {
        console.error("Error sending message:", error);
        alert("Failed to send message.");
        isSendingMessage = false;
    }
}

// Take over chat
async function takeOverChat() {
    if (!selectedChatId) return;

    try {
        await updateDoc(doc(db, "chats", selectedChatId), {
            status: "active",
            takenOverAt: serverTimestamp(),
            takenOverBy: currentUser.email
        });

        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
            message: `👨‍💼 ${currentUser.email} has taken over this chat.`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        alert("You have taken over this chat!");
        loadChatConversation(selectedChatId);

    } catch (error) {
        console.error("Error taking over chat:", error);
        alert("Failed to take over chat.");
    }
}

// Show transfer modal with staff list
function showTransferModal() {
    if (!selectedChatId || !currentChatData) return;

    const isOwner = currentChatData.takenOverBy === currentUser.email;
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'transfer-modal';
    modal.id = 'transfer-modal';
    
    let staffOptions = '';
    allStaff.forEach(staff => {
        if (staff.email !== currentUser.email) {
            staffOptions += `<option value="${staff.email}">${staff.fullName}</option>`;
        }
    });

    modal.innerHTML = `
        <div class="modal-content">
            <h3>🔄 Transfer Chat</h3>
            <p>${isOwner ? 'Select a staff member to transfer this chat to:' : 'Request to take over this chat from ' + currentChatData.takenOverBy + '?'}</p>
            ${isOwner ? `
                <select id="transfer-staff-select" class="transfer-select">
                    <option value="">-- Select Staff --</option>
                    ${staffOptions}
                </select>
            ` : ''}
            <div class="modal-actions">
                ${isOwner ? 
                    '<button class="btn btn-primary" onclick="confirmTransfer()">Send Request</button>' :
                    '<button class="btn btn-primary" onclick="requestTakeover()">Request Takeover</button>'
                }
                <button class="btn btn-secondary" onclick="closeTransferModal()">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Close transfer modal
window.closeTransferModal = function() {
    const modal = document.getElementById('transfer-modal');
    if (modal) modal.remove();
};

// Confirm transfer
window.confirmTransfer = async function() {
    const select = document.getElementById('transfer-staff-select');
    const transferTo = select.value;
    
    if (!transferTo) {
        alert("Please select a staff member.");
        return;
    }

    try {
        await updateDoc(doc(db, "chats", selectedChatId), {
            pendingTransferTo: transferTo,
            pendingTransferFrom: currentUser.email,
            transferStatus: 'pending',
            transferRequestedAt: serverTimestamp()
        });

        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
            message: `🔄 ${currentUser.email} requested to transfer this chat to ${transferTo}.`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        alert(`Transfer request sent to ${transferTo}!`);
        closeTransferModal();

    } catch (error) {
        console.error("Error requesting transfer:", error);
        alert("Failed to send transfer request.");
    }
};

// Request takeover (non-owner)
window.requestTakeover = async function() {
    try {
        await updateDoc(doc(db, "chats", selectedChatId), {
            pendingTransferTo: currentUser.email,
            pendingTransferFrom: currentChatData.takenOverBy,
            transferStatus: 'pending',
            transferRequestedAt: serverTimestamp()
        });

        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
            message: `🔄 ${currentUser.email} requested to take over this chat from ${currentChatData.takenOverBy}.`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        alert("Takeover request sent!");
        closeTransferModal();

    } catch (error) {
        console.error("Error requesting takeover:", error);
        alert("Failed to send request.");
    }
};

// Resolve chat
async function resolveChat() {
    if (!selectedChatId || !currentChatData) return;

    const isResolved = currentChatData.status === 'resolved' || currentChatData.status === 'closed';
    
    // If already resolved, reopen it
    if (isResolved) {
        if (!confirm("Reopen this resolved chat?")) return;
        
        try {
            await updateDoc(doc(db, "chats", selectedChatId), {
                status: "active",
                reopenedAt: serverTimestamp(),
                reopenedBy: currentUser.email,
                resolvedAt: null,
                resolvedBy: null,
                resolutionNote: null
            });

            await addDoc(collection(db, "chats", selectedChatId, "messages"), {
                message: `🔄 Chat reopened by ${currentUser.email}`,
                sender: "system",
                timestamp: serverTimestamp()
            });

            alert("Chat has been reopened!");
            loadChatConversation(selectedChatId);

        } catch (error) {
            console.error("Error reopening chat:", error);
            alert("Failed to reopen chat.");
        }
        return;
    }

    // Otherwise, resolve the chat
    const resolutionNote = prompt(
        "Add a resolution note (this will be visible to the resident):",
        "Your issue has been resolved. Thank you for contacting us!"
    );

    if (resolutionNote === null) return; // User cancelled

    try {
        const chatRef = doc(db, "chats", selectedChatId);
        
        await updateDoc(chatRef, {
            status: "resolved",
            resolvedAt: serverTimestamp(),
            resolvedBy: currentUser.email,
            resolutionNote: resolutionNote || "Chat resolved by staff",
            unreadStaff: false
        });

        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
            message: `✅ Chat marked as resolved by ${currentUser.email}\n\nResolution: ${resolutionNote}`,
            sender: "system",
            timestamp: serverTimestamp()
        });

        alert("✅ Chat has been marked as resolved!");

        // Refresh the conversation to show new state
        loadChatConversation(selectedChatId);

    } catch (error) {
        console.error("Error resolving chat:", error);
        alert("Failed to resolve chat.");
    }
}

// Delete chat
async function deleteChat() {
    if (!selectedChatId || currentUserRole !== 'captain') return;

    if (!confirm("⚠️ Delete this chat permanently?")) return;

    try {
        const messagesQuery = query(collection(db, "chats", selectedChatId, "messages"));
        const messagesSnapshot = await getDocs(messagesQuery);
        
        await Promise.all(messagesSnapshot.docs.map(msgDoc => 
            deleteDoc(doc(db, "chats", selectedChatId, "messages", msgDoc.id))
        ));

        await deleteDoc(doc(db, "chats", selectedChatId));

        alert("Chat deleted successfully!");

        selectedChatId = null;
        currentChatData = null;
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('chat-area').style.display = 'none';

    } catch (error) {
        console.error("Error deleting chat:", error);
        alert("Failed to delete chat.");
    }
}

// Format timestamp
function formatTime(timestamp) {
    if (!timestamp) return 'Just now';
    
    const date = timestamp.seconds ? 
        new Date(timestamp.seconds * 1000) : 
        new Date(timestamp);
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
