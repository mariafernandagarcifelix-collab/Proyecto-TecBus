// frontend/assets/js/student_map.js

// Función auxiliar para convertir la llave VAPID (Notificaciones)
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
  // ============================================================
  // 1. VERIFICACIÓN DE SESIÓN
  // ============================================================
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "index.html";
    return;
  }
  const user = JSON.parse(userString);

  // Validación de rol (solo estudiantes)
  if (user.tipo !== "estudiante") {
      if (user.tipo === "administrador") window.location.href = "admin.html";
      else if (user.tipo === "conductor") window.location.href = "conductor.html";
      return;
  }

  // ============================================================
  // 2. LÓGICA DE "MI PERFIL" (MODAL)
  // ============================================================
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilSidebar = document.getElementById("btn-open-perfil-sidebar");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnClosePerfil = document.getElementById("btn-perfil-close");
  const profileMenu = document.getElementById("profile-menu");
  const profileToggle = document.getElementById("profile-toggle");

  // Mostrar nombre en el header
  const userNameDisplay = document.getElementById("user-name-display");
  if (userNameDisplay) userNameDisplay.textContent = user.nombre.split(" ")[0];

  function abrirPerfil() {
    // Llenar datos en el modal
    document.getElementById("perfil-nombre-completo").textContent = user.nombre || "Usuario";
    document.getElementById("perfil-correo").textContent = user.email || "No registrado";
    // Usamos matricula o ID como fallback
    document.getElementById("perfil-id").textContent = user.matricula || user.id || "N/A";

    // Cerrar otros menús
    document.getElementById("sidebar").classList.remove("active");
    if (profileMenu) profileMenu.classList.remove("show");

    // Mostrar modal
    modalPerfil.classList.add("show");
  }

  // Event Listeners para Perfil
  if (btnOpenPerfilSidebar) btnOpenPerfilSidebar.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnOpenPerfilHeader) btnOpenPerfilHeader.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  
  if (btnClosePerfil) btnClosePerfil.addEventListener("click", () => {
      modalPerfil.classList.remove("show");
  });

  // Toggle del menú rápido superior
  if (profileToggle) {
      profileToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          profileMenu.classList.toggle("show");
      });
  }

  // Cerrar modales al hacer clic fuera
  window.addEventListener("click", (e) => {
    if (e.target === modalPerfil) modalPerfil.classList.remove("show");
    if (profileMenu && !profileMenu.contains(e.target) && e.target !== profileToggle) {
        profileMenu.classList.remove("show");
    }
  });

  // Logout
  const handleLogout = (e) => {
      e.preventDefault();
      if(confirm("¿Cerrar sesión?")) {
          localStorage.removeItem("tecbus_token");
          localStorage.removeItem("tecbus_user");
          window.location.href = "index.html";
      }
  };
  document.getElementById("logout-button").addEventListener("click", handleLogout);
  document.getElementById("sidebar-logout").addEventListener("click", handleLogout);


  // ============================================================
  // 3. MAPA Y SOCKETS
  // ============================================================
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;
  const socket = io(SOCKET_URL);

  let busMarkers = {};
  let rutaPolyline = null;
  let currentRouteId = "";

  const map = L.map("map").setView([initialLat, initialLng], initialZoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);

  const busIcon = L.divIcon({
    className: "custom-bus-icon",
    html: `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; color: white; border: 2px solid white; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.5);"><i class="fas fa-bus"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  // --- Cargar Rutas en Mapa ---
  async function cargarRutasMapa() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rutas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rutas = await response.json();
      const selector = document.getElementById("ruta-selector");
      selector.innerHTML = '<option value="">Selecciona una ruta para ver...</option>';
      rutas.forEach((ruta) => {
        if (ruta.activa) selector.innerHTML += `<option value="${ruta._id}">${ruta.nombre}</option>`;
      });
    } catch (error) { console.error("Error:", error); }
  }

  // --- Actualizar Camiones ---
  async function fetchAndUpdateBuses() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/camiones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const camiones = await response.json();

      camiones.forEach((camion) => {
        if (camion.estado !== "activo" || !camion.ubicacionActual) return;
        const rutaId = camion.rutaAsignada ? camion.rutaAsignada._id : null;

        if (busMarkers[camion._id]) {
          busMarkers[camion._id].setLatLng([
            camion.ubicacionActual.coordinates[1],
            camion.ubicacionActual.coordinates[0],
          ]);
          busMarkers[camion._id].rutaId = rutaId;
        } else {
          const marker = L.marker(
            [camion.ubicacionActual.coordinates[1], camion.ubicacionActual.coordinates[0]],
            { icon: busIcon }
          ).bindPopup(
            `🚍 **${camion.numeroUnidad}**<br>Ruta: ${camion.rutaAsignada ? camion.rutaAsignada.nombre : "Sin asignar"}`
          );
          marker.rutaId = rutaId;
          busMarkers[camion._id] = marker;
        }
      });
      filtrarCamionesEnMapa();
    } catch (error) { console.error(error); }
  }

  function filtrarCamionesEnMapa() {
    Object.values(busMarkers).forEach((marker) => {
      if (!currentRouteId) {
        map.removeLayer(marker);
        return;
      }
      if (marker.rutaId === currentRouteId) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
      }
    });
  }

  async function dibujarRuta(rutaId) {
    try {
      if (!rutaId) {
        if (rutaPolyline) map.removeLayer(rutaPolyline);
        return;
      }
      const response = await fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ruta = await response.json();
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      if (!ruta.paradas || ruta.paradas.length === 0) return;

      const coordenadas = ruta.paradas.map((p) => [
        p.ubicacion.coordinates[1],
        p.ubicacion.coordinates[0],
      ]);

      rutaPolyline = L.polyline(coordenadas, {
        color: "var(--color-primario)",
        weight: 6,
        opacity: 0.8,
        lineJoin: "round",
      }).addTo(map);
      map.fitBounds(rutaPolyline.getBounds(), { padding: [50, 50] });
    } catch (error) { console.error(error); }
  }

  // Listeners de Mapa
  document.getElementById("ruta-selector").addEventListener("change", (e) => {
    currentRouteId = e.target.value;
    dibujarRuta(currentRouteId);
    filtrarCamionesEnMapa();
  });

  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
      fetchAndUpdateBuses();
    }
  });

  // Botón "Estoy Aquí"
  const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  btnEstoyAqui.addEventListener("click", () => {
    if (navigator.geolocation) {
      btnEstoyAqui.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
      btnEstoyAqui.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const myPos = { lat: position.coords.latitude, lng: position.coords.longitude };
          socket.emit("studentAtStop", {
            userId: user.id,
            rutaId: currentRouteId || "SIN_RUTA",
            location: myPos,
          });
          alert(`✅ ¡Parada notificada!`);
          btnEstoyAqui.innerHTML = '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
          btnEstoyAqui.disabled = false;
        },
        () => {
          alert("❌ No se pudo obtener la ubicación.");
          btnEstoyAqui.innerHTML = '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
          btnEstoyAqui.disabled = false;
        }
      );
    }
  });


  // ============================================================
  // 4. MENÚ LATERAL (SIDEBAR)
  // ============================================================
  const sidebar = document.getElementById("sidebar");

  document.getElementById("btn-menu-toggle").addEventListener("click", () => {
    sidebar.classList.add("active");
  });
  document.getElementById("btn-menu-close").addEventListener("click", () => {
    sidebar.classList.remove("active");
  });
  
  // Clic fuera del sidebar para cerrar
  document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("active") && !sidebar.contains(e.target) && !e.target.closest("#btn-menu-toggle")) {
      sidebar.classList.remove("active");
    }
  });


  // ============================================================
  // 5. CALENDARIO DE HORARIOS (FULLSCREEN GRID)
  // ============================================================
  
  const fullscreenContainer = document.getElementById("fullscreen-horarios");
  const btnAbrirHorarios = document.getElementById("btn-open-horarios");
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const selectRutaCalendar = document.getElementById("calendar-ruta-selector");
  const calendarGrid = document.getElementById("calendario-semanal");

  // Abrir vista calendario
  if (btnAbrirHorarios) {
      btnAbrirHorarios.addEventListener("click", (e) => {
          e.preventDefault();
          sidebar.classList.remove("active"); // Cerrar menú lateral
          fullscreenContainer.classList.add("active"); // Mostrar overlay
          cargarRutasEnSelectorCalendario();
      });
  }

  // Cerrar vista calendario
  if (btnCerrarHorarios) {
      btnCerrarHorarios.addEventListener("click", () => {
          fullscreenContainer.classList.remove("active");
      });
  }

  // Función para cargar rutas en el select grande
  async function cargarRutasEnSelectorCalendario() {
      if (selectRutaCalendar.options.length > 1) return; // Ya cargado

      try {
          const response = await fetch(`${BACKEND_URL}/api/rutas`, {
              headers: { Authorization: `Bearer ${token}` },
          });
          const rutas = await response.json();
          
          selectRutaCalendar.innerHTML = '<option value="">-- Elige una ruta --</option>';
          rutas.forEach(ruta => {
              if(ruta.activa) {
                  selectRutaCalendar.innerHTML += `<option value="${ruta._id}">${ruta.nombre}</option>`;
              }
          });
      } catch (error) {
          console.error("Error cargando rutas:", error);
      }
  }

  // Evento al cambiar ruta -> Dibujar Calendario
  selectRutaCalendar.addEventListener("change", async (e) => {
      const rutaId = e.target.value;
      
      if (!rutaId) {
          calendarGrid.innerHTML = '<p class="placeholder-text">Selecciona una ruta arriba.</p>';
          return;
      }

      calendarGrid.innerHTML = '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando calendario...</p>';

      try {
          // Usar la ruta pública corregida
          const response = await fetch(`${BACKEND_URL}/api/horarios/publico/${rutaId}`, {
              headers: { Authorization: `Bearer ${token}` }
          });
          
          if (!response.ok) throw new Error("Error al obtener horarios");
          const horarios = await response.json();

          dibujarCalendario(horarios);

      } catch (error) {
          console.error(error);
          calendarGrid.innerHTML = '<p class="placeholder-text" style="color: #ff6b6b;">Error al cargar datos.</p>';
      }
  });

  // Función Renderizadora del Grid
  function dibujarCalendario(horarios) {
      // Días para las columnas
      const diasOrdenados = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
      
      // Agrupar horarios por día
      const grupos = {};
      diasOrdenados.forEach(d => grupos[d] = []); 

      horarios.forEach(h => {
          // El backend ya devuelve "Lunes", "Martes" (con mayúscula y tildes)
          if (grupos[h.diaSemana]) {
              grupos[h.diaSemana].push(h);
          }
      });

      // Limpiar y llenar grid
      calendarGrid.innerHTML = ""; 

      diasOrdenados.forEach(dia => {
          const viajesDelDia = grupos[dia] || [];
          
          let contenidoViajes = "";
          if (viajesDelDia.length === 0) {
              contenidoViajes = '<div class="no-service">Sin servicio</div>';
          } else {
              viajesDelDia.forEach(viaje => {
                  contenidoViajes += `
                    <div class="cal-item">
                        <span class="cal-time">${viaje.hora}</span>
                        <span class="cal-bus"><i class="fas fa-bus"></i> ${viaje.camionUnidad || "?"}</span>
                    </div>
                  `;
              });
          }

          const cardHTML = `
            <div class="day-card">
                <div class="day-header">
                    <h3>${dia}</h3>
                </div>
                <div class="day-body">
                    ${contenidoViajes}
                </div>
            </div>
          `;
          
          calendarGrid.innerHTML += cardHTML;
      });
  }


  // ============================================================
  // 6. INICIALIZACIÓN GENERAL
  // ============================================================
  cargarRutasMapa();
  fetchAndUpdateBuses();
  setInterval(fetchAndUpdateBuses, 10000);
});