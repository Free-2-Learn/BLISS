import { auth, db } from "../firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// ===================================
// SECURITY CONFIGURATION
// ===================================
const SECURITY_CONFIG = {
    // Detect if running on localhost or production
    isDevelopment: window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   window.location.hostname.includes('192.168.'), // Local network
    isProduction: window.location.hostname === 'free-2-learn.github.io',
    productionURL: 'https://free-2-learn.github.io/BLISS/',
    defaultPassword: 'Resident123', // For detection only
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000 // 15 minutes in milliseconds
};

// ===================================
// EMAIL VALIDATION REGEX (Global scope)
// ===================================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ===================================
// SECURE LOGGING (Only in Development)
// ===================================
function secureLog(message, data = null) {
    if (SECURITY_CONFIG.isDevelopment) {
        if (data) {
            console.log(message, data);
        } else {
            console.log(message);
        }
    }
}

// ===================================
// LOGIN ATTEMPT TRACKING
// ===================================
class LoginAttemptTracker {
    constructor() {
        this.storageKey = 'loginAttempts';
        this.attempts = this.loadAttempts();
    }

    loadAttempts() {
        try {
            const stored = sessionStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    }

    saveAttempts() {
        try {
            sessionStorage.setItem(this.storageKey, JSON.stringify(this.attempts));
        } catch (error) {
            secureLog('Failed to save login attempts', error);
        }
    }

    recordAttempt(email, success) {
        const now = Date.now();
        
        if (!this.attempts[email]) {
            this.attempts[email] = {
                count: 0,
                lastAttempt: now,
                lockedUntil: null
            };
        }

        const attempt = this.attempts[email];

        if (success) {
            // Clear attempts on successful login
            delete this.attempts[email];
        } else {
            attempt.count++;
            attempt.lastAttempt = now;

            // Lock account if max attempts reached
            if (attempt.count >= SECURITY_CONFIG.maxLoginAttempts) {
                attempt.lockedUntil = now + SECURITY_CONFIG.lockoutDuration;
            }
        }

        this.saveAttempts();
    }

    isLocked(email) {
        const attempt = this.attempts[email];
        if (!attempt || !attempt.lockedUntil) return false;

        const now = Date.now();
        if (now < attempt.lockedUntil) {
            const remainingMinutes = Math.ceil((attempt.lockedUntil - now) / 60000);
            return {
                locked: true,
                remainingMinutes: remainingMinutes
            };
        }

        // Lockout expired, reset attempts
        delete this.attempts[email];
        this.saveAttempts();
        return { locked: false };
    }

    getRemainingAttempts(email) {
        const attempt = this.attempts[email];
        if (!attempt) return SECURITY_CONFIG.maxLoginAttempts;
        return Math.max(0, SECURITY_CONFIG.maxLoginAttempts - attempt.count);
    }
}

const attemptTracker = new LoginAttemptTracker();

// ===================================
// LOG LOGIN ATTEMPT TO FIRESTORE (Analytics)
// ===================================
async function logLoginAttempt(email, success, reason = '', redirectTo = '') {
    try {
        await addDoc(collection(db, 'loginAttempts'), {
            email: email,
            success: success,
            reason: reason,
            redirectTo: redirectTo,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent,
            // Note: IP address can only be captured server-side
        });
        secureLog('Login attempt logged to Firestore');
    } catch (error) {
        secureLog('Failed to log login attempt to Firestore:', error);
        // Don't throw - logging failure shouldn't break login
    }
}

// ===================================
// SANITIZE EMAIL INPUT (Global function)
// ===================================
function sanitizeEmail(email) {
    return email.trim().toLowerCase().replace(/[<>'"]/g, '');
}

// ===================================
// DOM ELEMENTS
// ===================================
document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("login-form");
    const togglePassword = document.getElementById("togglePassword");
    const passwordInput = document.getElementById("password");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loginBtn = document.getElementById("loginBtn");
    const errorMessage = document.getElementById("error-message");
    const rememberMeCheckbox = document.getElementById("rememberMe");
    const usernameInput = document.getElementById("username");
    const forgotPasswordLink = document.querySelector('.forgot-password');

    // ===================================
    // TOGGLE PASSWORD VISIBILITY
    // ===================================
    if (togglePassword) {
        togglePassword.addEventListener("click", function() {
            const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
            passwordInput.setAttribute("type", type);
            
            const icon = togglePassword.querySelector("i");
            if (type === "text") {
                icon.classList.remove("fa-eye");
                icon.classList.add("fa-eye-slash");
            } else {
                icon.classList.remove("fa-eye-slash");
                icon.classList.add("fa-eye");
            }
        });
    }

    // ===================================
    // INPUT FOCUS EFFECTS
    // ===================================
    const inputs = document.querySelectorAll('.input-wrapper input');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.classList.add('focused');
        });
        
        input.addEventListener('blur', function() {
            this.parentElement.classList.remove('focused');
        });
    });

    // ===================================
    // SHOW LOADING OVERLAY
    // ===================================
    function showLoading() {
        if (loadingOverlay) {
            loadingOverlay.classList.add("show");
        }
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                <span class="btn-text">Authenticating...</span>
            `;
        }
    }

    // ===================================
    // HIDE LOADING OVERLAY
    // ===================================
    function hideLoading() {
        if (loadingOverlay) {
            loadingOverlay.classList.remove("show");
        }
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = `
                <span class="btn-text">Login</span>
                <span class="btn-icon">
                    <i class="fas fa-arrow-right"></i>
                </span>
            `;
        }
    }

    // ===================================
    // SHOW ERROR MESSAGE
    // ===================================
    function showError(message) {
        if (errorMessage) {
            const errorText = errorMessage.querySelector('.error-text');
            if (errorText) {
                errorText.textContent = message;
            } else {
                errorMessage.innerHTML = `
                    <i class="fas fa-exclamation-circle"></i>
                    <span class="error-text">${message}</span>
                `;
            }
            errorMessage.style.display = "flex";
            
            // Auto-hide after 8 seconds
            setTimeout(() => {
                errorMessage.style.display = "none";
            }, 8000);
        }
    }

    // ===================================
    // CLEAR ERROR MESSAGE
    // ===================================
    function clearError() {
        if (errorMessage) {
            errorMessage.style.display = "none";
        }
    }

    // ===================================
    // CHECK FOR DEFAULT PASSWORD WARNING
    // ===================================
    function checkDefaultPassword(password, dashboardUrl) {
        if (password === SECURITY_CONFIG.defaultPassword) {
            // Store flag to show warning on dashboard
            sessionStorage.setItem('showPasswordWarning', 'true');
            secureLog('⚠️ User logged in with default password');
        }
    }

    // ===================================
    // SECURE ROLE DETECTION (Prevents Timing Attacks)
    // ===================================
    async function detectUserRole(email) {
        try {
            // Fetch all roles simultaneously to prevent timing attacks
            const [captainSnap, staffSnap, residentSnap] = await Promise.all([
                getDoc(doc(db, "config", "admin")),
                getDoc(doc(db, "staff", email)),
                getDoc(doc(db, "residents", email))
            ]);

            // Check captain
            if (captainSnap.exists() && captainSnap.data().email === email) {
                return { role: 'captain', data: captainSnap.data(), path: 'pages/dashboard-captain.html' };
            }

            // Check staff
            if (staffSnap.exists()) {
                const staffData = staffSnap.data();
                if (staffData.isActive === false) {
                    return { role: 'disabled', data: staffData };
                }
                return { role: 'staff', data: staffData, path: 'pages/dashboard-staff.html' };
            }

            // Check resident
            if (residentSnap.exists()) {
                const residentData = residentSnap.data();
                return { role: 'resident', data: residentData, path: 'pages/dashboard-resident.html' };
            }

            return { role: 'unknown' };

        } catch (error) {
            secureLog('Error detecting user role:', error);
            throw new Error('Role detection failed');
        }
    }

    // ===================================
    // FORM SUBMISSION HANDLER
    // ===================================
    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            
            const email = sanitizeEmail(document.getElementById("username").value);
            const password = document.getElementById("password").value;

            // Clear previous errors
            clearError();

            // Validate inputs
            if (!email || !password) {
                showError("Please enter both email and password.");
                return;
            }

            // Email format validation
            if (!emailRegex.test(email)) {
                showError("Please enter a valid email address.");
                return;
            }

            // Check if account is locked
            const lockStatus = attemptTracker.isLocked(email);
            if (lockStatus.locked) {
                showError(`Too many failed attempts. Account locked for ${lockStatus.remainingMinutes} minute(s).`);
                return;
            }

            // Show loading
            showLoading();

            try {
                // Authenticate with Firebase
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                secureLog("✅ Authentication successful:", email);

                // Detect user role securely
                const roleInfo = await detectUserRole(email);

                if (roleInfo.role === 'disabled') {
                    // Staff account is disabled
                    await auth.signOut();
                    hideLoading();
                    attemptTracker.recordAttempt(email, false);
                    await logLoginAttempt(email, false, 'account_disabled');
                    showError("Your account has been disabled. Please contact the administrator.");
                    return;
                }

                if (roleInfo.role === 'unknown') {
                    // User not found in any collection
                    await auth.signOut();
                    hideLoading();
                    attemptTracker.recordAttempt(email, false);
                    await logLoginAttempt(email, false, 'role_not_found');
                    showError("Access denied. Please contact the Barangay Office.");
                    return;
                }

                // Successful login
                secureLog(`✅ User role detected: ${roleInfo.role}`);
                attemptTracker.recordAttempt(email, true);
                await logLoginAttempt(email, true, 'success', roleInfo.path);

                // Check for default password
                checkDefaultPassword(password, roleInfo.path);

                // Handle Remember Me (Secure)
                handleRememberMe(email);

                // Redirect to appropriate dashboard
                setTimeout(() => {
                    window.location.href = roleInfo.path;
                }, 500);
                
            } catch (error) {
                secureLog("❌ Login Error:", error.code);
                hideLoading();
                
                // Record failed attempt
                attemptTracker.recordAttempt(email, false);
                await logLoginAttempt(email, false, error.code);

                // Get remaining attempts
                const remaining = attemptTracker.getRemainingAttempts(email);
                
                // Generic error message (security best practice)
                let errorMsg = "Invalid email or password.";
                
                // Add attempt warning
                if (remaining <= 3 && remaining > 0) {
                    errorMsg += ` ${remaining} attempt(s) remaining.`;
                }
                
                // Specific error handling (without revealing too much)
                switch(error.code) {
                    case 'auth/too-many-requests':
                        errorMsg = "Too many failed attempts. Please try again later or reset your password.";
                        break;
                    case 'auth/network-request-failed':
                        errorMsg = "Network error. Please check your internet connection.";
                        break;
                    case 'auth/user-disabled':
                        errorMsg = "This account has been disabled.";
                        break;
                }
                
                showError(errorMsg);
            }
        });
    }

    // ===================================
    // SECURE REMEMBER ME FUNCTIONALITY
    // ===================================
    function handleRememberMe(email) {
        if (rememberMeCheckbox && rememberMeCheckbox.checked) {
            // Use sessionStorage instead of localStorage for better security
            // Base64 encode for basic obfuscation (not encryption)
            try {
                sessionStorage.setItem("rememberedEmail", btoa(email));
            } catch (error) {
                secureLog('Failed to save remembered email:', error);
            }
        } else {
            // Clear both storages
            sessionStorage.removeItem("rememberedEmail");
            localStorage.removeItem("rememberedEmail"); // Clean old data
        }
    }

    // Load saved email if exists
    function loadRememberedEmail() {
        try {
            // Check sessionStorage first (new secure method)
            let savedEmail = sessionStorage.getItem("rememberedEmail");
            
            // Fallback to localStorage for backwards compatibility
            if (!savedEmail) {
                savedEmail = localStorage.getItem("rememberedEmail");
                if (savedEmail) {
                    // Migrate to sessionStorage
                    sessionStorage.setItem("rememberedEmail", savedEmail);
                    localStorage.removeItem("rememberedEmail");
                }
            }

            if (savedEmail && usernameInput) {
                try {
                    usernameInput.value = atob(savedEmail);
                    if (rememberMeCheckbox) {
                        rememberMeCheckbox.checked = true;
                    }
                } catch {
                    // Invalid base64, clear it
                    sessionStorage.removeItem("rememberedEmail");
                }
            }
        } catch (error) {
            secureLog('Failed to load remembered email:', error);
        }
    }

    loadRememberedEmail();

    // ===================================
    // FORGOT PASSWORD HANDLER
    // ===================================
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            
            const email = sanitizeEmail(usernameInput.value);
            
            // Redirect to forgot password page with email pre-filled
            if (email && emailRegex.test(email)) {
                window.location.href = `forgot-password.html?email=${encodeURIComponent(email)}`;
            } else {
                // Go to forgot password page without pre-filled email
                window.location.href = 'forgot-password.html';
            }
        });
    }

    // ===================================
    // CHECK FOR PRE-FILLED EMAIL FROM FORGOT PASSWORD
    // ===================================
    const urlParams = new URLSearchParams(window.location.search);
    const prefilledEmail = urlParams.get('email');
    
    if (prefilledEmail && usernameInput) {
        usernameInput.value = sanitizeEmail(prefilledEmail);
        // Focus on password field since email is already filled
        if (passwordInput) {
            passwordInput.focus();
        }
        
        // Show a helpful message
        const successMsg = document.createElement('div');
        successMsg.className = 'info-message';
        successMsg.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <span>If a reset email was sent, please check your inbox and create a new password.</span>
        `;
        successMsg.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            background: #e6fffa;
            border: 1px solid #81e6d9;
            border-radius: 8px;
            color: #234e52;
            font-size: 14px;
            margin-bottom: 15px;
            animation: slideDown 0.3s ease;
        `;
        
        // Add animations to document if not already present
        if (!document.getElementById('info-message-animations')) {
            const style = document.createElement('style');
            style.id = 'info-message-animations';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes slideUp {
                    from {
                        opacity: 1;
                        transform: translateY(0);
                    }
                    to {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Insert before the form
        if (loginForm) {
            loginForm.parentNode.insertBefore(successMsg, loginForm);
            
            // Remove after 10 seconds
            setTimeout(() => {
                successMsg.style.animation = 'slideUp 0.3s ease';
                setTimeout(() => successMsg.remove(), 300);
            }, 10000);
        }
        
        // Clear URL parameter
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ===================================
    // ENTER KEY SUBMISSION
    // ===================================
    inputs.forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                loginForm.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });
    });

    // ===================================
    // PREVENT MULTIPLE SUBMISSIONS
    // ===================================
    let isSubmitting = false;
    if (loginForm) {
        const originalSubmit = loginForm.onsubmit;
        loginForm.addEventListener('submit', function(e) {
            if (isSubmitting) {
                e.preventDefault();
                return false;
            }
            isSubmitting = true;
            
            // Reset after 5 seconds
            setTimeout(() => {
                isSubmitting = false;
            }, 5000);
        }, true);
    }

    // ===================================
    // CLEAR SENSITIVE DATA ON PAGE UNLOAD
    // ===================================
    window.addEventListener('beforeunload', function() {
        // Clear password field
        if (passwordInput) {
            passwordInput.value = '';
        }
    });

    // ===================================
    // SECURITY: Disable Context Menu on Password Field
    // ===================================
    if (passwordInput) {
        passwordInput.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
        });
    }

    // ===================================
    // PASTE VALIDATION (Prevent Long Passwords from Paste)
    // ===================================
    if (passwordInput) {
        passwordInput.addEventListener('paste', function(e) {
            const pasteData = e.clipboardData.getData('text');
            if (pasteData.length > 128) {
                e.preventDefault();
                showError('Password too long. Maximum 128 characters.');
            }
        });
    }
});
