// navigation-helper.js - Role-based navigation and access control
// Place this file in: js/navigation-helper.js

import { isCaptainOrStaff } from "./auth-helper.js";

/**
 * Page configuration - Define which pages require which roles
 */
const PAGE_ACCESS = {
    // Captain-only pages
    'dashboard-captain.html': ['captain'],
    'analytics-dashboard.html': ['captain'],
    'staff-management.html': ['captain'],
    'system-settings.html': ['captain'],
    
    // Staff-only pages
    'dashboard-staff.html': ['staff'],
    
    // Shared pages (both captain and staff can access)
    'staff-chat.html': ['captain', 'staff'],
    'residents.html': ['captain', 'staff'],
    'document-requests.html': ['captain', 'staff'],
    'captain-announcements.html': ['captain', 'staff'],
    'resident-history.html': ['captain', 'staff'],
    'staff-incident-dashboard.html': ['captain', 'staff'],
    'certificates.html': ['captain', 'staff'],
    'blotter.html': ['captain', 'staff'],
    'reports.html': ['captain', 'staff']
};

/**
 * Dashboard URLs for each role
 */
const ROLE_DASHBOARDS = {
    captain: 'dashboard-captain.html',
    staff: 'dashboard-staff.html'
};

/**
 * Get the current page filename
 */
function getCurrentPage() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

/**
 * Check if user has access to current page
 */
export function canAccessPage(userRole, pageName = null) {
    const page = pageName || getCurrentPage();
    const allowedRoles = PAGE_ACCESS[page];
    
    // If page not in config, assume it's public or handle separately
    if (!allowedRoles) return true;
    
    return allowedRoles.includes(userRole);
}

/**
 * Get the correct dashboard URL for a role
 */
export function getDashboardForRole(role) {
    return ROLE_DASHBOARDS[role] || 'index.html';
}

/**
 * Redirect to appropriate dashboard based on role
 */
export function redirectToDashboard(role) {
    const dashboardUrl = getDashboardForRole(role);
    window.location.href = dashboardUrl;
}

/**
 * Handle "Back" button navigation - goes to role-appropriate dashboard
 */
export function goToDashboard(role) {
    redirectToDashboard(role);
}

/**
 * Protect a page - Check if user has access, redirect if not
 * Call this at the top of each protected page
 */
export async function protectPage(auth) {
    const user = auth.currentUser;
    
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    
    const { hasAccess, role } = await isCaptainOrStaff(user);
    
    if (!hasAccess) {
        alert('Access denied. You do not have permission to access this system.');
        await auth.signOut();
        window.location.href = 'index.html';
        return null;
    }
    
    // Check if user can access this specific page
    if (!canAccessPage(role)) {
        alert(`Access denied. This page is not available for ${role}s.`);
        redirectToDashboard(role);
        return null;
    }
    
    return { user, role };
}

/**
 * Setup navigation links based on user role
 * Hides/shows navigation items based on role
 */
export function setupRoleBasedNavigation(role) {
    // Hide captain-only nav items from staff
    if (role === 'staff') {
        document.querySelectorAll('[data-role="captain-only"]').forEach(el => {
            el.style.display = 'none';
        });
    }
    
    // Hide staff-only nav items from captain (if any)
    if (role === 'captain') {
        document.querySelectorAll('[data-role="staff-only"]').forEach(el => {
            el.style.display = 'none';
        });
    }
    
    // Update dashboard link to go to correct dashboard
    const dashboardLinks = document.querySelectorAll('[data-nav="dashboard"]');
    dashboardLinks.forEach(link => {
        link.href = getDashboardForRole(role);
    });
}

/**
 * Create a "Back to Dashboard" button that goes to correct dashboard
 */
export function createBackButton(role, container = null) {
    const button = document.createElement('button');
    button.className = 'btn btn-secondary';
    button.innerHTML = '<i class="fas fa-arrow-left"></i> Back to Dashboard';
    button.onclick = () => goToDashboard(role);
    
    if (container) {
        container.appendChild(button);
    }
    
    return button;
}