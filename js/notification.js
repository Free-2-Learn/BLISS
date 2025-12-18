const notificationList = document.getElementById('notification-list'); 

let notifications = []; // Placeholder for Firebase integration

// Function to load notifications
function loadNotifications() {
    notificationList.innerHTML = '';
    notifications.forEach((notif, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            ${notif.text} 
            <small>(${notif.date})</small>
            <button onclick="clearNotification(${index})">Dismiss</button>
        `;
        notificationList.appendChild(li);
    });
}

// Function to add a notification (Called when a resident requests a document)
function addNotification(message) {
    notifications.push({ text: message, date: new Date().toLocaleString() });
    loadNotifications();
}

// Function to clear a notification
function clearNotification(index) {
    notifications.splice(index, 1);
    loadNotifications();
}

// Simulated Real-Time Update (Replace with Firebase listener later)
setInterval(loadNotifications, 3000);

// Load existing notifications on page load
loadNotifications();
