// frontend/assets/js/driver_map.js

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICACIÓN DE SEGURIDAD ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "index.html";
    return;
  }
  const user = JSON.parse(userString);
  if (user.tipo !== "conductor") {
    alert("Acceso denegado. No eres conductor.");
    window.location.href = "index.html";
    return;
  }

  // --- 2. CONFIGURACIÓN INICIAL ---
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;

  // ¡NUEVO! Esta variable se llenará dinámicamente
  let MI_CAMION_ID = null;

  const socket = io("http://localhost:5000");
  socket.on("connect", () => {
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id);
  });

  // --- 3. INICIALIZACIÓN DEL MAPA ---
  const map = L.map("map").setView([initialLat, initialLng], initialZoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 20,
  }).addTo(map);

  const driverIcon = L.divIcon({
    className: "custom-driver-icon",
    html: '<div style="background-color: var(--color-primario); border-radius: 50%; width: 35px; height: 35px; display: flex; justify-content: center; align-items: center; color: white; border: 3px solid white; font-size: 20px;">🚌</div>',
    iconSize: [35, 35],
    iconAnchor: [17, 17],
  });

  const driverMarker = L.marker([initialLat, initialLng], { icon: driverIcon })
    .addTo(map)
    .bindPopup("Tu ubicación")
    .openPopup();

  // --- ¡NUEVO! FUNCIÓN PARA OBTENER EL CAMIÓN ASIGNADO ---
  async function getCamionAsignado() {
    try {
      const response = await fetch(
        "http://localhost:5000/api/users/mi-camion",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`, // ¡Usamos el token para identificarnos!
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message);
      }

      // ¡ÉXITO! Guardamos el ID del camión
      MI_CAMION_ID = data.camionId;
      console.log(`Camión asignado: ${MI_CAMION_ID}`);
      // Ahora que tenemos el ID, iniciamos la geolocalización
      iniciarGeolocalizacion();
    } catch (error) {
      console.error(error);
      alert(`Error: ${error.message}`);
      // Si no podemos obtener un camión, no tiene sentido transmitir
    }
  }

  // --- 4. LÓGICA DE GEOLOCALIZACIÓN (EL EMISOR) ---
  function iniciarGeolocalizacion() {
    if ("geolocation" in navigator) {
      console.log("Iniciando geolocalización...");

      navigator.geolocation.watchPosition(
        (position) => {
          const newPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };

          driverMarker.setLatLng(newPos);
          map.panTo(newPos);

          // ¡"Grita" la ubicación al servidor!
          if (MI_CAMION_ID) {
            // Solo si tenemos un ID
            socket.emit("driverLocationUpdate", {
              camionId: MI_CAMION_ID,
              location: newPos,
            });
          }
        },
        (error) => {
          console.error("Error de geolocalización:", error);
          alert("No se pudo obtener tu ubicación. Asegúrate de dar permisos.");
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    } else {
      console.error("Geolocalización no disponible");
      alert("Tu navegador no soporta geolocalización.");
    }
  }

  // --- 5. LÓGICA DEL MODAL DE INCIDENTES ---
  // (Este código es idéntico, pero ahora usará el MI_CAMION_ID dinámico)
  const modal = document.getElementById("incident-modal");
  const modalContent = modal.querySelector(".modal-content");
  const btnReporte = document.getElementById("btn-reporte-incidente");
  const spanClose = modal.querySelector(".close-button");
  const btnSend = document.getElementById("send-incident");
  const selectIncident = document.getElementById("incident-type");
  const textDetails = document.getElementById("incident-details");

  btnReporte.onclick = () => modal.classList.add("modal-visible");
  spanClose.onclick = () => modal.classList.remove("modal-visible");
  window.onclick = (event) => {
    if (event.target == modal) modal.classList.remove("modal-visible");
  };

  btnSend.onclick = () => {
    const incidentType = selectIncident.value;
    const incidentDetails = textDetails.value;

    if (incidentType && MI_CAMION_ID) {
      socket.emit("incidentReport", {
        camionId: MI_CAMION_ID,
        tipo: incidentType,
        detalles: incidentDetails,
        hora: new Date().toISOString(),
      });

      modal.classList.remove("modal-visible");

      btnReporte.innerHTML =
        '<i class="fas fa-check-circle"></i> ¡Alerta Enviada!';
      btnReporte.style.backgroundColor = "var(--color-exito)";
      btnReporte.disabled = true;

      selectIncident.value = "";
      textDetails.value = "";

      setTimeout(() => {
        btnReporte.innerHTML =
          '<i class="fas fa-exclamation-triangle"></i> Reportar Incidente';
        btnReporte.style.backgroundColor = "";
        btnReporte.disabled = false;
      }, 5000);
    } else if (!MI_CAMION_ID) {
      alert("Error: No se ha podido identificar tu camión.");
    } else {
      modalContent.classList.add("shake");
      setTimeout(() => modalContent.classList.remove("shake"), 500);
    }
  };

  // --- ¡NUEVO! INICIAMOS EL PROCESO ---
  getCamionAsignado();
  // --- 6. ¡NUEVO! LÓGICA DE MENÚ DE PERFIL ---
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");
  const logoutButton = document.getElementById("logout-button");
  const userNameDisplay = document.getElementById("user-name-display");

  // Poner el nombre del usuario en el menú
  if (user && userNameDisplay) {
    // Muestra solo el primer nombre
    userNameDisplay.textContent = user.nombre.split(" ")[0];
  }

  // Abrir/Cerrar el menú
  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation(); // Evita que el clic se cierre solo
      profileMenu.classList.toggle("show");
    });
  }

  // Lógica de Cerrar Sesión (ahora en el botón)
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

  // Cerrar el menú si se hace clic fuera
  window.onclick = function (event) {
    if (profileMenu && !event.target.matches(".profile-icon")) {
      if (profileMenu.classList.contains("show")) {
        profileMenu.classList.remove("show");
      }
    }
  };
});
