// frontend/assets/js/student_map.js

/**
 * ¡NUEVO! Función de ayuda para convertir la llave VAPID
 * de un string (Base64) a un array binario (Uint8Array)
 * que el navegador entiende.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICACIÓN DE SEGURIDAD ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");
  if (!token || !userString) {
    window.location.href = "index.html";
    return;
  }
  const user = JSON.parse(userString);
  if (user.tipo !== "estudiante") {
    if (user.tipo === "administrador") window.location.href = "admin.html";
    if (user.tipo === "conductor") window.location.href = "conductor.html";
    return;
  }

  // --- 2. CONFIGURACIÓN INICIAL ---
  const initialLat = 25.567,
    initialLng = -108.473,
    initialZoom = 13;
  const socket = io("http://localhost:5000");
  let busMarkers = {},
    rutaPolyline = null;

  // --- 3. INICIALIZACIÓN DEL MAPA ---
  const map = L.map("map").setView([initialLat, initialLng], initialZoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);
  const busIcon = L.divIcon({
    className: "custom-bus-icon",
    html: `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; color: white; border: 2px solid white; font-size: 14px;"><i class="fas fa-bus"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  // --- 4. LÓGICA DE CARGA DE CAMIONES ---
  async function fetchAndDrawBuses() {
    try {
      const response = await fetch("http://localhost:5000/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudieron cargar los camiones");
      const camiones = await response.json();
      Object.values(busMarkers).forEach((marker) => map.removeLayer(marker));
      busMarkers = {};
      const camionSelector = document.getElementById("camion-selector");
      camionSelector.innerHTML = '<option value="">Elige un camión...</option>';
      camiones.forEach((camion) => {
        if (camion.estado === "activo") {
          const rutaNombre = camion.rutaAsignada
            ? camion.rutaAsignada.nombre
            : "Sin Ruta";
          const rutaId = camion.rutaAsignada ? camion.rutaAsignada._id : "";
          camionSelector.innerHTML += `<option value="${camion._id}" data-ruta-id="${rutaId}">${camion.numeroUnidad} (${rutaNombre})</option>`;
          if (camion.ubicacionActual) {
            const [lng, lat] = camion.ubicacionActual.coordinates;
            const marker = L.marker([lat, lng], { icon: busIcon })
              .addTo(map)
              .bindPopup(`🚍 **Camión ${camion.numeroUnidad}**`);
            busMarkers[camion._id] = marker;
          }
        }
      });
    } catch (error) {
      console.error(error);
    }
  }

  // --- 5. LÓGICA DE TIEMPO REAL (SOCKET.IO) ---
  socket.on("connect", () =>
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id)
  );
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
      const newMarker = L.marker([data.location.lat, data.location.lng], {
        icon: busIcon,
      })
        .addTo(map)
        .bindPopup(`🚍 **Camión ${data.numeroUnidad}**`);
      busMarkers[data.camionId] = newMarker;
    }
  });
  socket.on("newIncidentAlert", (data) => {
    alert(
      `🚨 ¡ALERTA DE CONDUCTOR!\n\nCamión: ${data.camionId}\nTipo: ${
        data.tipo
      }\nDetalles: ${data.detalles || "N/A"}`
    );
  });

  // --- 6. LÓGICA DE INTERFAZ (BOTONES) ---
  const camionSelector = document.getElementById("camion-selector");
  camionSelector.addEventListener("change", (e) => {
    const selectedOption = e.target.options[e.target.selectedIndex];
    const selectedBusId = selectedOption.value;
    const selectedRutaId = selectedOption.dataset.rutaId;
    const marker = busMarkers[selectedBusId];
    if (marker) {
      map.flyTo(marker.getLatLng(), 15);
      marker.openPopup();
    } else {
      map.flyTo([initialLat, initialLng], initialZoom);
    }
    if (selectedRutaId) {
      dibujarRuta(selectedRutaId);
    } else {
      if (rutaPolyline) map.removeLayer(rutaPolyline);
    }
  });
  async function dibujarRuta(rutaId) {
    try {
      const response = await fetch(
        `http://localhost:5000/api/rutas/${rutaId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok)
        throw new Error("No se pudo cargar el trazado de la ruta");
      const ruta = await response.json();
      if (!ruta.paradas || ruta.paradas.length === 0) return;
      const coordenadas = ruta.paradas.map((p) => [
        p.ubicacion.coordinates[1],
        p.ubicacion.coordinates[0],
      ]); // [lat, lng]
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      rutaPolyline = L.polyline(coordenadas, {
        color: "var(--color-primario)",
        weight: 5,
        opacity: 0.7,
        dashArray: "10, 5",
      }).addTo(map);
      ruta.paradas.forEach((p, i) => {
        L.circleMarker(
          [p.ubicacion.coordinates[1], p.ubicacion.coordinates[0]],
          {
            radius: 6,
            color: "white",
            fillColor: "var(--color-primario)",
            fillOpacity: 1,
          }
        )
          .addTo(map)
          .bindPopup(`Parada ${i + 1}: ${p.nombre}`);
      });
      map.fitBounds(rutaPolyline.getBounds());
    } catch (error) {
      console.error(error);
    }
  }
  const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  btnEstoyAqui.addEventListener("click", () => {
    if (navigator.geolocation) {
      btnEstoyAqui.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Obteniendo...';
      btnEstoyAqui.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const myPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          socket.emit("studentAtStop", {
            userId: user.id,
            rutaId: "RUTA_PRUEBA",
            location: myPos,
          });
          alert(`✅ ¡Parada notificada!`);
          btnEstoyAqui.innerHTML =
            '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
          btnEstoyAqui.disabled = false;
        },
        (error) => {
          alert("❌ No se pudo obtener la ubicación.");
          btnEstoyAqui.innerHTML =
            '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
          btnEstoyAqui.disabled = false;
        }
      );
    }
  });
  const btnVerHistorial = document.getElementById("btn-ver-historial");
  btnVerHistorial.addEventListener("click", () =>
    alert("🔗 (Función no implementada) Redirigiendo a Historial...")
  );

  // --- 7. LÓGICA DE MENÚ DE PERFIL ---
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");
  const logoutButton = document.getElementById("logout-button");
  const userNameDisplay = document.getElementById("user-name-display");
  if (user && userNameDisplay) {
    userNameDisplay.textContent = user.nombre.split(" ")[0];
  }
  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("¿Estás seguro de que quieres cerrar sesión?")) {
        localStorage.removeItem("tecbus_token");
        localStorage.removeItem("tecbus_user");
        window.location.href = "index.html";
      }
    });
  }
  window.onclick = function (event) {
    if (profileMenu && !event.target.matches(".profile-icon")) {
      if (profileMenu.classList.contains("show")) {
        profileMenu.classList.remove("show");
      }
    }
  };

  // --- 8. LÓGICA DE PUSH NOTIFICATIONS (¡CON CONVERSIÓN!) ---

  async function initPushNotifications() {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      console.log("Push Notifications Soportadas");
      try {
        const swReg = await navigator.serviceWorker.register("sw.js");
        console.log("Service Worker Registrado:", swReg);

        const readySwReg = await navigator.serviceWorker.ready;
        console.log("Service Worker ¡Listo! (Activo)");

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.warn("Permiso de notificaciones denegado.");
          return;
        }

        let subscription = await readySwReg.pushManager.getSubscription();
        if (subscription === null) {
          console.log("No hay suscripción, creando una nueva...");

          // ¡AQUÍ ESTÁ LA NUEVA LÓGICA DE CONVERSIÓN!
          const vapidPublicKey =
            "BB2W0pmQXVhTWikH1YxYYJb2hMGjqU5aAechud7OzKxJiKH9-8_jWnygraHnh7WzlpuwwXWmLDUI65eosU6cZSs";
          const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey); // Usamos la función de ayuda

          subscription = await readySwReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey, // ¡Pasamos el array binario!
          });
          console.log("Nueva suscripción creada.");
        }

        console.log("Enviando suscripción al backend...");
        await fetch("http://localhost:5000/api/notificaciones/subscribe", {
          method: "POST",
          body: JSON.stringify(subscription),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        console.log("Suscripción guardada en el backend.");

        console.log("Pidiendo predicción...");
        await fetch("http://localhost:5000/api/notificaciones/mi-prediccion", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log("Petición de predicción enviada.");
      } catch (error) {
        console.error("Error con Push Notifications:", error);
      }
    } else {
      console.warn("Push Notifications no soportadas en este navegador.");
    }
  }

  // --- Carga Inicial ---
  fetchAndDrawBuses();
  initPushNotifications(); // ¡Inicia todo el proceso de notificaciones!
});
