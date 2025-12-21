import { auth } from "../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

// ===================================
// RATE LIMITING
// ===================================
class ResetRateLimiter {
    constructor() {
        this.storageKey = 'passwordResetAttempts';
        this.maxAttempts = 3;
        this.cooldownPeriod = 15 * 60 * 1000; // 15 minutes
    }

    getAttempts() {
        try {
            const data = sessionStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : { count: 0, lastAttempt: 0 };
        } catch {
            return { count: 0, lastAttempt: 0 };
        }
    }

    canAttempt() {
        const attempts = this.getAttempts();
        const now = Date.now();
        
        // Reset if cooldown period has passed
        if (now - attempts.lastAttempt > this.cooldownPeriod) {
            this.reset();
            return { allowed: true };
        }

        if (attempts.count >= this.maxAttempts) {
            const remainingTime = Math.ceil((this.cooldownPeriod - (now - attempts.lastAttempt)) / 60000);
            return { 
                allowed: false, 
                remainingMinutes: remainingTime 
            };
        }

        return { allowed: true };
    }

    recordAttempt() {
        const attempts = this.getAttempts();
        attempts.count++;
        attempts.lastAttempt = Date.now();
        
        try {
            sessionStorage.setItem(this.storageKey, JSON.stringify(attempts));
        } catch (error) {
            console.error('Failed to save reset attempts:', error);
        }
    }

    reset() {
        try {
            sessionStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Failed to reset attempts:', error);
        }
    }

    getRemainingAttempts() {
        const attempts = this.getAttempts();
        return Math.max(0, this.maxAttempts - attempts.count);
    }
}

const rateLimiter = new ResetRateLimiter();

// ===================================
// DOM ELEMENTS
// ===================================
const resetForm = document.getElementById("reset-form");
const resetEmailInput = document.getElementById("reset-email");
const resetBtn = document.getElementById("resetBtn");
const loadingOverlay = document.getElementById("loadingOverlay");
const errorMessage = document.getElementById("error-message");
const emailStep = document.getElementById("email-step");
const successStep = document.getElementById("success-step");
const sentEmailDisplay = document.getElementById("sent-email");

// ===================================
// UI HELPER FUNCTIONS
// ===================================
function showLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.add("show");
    }
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span class="btn-text">Sending...</span>';
    }
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove("show");
    }
    if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.innerHTML = `
            <span class="btn-text">Send Reset Link</span>
            <span class="btn-icon"><i class="fas fa-paper-plane"></i></span>
        `;
    }
}

function showError(message) {
    if (errorMessage) {
        const errorText = errorMessage.querySelector('.error-text');
        if (errorText) {
            errorText.textContent = message;
        }
        errorMessage.style.display = "flex";
        
        setTimeout(() => {
            errorMessage.style.display = "none";
        }, 10000);
    }
}

function clearError() {
    if (errorMessage) {
        errorMessage.style.display = "none";
    }
}

function showSuccessStep(email) {
    emailStep.classList.remove('active');
    successStep.classList.add('active');
    if (sentEmailDisplay) {
        sentEmailDisplay.textContent = email;
    }
    
    // Store email for resend functionality
    sessionStorage.setItem('resetEmail', email);
}

window.showEmailStep = function() {
    successStep.classList.remove('active');
    emailStep.classList.add('active');
    
    // Pre-fill with stored email if available
    const storedEmail = sessionStorage.getItem('resetEmail');
    if (resetEmailInput && storedEmail) {
        resetEmailInput.value = storedEmail;
    }
    
    if (resetEmailInput) {
        resetEmailInput.focus();
    }
    clearError();
}

// ===================================
// SANITIZE EMAIL INPUT
// ===================================
function sanitizeEmail(email) {
    return email.trim().toLowerCase().replace(/[<>'"]/g, '');
}

// ===================================
// VALIDATE EMAIL FORMAT
// ===================================
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// ===================================
// SEND RESET EMAIL
// ===================================
async function sendResetEmail(email) {
    // Check rate limiting
    const canAttempt = rateLimiter.canAttempt();
    if (!canAttempt.allowed) {
        throw new Error(`Too many attempts. Please wait ${canAttempt.remainingMinutes} minute(s) before trying again.`);
    }

    // Configure action code settings
    const actionCodeSettings = {
        url: `${window.location.origin}/index.html`,
        handleCodeInApp: false
    };

    try {
        await sendPasswordResetEmail(auth, email, actionCodeSettings);
        
        // Record successful attempt
        rateLimiter.recordAttempt();
        
        console.log("✅ Password reset email sent to:", email);
        return { success: true };
        
    } catch (error) {
        // Record failed attempt
        rateLimiter.recordAttempt();
        
        console.error("❌ Password reset error:", error.code);
        
        // Handle specific Firebase errors
        switch(error.code) {
            case 'auth/user-not-found':
                // Security: Don't reveal if user exists
                // Return success to prevent account enumeration
                return { success: true, silent: true };
                
            case 'auth/invalid-email':
                throw new Error("Invalid email format.");
                
            case 'auth/too-many-requests':
                throw new Error("Too many requests from this device. Please try again in a few minutes.");
                
            case 'auth/network-request-failed':
                throw new Error("Network error. Please check your internet connection.");
                
            case 'auth/internal-error':
                throw new Error("An internal error occurred. Please try again.");
                
            default:
                throw new Error("Failed to send reset email. Please try again.");
        }
    }
}

// ===================================
// FORM SUBMISSION HANDLER
// ===================================
if (resetForm) {
    resetForm.addEventListener("submit", async function(event) {
        event.preventDefault();
        
        const email = sanitizeEmail(resetEmailInput.value);
        
        // Clear previous errors
        clearError();
        
        // Validate email
        if (!email) {
            showError("Please enter your email address.");
            resetEmailInput.focus();
            return;
        }
        
        if (!isValidEmail(email)) {
            showError("Please enter a valid email address.");
            resetEmailInput.focus();
            return;
        }
        
        // Check rate limiting before attempting
        const canAttempt = rateLimiter.canAttempt();
        if (!canAttempt.allowed) {
            showError(`Too many attempts. Please wait ${canAttempt.remainingMinutes} minute(s) before trying again.`);
            return;
        }
        
        // Show remaining attempts if getting low
        const remaining = rateLimiter.getRemainingAttempts();
        if (remaining <= 2 && remaining > 0) {
            console.warn(`⚠️ ${remaining} reset attempt(s) remaining`);
        }
        
        // Show loading
        showLoading();
        
        try {
            const result = await sendResetEmail(email);
            
            // Hide loading
            hideLoading();
            
            // Show success step (even if user doesn't exist - security measure)
            showSuccessStep(email);
            
            // Clear the form
            resetForm.reset();
            
        } catch (error) {
            hideLoading();
            showError(error.message);
            
            // Focus back to input for retry
            if (resetEmailInput) {
                resetEmailInput.focus();
            }
        }
    });
}

// ===================================
// RESEND EMAIL HANDLER
// ===================================
window.resendResetEmail = async function() {
    const email = sessionStorage.getItem('resetEmail');
    
    if (!email) {
        showEmailStep();
        return;
    }
    
    // Check rate limiting
    const canAttempt = rateLimiter.canAttempt();
    if (!canAttempt.allowed) {
        alert(`Please wait ${canAttempt.remainingMinutes} minute(s) before requesting another reset email.`);
        return;
    }
    
    showLoading();
    
    try {
        await sendResetEmail(email);
        hideLoading();
        alert('Reset email sent successfully! Please check your inbox.');
    } catch (error) {
        hideLoading();
        alert(error.message);
    }
}

// ===================================
// INPUT FOCUS EFFECTS
// ===================================
if (resetEmailInput) {
    const inputWrapper = resetEmailInput.parentElement;
    
    resetEmailInput.addEventListener('focus', function() {
        if (inputWrapper) {
            inputWrapper.classList.add('focused');
        }
    });
    
    resetEmailInput.addEventListener('blur', function() {
        if (inputWrapper) {
            inputWrapper.classList.remove('focused');
        }
    });
    
    // Clear error on input
    resetEmailInput.addEventListener('input', function() {
        clearError();
        
        // Real-time validation feedback
        if (this.value.length > 0 && !isValidEmail(this.value)) {
            this.style.borderColor = '#fc8181';
        } else {
            this.style.borderColor = '';
        }
    });
}

// ===================================
// ENTER KEY SUPPORT
// ===================================
if (resetEmailInput) {
    resetEmailInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            resetForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
}

// ===================================
// AUTO-FOCUS EMAIL INPUT ON LOAD
// ===================================
window.addEventListener('DOMContentLoaded', function() {
    // Check if coming from login page with pre-filled email
    const urlParams = new URLSearchParams(window.location.search);
    const prefilledEmail = urlParams.get('email');
    
    if (prefilledEmail && resetEmailInput) {
        resetEmailInput.value = sanitizeEmail(prefilledEmail);
    }
    
    if (resetEmailInput) {
        resetEmailInput.focus();
    }
    
    // Show rate limit info if applicable
    const canAttempt = rateLimiter.canAttempt();
    if (!canAttempt.allowed) {
        showError(`Too many attempts. Please wait ${canAttempt.remainingMinutes} minute(s) before trying again.`);
        if (resetBtn) {
            resetBtn.disabled = true;
        }
        
        // Re-enable after cooldown
        setTimeout(() => {
            clearError();
            if (resetBtn) {
                resetBtn.disabled = false;
            }
            rateLimiter.reset();
        }, canAttempt.remainingMinutes * 60 * 1000);
    }
});

// ===================================
// PREVENT MULTIPLE SUBMISSIONS
// ===================================
let isSubmitting = false;
if (resetForm) {
    resetForm.addEventListener('submit', function(e) {
        if (isSubmitting) {
            e.preventDefault();
            return false;
        }
        isSubmitting = true;
        
        // Reset after 3 seconds
        setTimeout(() => {
            isSubmitting = false;
        }, 3000);
    }, true);
}

// ===================================
// CLEAR SESSION DATA ON PAGE UNLOAD
// ===================================
window.addEventListener('beforeunload', function() {
    // Keep resetEmail for potential resend, but clear sensitive data
    // sessionStorage will be cleared when browser closes anyway
});

// ===================================
// BACK TO LOGIN WITH EMAIL
// ===================================
window.backToLoginWithEmail = function() {
    const email = sessionStorage.getItem('resetEmail');
    if (email) {
        window.location.href = `index.html?email=${encodeURIComponent(email)}`;
    } else {
        window.location.href = 'index.html';
    }
}