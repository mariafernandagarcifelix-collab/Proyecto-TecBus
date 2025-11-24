// FrontEnd/sw.js

console.log("Service Worker Cargado...");

self.addEventListener("push", e => {
    const data = e.data.json();
    console.log("🔔 Notificación recibida:", data);

    self.registration.showNotification(data.title, {
        body: data.body,
        icon: data.icon || "https://cdn-icons-png.flaticon.com/512/3448/3448339.png", // Icono por defecto
        badge: "https://cdn-icons-png.flaticon.com/512/3448/3448339.png", // Icono pequeño para Android
        vibrate: [100, 50, 100], // Patrón de vibración
        data: {
            url: data.url || "/" // URL a abrir si le dan click
        }
    });
});

// Evento cuando el usuario hace click en la notificación
self.addEventListener("notificationclick", e => {
    const notification = e.notification;
    const action = e.action;
    const urlToOpen = notification.data.url;

    notification.close(); // Cerrar la notificación

    e.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // Si ya hay una ventana abierta, enfócala
            for (let client of windowClients) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no, abre una nueva
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});