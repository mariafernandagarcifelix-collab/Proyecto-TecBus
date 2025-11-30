// frontend/assets/js/driver_map.js

document.addEventListener("DOMContentLoaded", () => {
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

  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;
  let MI_CAMION_ID = null;
  let MI_RUTA_NOMBRE = "Sin Ruta Asignada";

  const busDisplay = document.getElementById("driver-bus-display");
  const routeDisplay = document.getElementById("driver-route-display");
  const statusDisplay = document.getElementById("service-status");
  const headerDisplay = document.getElementById("header-bus-display");

  // Configuración de Socket.IO
  const socket = io(SOCKET_URL);
  socket.on("connect", () => {
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id);
  });

  // Configuración del Mapa
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

  // --- UTILIDADES ---

  function obtenerDiaSemana() {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return dias[new Date().getDay()];
  }

  // Mapa para convertir el día "crudo" de JS al formato bonito que envía el Backend
  const mapaDiasBackend = {
    "lunes": "Lunes",
    "martes": "Martes",
    "miercoles": "Miércoles",
    "jueves": "Jueves",
    "viernes": "Viernes",
    "sabado": "Sábado",
    "domingo": "Domingo"
  };

  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(':');
    return parseInt(h) * 60 + parseInt(m);
  }

  // --- LÓGICA PRINCIPAL ---

  async function actualizarEstadoConductor() {
    try {
      // -------------------------------------------------
      // PASO 1: Obtener mi camión
      // -------------------------------------------------
      const resCamion = await fetch(BACKEND_URL + "/api/users/mi-camion", {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!resCamion.ok) throw new Error("Error al consultar camión asignado");
      const dataCamion = await resCamion.json();

      let textoCamion = "Sin Unidad Asignada";
      let unidad = null;

      if (dataCamion && dataCamion.camionId) {
         MI_CAMION_ID = dataCamion.camionId;
         const placa = dataCamion.placa; 
         unidad = dataCamion.numeroUnidad;

         // Formato inteligente de texto
         if (unidad && placa) {
             textoCamion = `Unidad ${unidad} (${placa})`;
         } else if (unidad) {
             textoCamion = `Unidad ${unidad}`;
         } else {
             textoCamion = "Unidad Registrada"; 
         }
      } else {
         MI_CAMION_ID = null;
      }

      // Actualizar UI de camión
      if (headerDisplay) headerDisplay.textContent = textoCamion;
      if (busDisplay) busDisplay.textContent = textoCamion;

      // Si no tengo camión, paramos aquí
      if (!MI_CAMION_ID) {
          routeDisplay.textContent = "--";
          statusDisplay.textContent = "● Sin Asignación";
          statusDisplay.style.color = "gray";
          return;
      }

      // -------------------------------------------------
      // PASO 2: Obtener Horarios y Calcular Ruta
      // -------------------------------------------------
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // CORRECCIÓN IMPORTANTE: Verificar si la petición de horarios falló
      if (!resHorarios.ok) throw new Error("Error cargando horarios");

      const todosHorarios = await resHorarios.json();

      // Validación extra: asegurar que es un array
      if (!Array.isArray(todosHorarios)) throw new Error("Formato de horarios inválido");

      const hoyRaw = obtenerDiaSemana(); // ej: "miercoles"
      const hoyFormatted = mapaDiasBackend[hoyRaw]; // ej: "Miércoles" (Como viene del backend)

      // Filtrar: Coincide el día Y (Coincide el camión POR UNIDAD o POR ID)
      const misSalidasHoy = todosHorarios.filter(h => {
          const esHoy = (h.diaSemana === hoyFormatted); // Comparación exacta con acentos
          const esMiCamion = String(h.camionUnidad) === String(unidad);
          return esHoy && esMiCamion;
      });

      // -------------------------------------------------
      // PASO 3: Determinar Estado (En Servicio / Fuera)
      // -------------------------------------------------
      if (misSalidasHoy.length === 0) {
        routeDisplay.textContent = "Sin Recorridos Hoy";
        statusDisplay.textContent = "● Fuera de Servicio";
        statusDisplay.className = "status-indicator status-off";
        statusDisplay.style.color = "gray";
        return;
      }

      // Tomamos la ruta del primer resultado (asumimos misma ruta todo el día para simplificar)
      MI_RUTA_NOMBRE = misSalidasHoy[0].rutaNombre || "Ruta Desconocida";
      routeDisplay.textContent = MI_RUTA_NOMBRE;

      // Ordenar por hora para encontrar la última vuelta
      misSalidasHoy.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));
      
      const ultimaSalida = misSalidasHoy[misSalidasHoy.length - 1].hora;
      const now = new Date();
      const horaActual = now.getHours() * 60 + now.getMinutes();
      const horaLimite = horaAEntero(ultimaSalida) + 90; // 90 min de tolerancia tras última salida

      if (horaActual > horaLimite) {
        statusDisplay.innerHTML = "● Fuera de Servicio";
        statusDisplay.className = "status-indicator status-off";
        statusDisplay.style.color = "var(--color-error)"; // Rojo definido en CSS
      } else {
        statusDisplay.innerHTML = `● En Servicio (Fin: ${ultimaSalida})`;
        statusDisplay.className = "status-indicator status-on";
        statusDisplay.style.color = "var(--color-exito)"; // Verde definido en CSS
        
        // Solo iniciamos GPS si está en servicio y tiene camión
        iniciarGeolocalizacion(); 
      }

    } catch (error) {
      console.error("Error dashboard conductor:", error);
      routeDisplay.textContent = "Error de datos";
      statusDisplay.textContent = "● Reintentando...";
      statusDisplay.style.color = "orange";
    }
  }

  // Geolocation Logic
  function iniciarGeolocalizacion() {
    if ("geolocation" in navigator) {
      // Evitamos reiniciar el watcher si ya existe (opcional, pero buena práctica)
      if (window.geoWatchId) return; 

      console.log("📍 Iniciando GPS...");
      window.geoWatchId = navigator.geolocation.watchPosition(
        (position) => {
          const newPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };

          driverMarker.setLatLng(newPos);
          map.panTo(newPos);

          if (MI_CAMION_ID && socket.connected) {
            socket.emit("driverLocationUpdate", {
              camionId: MI_CAMION_ID,
              location: newPos,
            });
          }
        },
        (error) => console.warn("Error GPS:", error.message),
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    }
  }

  // --- MODAL DE INCIDENTES ---
  const modal = document.getElementById("incident-modal");
  const btnReporte = document.getElementById("btn-reporte-incidente");
  const spanClose = modal.querySelector(".close-button");
  const btnSend = document.getElementById("send-incident");
  
  if(btnReporte) {
      btnReporte.onclick = () => modal.classList.add("modal-visible");
      spanClose.onclick = () => modal.classList.remove("modal-visible");
      window.onclick = (event) => {
        if (event.target == modal) modal.classList.remove("modal-visible");
      };

      btnSend.onclick = () => {
        const incidentType = document.getElementById("incident-type").value;
        const incidentDetails = document.getElementById("incident-details").value;

        if (incidentType && MI_CAMION_ID) {
          socket.emit("incidentReport", {
            camionId: MI_CAMION_ID,
            tipo: incidentType,
            detalles: incidentDetails,
            hora: new Date().toISOString(),
          });

          modal.classList.remove("modal-visible");
          alert("Incidente reportado correctamente");
          
          // Limpiar formulario
          document.getElementById("incident-type").value = "";
          document.getElementById("incident-details").value = "";
        } else {
          alert("Por favor selecciona un tipo de incidente");
        }
      };
  }

  // --- MENU PERFIL ---
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");
  const logoutButton = document.getElementById("logout-button");
  
  if(user) document.getElementById("user-name-display").textContent = user.nombre.split(" ")[0];

  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("¿Cerrar sesión?")) {
        localStorage.removeItem("tecbus_token");
        localStorage.removeItem("tecbus_user");
        window.location.href = "index.html";
      }
    });
  }

  // Iniciar lógica
  actualizarEstadoConductor();
  setInterval(actualizarEstadoConductor, 60000); // Actualizar cada minuto
});