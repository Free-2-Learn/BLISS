import { auth, db } from "../firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("login-form");
    const togglePassword = document.getElementById("togglePassword");
    const passwordInput = document.getElementById("password");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loginBtn = document.getElementById("loginBtn");
    const errorMessage = document.getElementById("error-message");

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
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                errorMessage.style.display = "none";
            }, 5000);
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
    // FORM SUBMISSION HANDLER
    // ===================================
    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            
            const email = document.getElementById("username").value.trim().toLowerCase();
            const password = document.getElementById("password").value;

            // Clear previous errors
            clearError();

            // Validate inputs
            if (!email || !password) {
                showError("Please enter both email and password.");
                return;
            }

            // Show loading
            showLoading();

            try {
                // Sign in user with Firebase Authentication
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                console.log("✅ User logged in:", email);

                // FIRST: Check if the email belongs to the captain/admin
                try {
                    const captainRef = doc(db, "config", "admin");
                    const captainSnap = await getDoc(captainRef);

                    if (captainSnap.exists() && captainSnap.data().email === email) {
                        console.log("✅ Captain/Admin detected - Redirecting to Captain Dashboard...");
                        
                        // Add a small delay for better UX
                        setTimeout(() => {
                            window.location.href = "pages/dashboard-captain.html";
                        }, 500);
                        return;
                    }
                } catch (error) {
                    console.error("Error checking captain status:", error);
                }

                // SECOND: Check if the user is staff
                try {
                    const staffRef = doc(db, "staff", email);
                    console.log("🔍 Checking staff document at path:", `staff/${email}`);
                    const staffSnap = await getDoc(staffRef);
                    console.log("📄 Staff document exists:", staffSnap.exists());

                    if (staffSnap.exists()) {
                        const staffData = staffSnap.data();
                        console.log("📋 Staff data:", staffData);
                        
                        // Check if staff account is active
                        if (staffData.isActive === false) {
                            console.warn("❌ Staff account is disabled");
                            await auth.signOut();
                            hideLoading();
                            showError("Your account has been disabled. Contact the administrator.");
                            return;
                        }

                        console.log("✅ Staff detected - Redirecting to Staff Dashboard...");
                        
                        setTimeout(() => {
                            window.location.href = "pages/dashboard-staff.html";
                        }, 500);
                        return;
                    } else {
                        console.warn("⚠️ Staff document does not exist for:", email);
                    }
                } catch (error) {
                    console.error("❌ Error checking staff status:", error);
                    console.error("Error details:", error.code, error.message);
                }

                // THIRD: Check if the user is a resident
                try {
                    const residentRef = doc(db, "residents", email);
                    const residentSnap = await getDoc(residentRef);

                    if (residentSnap.exists()) {
                        console.log("✅ Resident detected - Redirecting to Resident Dashboard...");
                        
                        setTimeout(() => {
                            window.location.href = "pages/dashboard-resident.html";
                        }, 500);
                        return;
                    }
                } catch (error) {
                    console.error("Error checking resident status:", error);
                }

                // If not found in any collection, log out and show error
                console.warn("❌ Unauthorized access. User not found in any role collection. Logging out...");
                await auth.signOut();
                hideLoading();
                showError("Your account is not recognized. Contact the Barangay Office.");
                
            } catch (error) {
                console.error("❌ Login Error:", error.message);
                hideLoading();
                
                // Handle specific Firebase Auth errors
                let errorMsg = "Login failed. Please try again.";
                
                switch(error.code) {
                    case 'auth/wrong-password':
                    case 'auth/user-not-found':
                    case 'auth/invalid-credential':
                        errorMsg = "Invalid email or password.";
                        break;
                    case 'auth/too-many-requests':
                        errorMsg = "Too many failed login attempts. Please try again later.";
                        break;
                    case 'auth/network-request-failed':
                        errorMsg = "Network error. Please check your internet connection.";
                        break;
                    case 'auth/invalid-email':
                        errorMsg = "Invalid email format.";
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
    // REMEMBER ME FUNCTIONALITY
    // ===================================
    const rememberMeCheckbox = document.getElementById("rememberMe");
    const usernameInput = document.getElementById("username");

    // Load saved email if exists
    const savedEmail = localStorage.getItem("rememberedEmail");
    if (savedEmail) {
        usernameInput.value = savedEmail;
        rememberMeCheckbox.checked = true;
    }

    // Save email when form is submitted
    if (loginForm) {
        loginForm.addEventListener("submit", function() {
            if (rememberMeCheckbox.checked) {
                localStorage.setItem("rememberedEmail", usernameInput.value.trim().toLowerCase());
            } else {
                localStorage.removeItem("rememberedEmail");
            }
        });
    }

    // ===================================
    // FORGOT PASSWORD HANDLER
    // ===================================
    const forgotPasswordLink = document.querySelector('.forgot-password');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            alert('Please contact the administrator to reset your password.');
        });
    }

    // ===================================
    // ENTER KEY SUBMISSION
    // ===================================
    inputs.forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                loginForm.dispatchEvent(new Event('submit'));
            }
        });
    });

    // ===================================
    // PREVENT MULTIPLE SUBMISSIONS
    // ===================================
    let isSubmitting = false;
    if (loginForm) {
        loginForm.addEventListener('submit', function() {
            if (isSubmitting) {
                return false;
            }
            isSubmitting = true;
            
            // Reset after 3 seconds
            setTimeout(() => {
                isSubmitting = false;
            }, 3000);
        });
    }
});