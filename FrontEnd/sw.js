// frontend/sw.js
// Este es el Service Worker

console.log("Service Worker Registrado");

// Evento 'push': Se activa cuando el servidor envía una notificación
self.addEventListener("push", (e) => {
  const data = e.data.json();
  console.log("Push Recibido:", data);

  const title = data.title || "TecBus";
  const options = {
    body: data.body,
    icon: data.icon || "assets/icons/icon-192.png", // (Necesitarás crear un ícono)
    badge: data.icon || "assets/icons/icon-192.png",
  };

  // Muestra la notificación
  e.waitUntil(self.registration.showNotification(title, options));
});
