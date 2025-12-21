import { db, auth } from "../firebase-config.js";
import { 
    collection, 
    addDoc, 
    updateDoc,
    doc,
    serverTimestamp,
    onSnapshot,
    query,
    where,
    orderBy,
    getDoc,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// Global variables
let chatSession = null;
let currentUser = null;
let isTyping = false;
let messagesListener = null; // Store the listener reference
let hasLoadedHistory = false; // Track if we've loaded history
let chatTransferredToStaff = false;

// Initialize chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeChatbot();
    createChatSession(); // Create session immediately
});

let chatStatusListener = null; // Listen to chat status changes

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await createChatSession();
        
        // Check if chat is already with staff
        const status = await checkChatStatus();
        if (status === 'waiting' || status === 'active') {
            chatTransferredToStaff = true;
            hasLoadedHistory = true;
            listenForStaffResponses();
        }
        
        // ✅ NEW: Listen for status changes (resolved)
        listenForChatStatusChanges();
        
        // Load history first
        await loadChatHistory();
        
        // Show welcome message ONLY if appropriate
        setTimeout(() => {
            showInitialWelcome();
        }, 500);
    }
});

function initializeChatbot() {
    const chatButton = document.getElementById('chat-button');
    const chatWindow = document.getElementById('chat-window');
    const minimizeBtn = document.getElementById('minimize-chat');
    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');

    // Auto-scroll when new messages are added
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                // New message added, scroll to bottom
                scrollToBottom();
            }
        });
    });

    // Toggle chat window
    chatButton.addEventListener('click', () => {
        chatWindow.classList.toggle('open');
        chatButton.classList.toggle('active');
        
        if (chatWindow.classList.contains('open')) {
            chatInput.focus();
            hideNotificationBadge();
            
            //Scroll to bottom when opening chat
            setTimeout(() => {
                scrollToBottom();
            }, 100); // Small delay to ensure DOM is ready
        }
    });

    // Minimize chat
    minimizeBtn.addEventListener('click', () => {
        chatWindow.classList.remove('open');
        chatButton.classList.remove('active');
    });

    // Send message on button click
    sendBtn.addEventListener('click', () => {
        sendMessage();
    });

    // Send message on Enter key
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function showInitialWelcome() {
    // Only show if no history loaded AND not transferred to staff
    if (!hasLoadedHistory && !chatTransferredToStaff) {
        addBotMessage("👋 Hello! I'm your Barangay assistant. How can I help you today?", true);
    }
}


// Send user message
function sendMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();

    if (!message) return;

    // Add user message to chat
    addUserMessage(message);
    chatInput.value = '';

    // Save to Firebase
    saveMessageToFirebase(message, 'user');

    // Process message and get bot response
    setTimeout(() => {
        processUserMessage(message);
    }, 500);
}

// Add user message to chat UI
function addUserMessage(message) {
    const chatBody = document.getElementById('chat-body');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';
    
    const time = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-bubble">${escapeHtml(message)}</div>
            <div class="message-time">${time}</div>
        </div>
        <div class="message-avatar">👤</div>
    `;

    chatBody.appendChild(messageDiv);
    scrollToBottom();
}

// Add bot message to chat UI
function addBotMessage(message, showQuickActions = false, skipSave = false) {
    const chatBody = document.getElementById('chat-body');
    
    showTypingIndicator();

    setTimeout(() => {
        hideTypingIndicator();

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot';
        
        const time = new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        let quickActionsHtml = '';
        if (showQuickActions) {
            quickActionsHtml = `
                <div class="quick-actions">
                    <button class="quick-action-btn" onclick="handleQuickAction('documents')">📄 Request Document</button>
                    <button class="quick-action-btn" onclick="handleQuickAction('incident')">🚨 Report Incident</button>
                    <button class="quick-action-btn" onclick="handleQuickAction('hours')">🕐 Office Hours</button>
                    <button class="quick-action-btn" onclick="handleQuickAction('contact')">📞 Contact Info</button>
                </div>
            `;
        }

        // ✅ FIX: Don't escape bot messages - they contain intentional HTML
        // Just replace newlines with <br> tags
        const formattedMessage = message.replace(/\n/g, '<br>');

        messageDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="message-bubble">${formattedMessage}</div>
                <div class="message-time">${time}</div>
                ${quickActionsHtml}
            </div>
        `;

        chatBody.appendChild(messageDiv);
        scrollToBottom();

        if (!skipSave) {
            saveMessageToFirebase(message, 'bot');
        }
    }, 1000);
}

// Show typing indicator
function showTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    indicator.classList.add('show');
    scrollToBottom();
}

// Hide typing indicator
function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    indicator.classList.remove('show');
}

// Process user message with rule-based responses
function processUserMessage(message) {
    const lowerMessage = message.toLowerCase();

    if (chatTransferredToStaff) {
        console.log("Chat transferred to staff - no bot response");
        return; // Don't send bot response, staff will reply
    }

    // Check if chat is transferred to staff - stop auto-responses
    if (chatSession) {
        checkChatStatus().then(status => {
            if (status === 'waiting' || status === 'active') {
                // Chat is with staff, don't send bot response
                return;
            }
        });
    }

    // Document requests - General
    if (lowerMessage.includes('document') || lowerMessage.includes('request document')) {
        addBotMessage(
            "📄 <strong>Document Request Process</strong>\n\n" +
            "<strong>Available Documents:</strong>\n" +
            "• Barangay Clearance\n" +
            "• Certificate of Residency\n" +
            "• Indigency Certificate\n" +
            "• Barangay ID\n" +
            "• Others (specify)\n\n" +
            "<strong>How to Request:</strong>\n" +
            "1. Click 'Request Document' on your dashboard\n" +
            "2. Select document type\n" +
            "3. Enter reason/purpose\n" +
            "4. Submit request\n\n" +
            "<strong>Processing Time:</strong> 3-5 business days\n" +
            "<strong>Status:</strong> Check 'My Document Requests'\n\n" +
            "Need specific document info? Ask me!"
        );
        return;
    }

    // Barangay Clearance
    if (lowerMessage.includes('clearance') || lowerMessage.includes('barangay clearance')) {
        addBotMessage(
            "📋 <strong>Barangay Clearance</strong>\n\n" +
            "<strong>Purpose:</strong> Proof of residency and good moral character\n\n" +
            "<strong>Common Uses:</strong>\n" +
            "• Employment requirements\n" +
            "• Business permits\n" +
            "• Police clearance\n" +
            "• School enrollment\n\n" +
            "<strong>Requirements:</strong>\n" +
            "• Valid ID\n" +
            "• Proof of residency\n\n" +
            "<strong>Fee:</strong> ₱50\n" +
            "<strong>Processing:</strong> 3-5 business days\n\n" +
            "Ready to request? Go to Document Requests!"
        );
        return;
    }

    // Certificate of Residency
    if (lowerMessage.includes('residency') || lowerMessage.includes('certificate of residency')) {
        addBotMessage(
            "🏠 <strong>Certificate of Residency</strong>\n\n" +
            "<strong>Purpose:</strong> Proof that you reside in the barangay\n\n" +
            "<strong>Common Uses:</strong>\n" +
            "• School requirements\n" +
            "• Government transactions\n" +
            "• Utility applications\n\n" +
            "<strong>Requirements:</strong>\n" +
            "• Valid ID\n" +
            "• Proof of address\n\n" +
            "<strong>Fee:</strong> ₱30\n" +
            "<strong>Processing:</strong> 3 business days\n\n" +
            "Request now from your dashboard!"
        );
        return;
    }

    // Indigency Certificate
    if (lowerMessage.includes('indigency') || lowerMessage.includes('indigency certificate')) {
        addBotMessage(
            "💰 <strong>Indigency Certificate</strong>\n\n" +
            "<strong>Purpose:</strong> Financial assistance qualification\n\n" +
            "<strong>Common Uses:</strong>\n" +
            "• Medical assistance\n" +
            "• Legal aid\n" +
            "• Scholarship applications\n" +
            "• Burial assistance\n\n" +
            "<strong>Requirements:</strong>\n" +
            "• Valid ID\n" +
            "• Proof of residency\n" +
            "• Income proof (if applicable)\n\n" +
            "<strong>Fee:</strong> FREE\n" +
            "<strong>Processing:</strong> 2-3 business days\n\n" +
            "Submit your request today!"
        );
        return;
    }

    // Barangay ID
    if (lowerMessage.includes('barangay id') || lowerMessage.includes(' id ') || lowerMessage === 'id') {
        addBotMessage(
            "🪪 <strong>Barangay ID</strong>\n\n" +
            "<strong>Purpose:</strong> Official barangay identification\n\n" +
            "<strong>Benefits:</strong>\n" +
            "• Valid government ID\n" +
            "• Access to barangay services\n" +
            "• Senior citizen/PWD discounts\n\n" +
            "<strong>Requirements:</strong>\n" +
            "• 1x1 ID picture\n" +
            "• Proof of residency\n" +
            "• Birth certificate (for minors)\n\n" +
            "<strong>Fee:</strong> ₱100\n" +
            "<strong>Processing:</strong> 5-7 business days\n\n" +
            "Request from Document Requests!"
        );
        return;
    }

    // Incident reports - General
    if (lowerMessage.includes('incident') || lowerMessage.includes('report incident')) {
        addBotMessage(
            "🚨 <strong>Incident Reporting</strong>\n\n" +
            "<strong>Report Types:</strong>\n" +
            "• Noise Complaint\n" +
            "• Neighborhood Dispute\n" +
            "• Vandalism\n" +
            "• Theft\n" +
            "• Public Safety Issues\n" +
            "• Infrastructure Problems\n\n" +
            "<strong>How to Report:</strong>\n" +
            "1. Go to 'Incident Reports'\n" +
            "2. Select incident type\n" +
            "3. Describe what happened\n" +
            "4. Add location & date\n" +
            "5. Upload photos (optional)\n" +
            "6. Submit report\n\n" +
            "<strong>Status Updates:</strong> Check 'My Reports' tab\n\n" +
            "🆘 <strong>Emergency? Call 911 immediately!</strong>"
        );
        return;
    }

    // Noise complaint
    if (lowerMessage.includes('noise') || lowerMessage.includes('loud')) {
        addBotMessage(
            "🔊 <strong>Noise Complaint</strong>\n\n" +
            "Report excessive noise disturbances:\n" +
            "• Loud music/parties\n" +
            "• Construction noise\n" +
            "• Barking dogs\n" +
            "• Other disturbances\n\n" +
            "<strong>What to include:</strong>\n" +
            "• Exact location\n" +
            "• Time of occurrence\n" +
            "• Type of noise\n" +
            "• Frequency\n\n" +
            "Submit via Incident Reports. Staff will investigate!"
        );
        return;
    }

    // Profile/Account
    if (lowerMessage.includes('profile') || lowerMessage.includes('account') || 
        lowerMessage.includes('edit profile') || lowerMessage.includes('update info')) {
        addBotMessage(
            "👤 <strong>Profile Management</strong>\n\n" +
            "<strong>You can update:</strong>\n" +
            "• Contact number\n" +
            "• Address\n" +
            "• Occupation\n" +
            "• Education\n" +
            "• Special categories (Senior, PWD, 4Ps)\n\n" +
            "<strong>How to Edit:</strong>\n" +
            "1. Go to Profile\n" +
            "2. Click 'Edit Profile'\n" +
            "3. Update information\n" +
            "4. Save changes\n\n" +
            "<strong>Note:</strong> Name and email changes require staff verification."
        );
        return;
    }

    // Password
    if (lowerMessage.includes('password') || lowerMessage.includes('change password')) {
        addBotMessage(
            "🔐 <strong>Change Password</strong>\n\n" +
            "<strong>Steps:</strong>\n" +
            "1. Go to your Profile\n" +
            "2. Enter current password\n" +
            "3. Enter new password\n" +
            "4. Confirm new password\n" +
            "5. Save changes\n\n" +
            "<strong>Password Requirements:</strong>\n" +
            "• Minimum 6 characters\n" +
            "• Keep it secure!\n\n" +
            "<strong>Forgot password?</strong> Contact staff for reset."
        );
        return;
    }

    // Fees/Payment
    if (lowerMessage.includes('fee') || lowerMessage.includes('cost') || 
        lowerMessage.includes('payment') || lowerMessage.includes('how much') || 
        lowerMessage.includes('price')) {
        addBotMessage(
            "💵 <strong>Document Fees</strong>\n\n" +
            "📋 Barangay Clearance: ₱50\n" +
            "🏠 Certificate of Residency: ₱30\n" +
            "💰 Indigency Certificate: FREE\n" +
            "🪪 Barangay ID: ₱100\n\n" +
            "<strong>Payment Methods:</strong>\n" +
            "• Cash (at barangay office)\n" +
            "• GCash (ask staff for details)\n\n" +
            "<strong>Payment Upon:</strong>\n" +
            "Document approval and claiming\n\n" +
            "Questions about fees? Talk to staff!"
        );
        return;
    }

    // Office hours
    if (lowerMessage.includes('hour') || lowerMessage.includes('time') || 
        lowerMessage.includes('open') || lowerMessage.includes('schedule') ||
        lowerMessage.includes('what time')) {
        addBotMessage(
            "🕐 <strong>Barangay Office Hours</strong>\n\n" +
            "📅 <strong>Monday - Friday</strong>\n" +
            "8:00 AM - 5:00 PM\n\n" +
            "📅 <strong>Saturday</strong>\n" +
            "8:00 AM - 12:00 PM\n\n" +
            "📅 <strong>Sunday</strong>\n" +
            "Closed\n\n" +
            "🍽️ <strong>Lunch Break</strong>\n" +
            "12:00 PM - 1:00 PM\n\n" +
            "We're here to serve you!"
        );
        return;
    }

    // Contact information
    if (lowerMessage.includes('contact') || lowerMessage.includes('phone') || 
        lowerMessage.includes('email') || lowerMessage.includes('call') || 
        lowerMessage.includes('address') || lowerMessage.includes('location')) {
        addBotMessage(
            "📞 <strong>Contact Information</strong>\n\n" +
            "☎️ Hotline: (123) 456-7890\n" +
            "📧 Email: barangay@lipay.gov.ph\n" +
            "🆘 Emergency: 911\n\n" +
            "📍 <strong>Address:</strong>\n" +
            "Barangay Lipay Hall\n" +
            "Lipay Street, City\n\n" +
            "🕐 <strong>Office Hours:</strong>\n" +
            "Mon-Fri: 8AM-5PM\n" +
            "Sat: 8AM-12PM\n\n" +
            "Visit us or chat with staff anytime!"
        );
        return;
    }

    // Announcements
    if (lowerMessage.includes('announcement') || lowerMessage.includes('news') || 
        lowerMessage.includes('update') || lowerMessage.includes('event')) {
        addBotMessage(
            "📢 <strong>Barangay Announcements</strong>\n\n" +
            "View official announcements on your dashboard!\n\n" +
            "<strong>What you'll find:</strong>\n" +
            "• Community events\n" +
            "• Emergency alerts\n" +
            "• Program updates\n" +
            "• Important notices\n\n" +
            "Check regularly to stay informed!"
        );
        return;
    }

    // Status check
    if (lowerMessage.includes('status') || lowerMessage.includes('track') || 
        lowerMessage.includes('check request') || lowerMessage.includes('my request')) {
        addBotMessage(
            "📊 <strong>Check Status</strong>\n\n" +
            "<strong>Document Requests:</strong>\n" +
            "Go to 'My Document Requests'\n" +
            "• Pending: Under review\n" +
            "• Approved: Ready for claiming\n" +
            "• Rejected: See captain's comment\n\n" +
            "<strong>Incident Reports:</strong>\n" +
            "Go to 'My Reports' tab\n" +
            "• Submitted: Received\n" +
            "• Acknowledged: Staff aware\n" +
            "• In Progress: Being handled\n" +
            "• Resolved: Issue fixed\n\n" +
            "Real-time updates on your dashboard!"
        );
        return;
    }

    // Help or confused
    if (lowerMessage.includes('help') || lowerMessage.includes('assist') || 
        lowerMessage.includes('support') || lowerMessage.length < 5) {
        addBotMessage(
            "👋 I can help you with:\n\n" +
            "📄 Document requests (Clearance, ID, etc.)\n" +
            "🚨 Incident reports\n" +
            "💵 Fees and payments\n" +
            "👤 Profile management\n" +
            "🕐 Office hours\n" +
            "📞 Contact information\n" +
            "📢 Announcements\n\n" +
            "What would you like to know?",
            true
        );
        return;
    }

    // Staff transfer - NO AUTO RESPONSE, just transfer
    if (lowerMessage.includes('staff') || lowerMessage.includes('talk to someone') || 
        lowerMessage.includes('human') || lowerMessage.includes('person') ||
        lowerMessage.includes('talk to staff')) {
        showTransferOption();
        return;
    }

    // Default response for unrecognized queries
    addBotMessage(
        "🤔 I'm not sure about that. I can help you with:\n\n" +
        "📄 Document requests\n" +
        "🚨 Incident reports\n" +
        "💵 Fees and payments\n" +
        "👤 Profile management\n" +
        "🕐 Office hours\n" +
        "📞 Contact info\n\n" +
        "Or would you like to speak with a staff member?",
        true
    );
    showTransferOption();
}

// Handle quick action buttons
window.handleQuickAction = function(action) {
    switch(action) {
        case 'documents':
            sendMessage();
            document.getElementById('chat-input').value = 'How do I request a document?';
            sendMessage();
            break;
        case 'incident':
            document.getElementById('chat-input').value = 'How do I report an incident?';
            sendMessage();
            break;
        case 'hours':
            document.getElementById('chat-input').value = 'What are your office hours?';
            sendMessage();
            break;
        case 'contact':
            document.getElementById('chat-input').value = 'How can I contact you?';
            sendMessage();
            break;
    }
};

// Show transfer to staff option
function showTransferOption() {
    const chatBody = document.getElementById('chat-body');
    
    const transferDiv = document.createElement('div');
    transferDiv.className = 'message bot';
    transferDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
            <div class="transfer-section">
                <p>💬 Need more help? Connect with our staff!</p>
                <button class="transfer-btn" onclick="transferToStaff()">
                    👥 Talk to Staff Member
                </button>
            </div>
        </div>
    `;

    chatBody.appendChild(transferDiv);
    scrollToBottom();
}

// Transfer chat to staff
window.transferToStaff = async function() {
    if (!currentUser || !chatSession) {
        addBotMessage("Please log in to chat with staff members.");
        return;
    }

    try {
        // ✅ Check if there's already an active chat with staff
        const chatDoc = await getDoc(doc(db, "chats", chatSession));
        if (chatDoc.exists()) {
            const currentStatus = chatDoc.data().status;
            
            if (currentStatus === 'waiting' || currentStatus === 'active') {
                addBotMessage("You're already connected with our staff team! A staff member will respond shortly.");
                return;
            }
        }

        const chatRef = doc(db, "chats", chatSession);
        
        await updateDoc(chatRef, {
            status: "waiting",
            transferredAt: serverTimestamp(),
            unreadStaff: true
        });

        chatTransferredToStaff = true;
        hasLoadedHistory = true;

        addBotMessage(
            "✅ <strong>Your chat has been transferred to our staff team!</strong><br><br>" +
            "A staff member will respond shortly. Please wait...<br><br>" +
            "You can continue asking questions, and I'll pass them to the staff."
        );

        listenForStaffResponses();

    } catch (error) {
        console.error("Error transferring chat:", error);
        addBotMessage("Sorry, there was an error connecting to staff. Please try again.");
    }
};

// Listen for staff responses in real-time
function listenForStaffResponses() {
    if (!chatSession) return;

    // Unsubscribe from previous listener if exists
    if (messagesListener) {
        messagesListener();
    }

    // Listen to messages subcollection
    const messagesQuery = query(
        collection(db, "chats", chatSession, "messages"),
        orderBy("timestamp", "asc")
    );
    
    let isFirstLoad = true;
    
    messagesListener = onSnapshot(messagesQuery, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && !isFirstLoad) {
                const message = change.doc.data();
                
                // Only show NEW staff/system messages (not from history)
                if (message.sender === "staff" || message.sender === "system") {
                    const chatBody = document.getElementById('chat-body');
                    const time = message.timestamp ? 
                        new Date(message.timestamp.seconds * 1000).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        }) : 'Just now';

                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message bot';
                    
                    let avatar = '👨‍💼';
                    let label = 'Staff';
                    
                    if (message.sender === 'system') {
                        avatar = '⚙️';
                        label = 'System';
                    }
                    
                    // ✅ FIX: Don't escape staff/system messages - allow HTML
                    const formattedMessage = message.message.replace(/\n/g, '<br>');
                    
                    messageDiv.innerHTML = `
                        <div class="message-avatar">${avatar}</div>
                        <div class="message-content">
                            <div class="message-bubble">${formattedMessage}</div>
                            <div class="message-time">${label} • ${time}</div>
                        </div>
                    `;

                    chatBody.appendChild(messageDiv);
                    scrollToBottom();
                    
                    // Show notification if chat is minimized
                    if (!document.getElementById('chat-window').classList.contains('open')) {
                        showNotificationBadge();
                    }
                }
            }
        });
        
        isFirstLoad = false;
    });
}

// Load chat history when page loads
async function loadChatHistory() {
    if (!chatSession) return;

    try {
        const messagesQuery = query(
            collection(db, "chats", chatSession, "messages"),
            orderBy("timestamp", "asc")
        );

        const messagesSnapshot = await getDocs(messagesQuery);
        const chatBody = document.getElementById('chat-body');
        
        if (messagesSnapshot.empty) {
            hasLoadedHistory = false; // No history = new chat
            return;
        }

        hasLoadedHistory = true; // Has history = don't show welcome

        messagesSnapshot.forEach((doc) => {
            const message = doc.data();
            const time = message.timestamp ? 
                new Date(message.timestamp.seconds * 1000).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }) : 'Just now';

            const messageDiv = document.createElement('div');
            let avatar = '🤖';
            let label = 'Bot';
            let className = 'message bot';

            if (message.sender === 'user') {
                avatar = '👤';
                label = 'You';
                className = 'message user';
            } else if (message.sender === 'staff') {
                avatar = '👨‍💼';
                label = 'Staff';
            } else if (message.sender === 'system') {
                avatar = '⚙️';
                label = 'System';
            }

            messageDiv.className = className;
            
            // ✅ FIX: Only escape USER messages for security
            // Bot, staff, and system messages should render HTML
            let formattedMessage;
            if (message.sender === 'user') {
                formattedMessage = escapeHtml(message.message).replace(/\n/g, '<br>');
            } else {
                // Don't escape - allow HTML rendering for bot/staff/system
                formattedMessage = message.message.replace(/\n/g, '<br>');
            }

            if (message.sender === 'user') {
                messageDiv.innerHTML = `
                    <div class="message-content">
                        <div class="message-bubble">${formattedMessage}</div>
                        <div class="message-time">${time}</div>
                    </div>
                    <div class="message-avatar">${avatar}</div>
                `;
            } else {
                messageDiv.innerHTML = `
                    <div class="message-avatar">${avatar}</div>
                    <div class="message-content">
                        <div class="message-bubble">${formattedMessage}</div>
                        <div class="message-time">${label} • ${time}</div>
                    </div>
                `;
            }

            chatBody.appendChild(messageDiv);
        });

        setTimeout(() => scrollToBottom(), 100);

    } catch (error) {
        console.error("Error loading chat history:", error);
    }
}

// Check current chat status
async function checkChatStatus() {
    if (!chatSession) return 'bot';

    try {
        const chatDoc = await getDoc(doc(db, "chats", chatSession));
        if (chatDoc.exists()) {
            return chatDoc.data().status || 'bot';
        }
    } catch (error) {
        console.error("Error checking chat status:", error);
    }
    return 'bot';
}

// Create chat session at the start
async function createChatSession() {
    if (!currentUser) {
        setTimeout(createChatSession, 1000);
        return;
    }

    try {
        // Check for existing active chats
        const existingSessionQuery = query(
            collection(db, "chats"),
            where("residentId", "==", currentUser.uid),
            where("status", "in", ["bot", "waiting", "active"])
        );
        
        const existingDocs = await getDocs(existingSessionQuery);
        
        if (!existingDocs.empty) {
            chatSession = existingDocs.docs[0].id;
            console.log("Using existing chat session:", chatSession);
        } else {
            // ✅ Get actual resident name from residents collection
            let residentName = "Resident";
            
            try {
                const residentDoc = await getDoc(doc(db, "residents", currentUser.email.toLowerCase()));
                if (residentDoc.exists()) {
                    const userData = residentDoc.data();
                    residentName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 
                                  userData.fullName || 
                                  currentUser.email.split('@')[0];
                }
            } catch (error) {
                console.error("Error fetching resident data:", error);
            }
            
            const chatRef = await addDoc(collection(db, "chats"), {
                residentId: currentUser.uid,
                residentEmail: currentUser.email,
                residentName: residentName,
                status: "bot",
                createdAt: serverTimestamp(),
                lastMessage: null,
                unreadStaff: false
            });
            
            chatSession = chatRef.id;
            console.log("Created new chat session:", chatSession);
        }
    } catch (error) {
        console.error("Error creating chat session:", error);
    }
}

// Save message to Firebase
async function saveMessageToFirebase(message, sender) {
    if (!chatSession || !currentUser) return;

    try {
        const chatRef = doc(db, "chats", chatSession);
        
        // Add message to subcollection
        await addDoc(collection(chatRef, "messages"), {
            message: message,
            sender: sender, // 'user' or 'bot'
            timestamp: serverTimestamp()
        });

        // Update last message in chat document
        await updateDoc(chatRef, {
            lastMessage: {
                text: message,
                sender: sender,
                timestamp: serverTimestamp()
            },
            unreadStaff: sender === "user" ? true : false // Mark as unread if user sent message
        });

    } catch (error) {
        console.error("Error saving message:", error);
    }
}

// Utility functions
function scrollToBottom() {
    const chatBody = document.getElementById('chat-body');
    if (chatBody) {
        // Use smooth scroll for better UX
        chatBody.scrollTo({
            top: chatBody.scrollHeight,
            behavior: 'smooth'
        });
        
        // Fallback for browsers that don't support smooth scroll
        chatBody.scrollTop = chatBody.scrollHeight;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    badge.classList.add('show');
}

function hideNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    badge.classList.remove('show');
}

// ✅ NEW FUNCTION: Listen for chat status changes
function listenForChatStatusChanges() {
    if (!chatSession) return;

    // Unsubscribe from previous listener if exists
    if (chatStatusListener) {
        chatStatusListener();
    }

    const chatRef = doc(db, "chats", chatSession);
    
    chatStatusListener = onSnapshot(chatRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            const status = data.status;

            // ✅ When status changes to "resolved"
            if (status === 'resolved') {
                handleChatResolved(data);
            }
        }
    });
}

// ✅ NEW FUNCTION: Handle when chat is marked as resolved
function handleChatResolved(chatData) {
    const chatBody = document.getElementById('chat-body');
    
    // Stop listening for staff responses
    if (messagesListener) {
        messagesListener();
        messagesListener = null;
    }

    // Reset flags
    chatTransferredToStaff = false;

    // Show resolved message
    const resolvedDiv = document.createElement('div');
    resolvedDiv.className = 'message system-message';
    resolvedDiv.innerHTML = `
        <div class="resolved-notification">
            <div class="resolved-icon">✅</div>
            <div class="resolved-content">
                <h4>Chat Resolved</h4>
                <p>This conversation has been marked as resolved by staff.</p>
                ${chatData.resolutionNote ? `<div class="resolution-note"><strong>Resolution:</strong> ${escapeHtml(chatData.resolutionNote)}</div>` : ''}
                <p class="resolved-time">
                    ${chatData.resolvedAt ? new Date(chatData.resolvedAt.seconds * 1000).toLocaleString() : ''}
                </p>
            </div>
        </div>
        <div class="new-chat-section">
            <p>Need more help?</p>
            <button class="new-chat-btn" onclick="startNewChat()">
                💬 Start New Conversation
            </button>
        </div>
    `;

    chatBody.appendChild(resolvedDiv);
    scrollToBottom();

    // Disable input
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (chatInput) {
        chatInput.disabled = true;
        chatInput.placeholder = "This chat has been resolved. Start a new conversation to continue.";
    }
    if (sendBtn) {
        sendBtn.disabled = true;
    }

    // Save resolved message to Firebase
    saveSystemMessage("Chat has been resolved by staff. Start a new conversation if you need more help.");
}

// ✅ NEW FUNCTION: Start a new chat conversation
window.startNewChat = async function() {
    if (!currentUser) return;

    try {
        // Show loading state
        const chatBody = document.getElementById('chat-body');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message bot';
        loadingDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="message-bubble">Starting new conversation...</div>
            </div>
        `;
        chatBody.appendChild(loadingDiv);

        // Unsubscribe from all listeners
        if (messagesListener) {
            messagesListener();
            messagesListener = null;
        }
        if (chatStatusListener) {
            chatStatusListener();
            chatStatusListener = null;
        }

        // Get resident name
        let residentName = "Resident";
        try {
            const residentDoc = await getDoc(doc(db, "residents", currentUser.email.toLowerCase()));
            if (residentDoc.exists()) {
                const userData = residentDoc.data();
                residentName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 
                              userData.fullName || 
                              currentUser.email.split('@')[0];
            }
        } catch (error) {
            console.error("Error fetching resident data:", error);
        }

        // Create new chat session
        const chatRef = await addDoc(collection(db, "chats"), {
            residentId: currentUser.uid,
            residentEmail: currentUser.email,
            residentName: residentName,
            status: "bot",
            createdAt: serverTimestamp(),
            lastMessage: null,
            unreadStaff: false
        });

        // Update global session
        chatSession = chatRef.id;
        chatTransferredToStaff = false;
        hasLoadedHistory = false;

        // Clear chat body
        chatBody.innerHTML = `
            <div id="typing-indicator" class="typing-indicator message bot">
                <div class="message-avatar">🤖</div>
                <div class="message-content">
                    <div class="message-bubble">
                        <div class="typing-dots">
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Re-enable input
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = "Type your message...";
            chatInput.focus();
        }
        if (sendBtn) {
            sendBtn.disabled = false;
        }

        // Start listening for status changes again
        listenForChatStatusChanges();

        // Show welcome message
        setTimeout(() => {
            addBotMessage(
                "👋 Hello! I'm your Barangay assistant. How can I help you today?",
                true
            );
        }, 500);

        console.log("✅ New chat session created:", chatSession);

    } catch (error) {
        console.error("Error starting new chat:", error);
        addBotMessage("Sorry, there was an error starting a new conversation. Please refresh the page.");
    }
};

// ✅ NEW FUNCTION: Save system messages
async function saveSystemMessage(message) {
    if (!chatSession || !currentUser) return;

    try {
        const chatRef = doc(db, "chats", chatSession);
        
        await addDoc(collection(chatRef, "messages"), {
            message: message,
            sender: "system",
            timestamp: serverTimestamp()
        });

    } catch (error) {
        console.error("Error saving system message:", error);
    }
}
