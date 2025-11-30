// frontend/assets/js/student_map.js

// Función auxiliar para VAPID keys (Notificaciones Push)
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
  // 1. VERIFICACIÓN DE SESIÓN Y USUARIO
  // ============================================================
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "index.html";
    return;
  }

  const user = JSON.parse(userString);

  // Validación de Rol
  if (user.tipo !== "estudiante") {
    if (user.tipo === "administrador") window.location.href = "admin.html";
    else if (user.tipo === "conductor") window.location.href = "conductor.html";
    return;
  }

  // ============================================================
  // 2. CONFIGURACIÓN DEL MAPA
  // ============================================================
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;
  
  // Conexión Socket.IO
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

  // ============================================================
  // 3. LÓGICA DE PERFIL (MODAL)
  // ============================================================
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilSidebar = document.getElementById("btn-open-perfil-sidebar");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnClosePerfil = document.getElementById("btn-perfil-close");
  const profileMenu = document.getElementById("profile-menu");
  const profileToggle = document.getElementById("profile-toggle");
  const userNameDisplay = document.getElementById("user-name-display");

  // Mostrar nombre corto en header
  if (userNameDisplay) userNameDisplay.textContent = user.nombre.split(" ")[0];

  function abrirPerfil() {
    // Llenar datos del usuario
    document.getElementById("perfil-nombre-completo").textContent = user.nombre || "Usuario";
    // CORRECCIÓN: Usamos user.email (el campo estándar de DB)
    document.getElementById("perfil-correo").textContent = user.email || user.correo || "No registrado";
    document.getElementById("perfil-id").textContent = user.matricula || user._id || "N/A";

    // Cerrar otros menús/sidebars
    document.getElementById("sidebar").classList.remove("active");
    if (profileMenu) profileMenu.classList.remove("show");

    // Abrir modal
    modalPerfil.classList.add("show");
  }

  if (btnOpenPerfilSidebar) btnOpenPerfilSidebar.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnOpenPerfilHeader) btnOpenPerfilHeader.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnClosePerfil) btnClosePerfil.addEventListener("click", () => modalPerfil.classList.remove("show"));

  // Dropdown header
  if (profileToggle) {
      profileToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          profileMenu.classList.toggle("show");
      });
  }

  // Logout
  function handleLogout(e) {
    e.preventDefault();
    if(confirm("¿Cerrar sesión?")) {
        localStorage.removeItem("tecbus_token");
        localStorage.removeItem("tecbus_user");
        window.location.href = "index.html";
    }
  }
  
  const logoutBtn = document.getElementById("logout-button");
  const sidebarLogout = document.getElementById("sidebar-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
  if (sidebarLogout) sidebarLogout.addEventListener("click", handleLogout);


  // ============================================================
  // 4. MENÚ LATERAL (SIDEBAR)
  // ============================================================
  const sidebar = document.getElementById("sidebar");
  const btnMenuToggle = document.getElementById("btn-menu-toggle");
  const btnMenuClose = document.getElementById("btn-menu-close");

  if (btnMenuToggle) btnMenuToggle.addEventListener("click", () => sidebar.classList.add("active"));
  if (btnMenuClose) btnMenuClose.addEventListener("click", () => sidebar.classList.remove("active"));


  // ============================================================
  // 5. HISTORIAL PREDICTIVO (LÓGICA NUEVA)
  // ============================================================
  const modalHistorial = document.getElementById("modal-historial");
  const btnVerHistorial = document.getElementById("btn-ver-historial"); // Botón en el mapa
  const btnCerrarHistorial = document.getElementById("btn-historial-close");

  // Función para guardar búsqueda en DB
  async function registrarBusqueda(rutaId) {
    if (!rutaId) return;

    // Intentar obtener ubicación para el origen
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const location = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            enviarBusquedaAlBackend(rutaId, location);
        }, () => {
            // Si falla geolocalización, enviamos sin ubicación
            enviarBusquedaAlBackend(rutaId, null);
        });
    } else {
        enviarBusquedaAlBackend(rutaId, null);
    }
  }

  async function enviarBusquedaAlBackend(rutaId, location) {
      try {
          await fetch(`${BACKEND_URL}/api/historial`, {
              method: "POST",
              headers: { 
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}` 
              },
              body: JSON.stringify({ rutaId, location })
          });
          console.log("🔍 Búsqueda registrada para análisis.");
      } catch (error) {
          console.error("Error registrando historial:", error);
      }
  }

  // Abrir Modal de Historial
  if (btnVerHistorial) {
      btnVerHistorial.addEventListener("click", async (e) => {
          e.preventDefault();
          modalHistorial.classList.add("show");
          const container = document.getElementById("historial-list-container");
          container.innerHTML = '<p class="horario-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</p>';

          try {
              const response = await fetch(`${BACKEND_URL}/api/historial`, {
                  headers: { Authorization: `Bearer ${token}` }
              });
              const historial = await response.json();

              if (historial.length === 0) {
                  container.innerHTML = '<p class="horario-vacio">No hay búsquedas recientes.</p>';
                  return;
              }

              let html = '';
              historial.forEach(item => {
                  const fecha = new Date(item.createdAt).toLocaleDateString();
                  const origenTexto = item.ubicacionOrigen ? '📍 Ubicación registrada' : '📍 Ubicación desconocida';
                  
                  html += `
                    <div class="horario-item" style="flex-direction: column; align-items: flex-start;">
                        <div style="display:flex; justify-content:space-between; width:100%">
                            <span class="horario-hora" style="color:var(--color-primario); font-weight:bold;">${item.ruta.nombre}</span>
                            <span class="horario-camion" style="font-size:0.85rem;">${fecha} - ${item.horaBusqueda}</span>
                        </div>
                        <small style="color:#888; margin-top:4px;">${origenTexto}</small>
                    </div>
                  `;
              });
              container.innerHTML = html;

          } catch (error) {
              console.error(error);
              container.innerHTML = '<p class="horario-vacio" style="color: #ff6b6b;">Error cargando historial.</p>';
          }
      });
  }

  if (btnCerrarHistorial) btnCerrarHistorial.addEventListener("click", () => modalHistorial.classList.remove("show"));


  // ============================================================
  // 6. CALENDARIO DE HORARIOS (FULLSCREEN)
  // ============================================================
  const fullscreenHorarios = document.getElementById("fullscreen-horarios");
  const btnAbrirHorarios = document.getElementById("btn-open-horarios"); // En sidebar
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const selectRutaCalendar = document.getElementById("calendar-ruta-selector");
  const calendarGrid = document.getElementById("calendario-semanal");

  if (btnAbrirHorarios) {
      btnAbrirHorarios.addEventListener("click", (e) => {
          e.preventDefault();
          sidebar.classList.remove("active");
          fullscreenHorarios.classList.add("active");
          cargarRutasEnSelector(selectRutaCalendar);
      });
  }

  if (btnCerrarHorarios) btnCerrarHorarios.addEventListener("click", () => fullscreenHorarios.classList.remove("active"));

  // Evento al cambiar ruta en Calendario -> Cargar Horarios + Registrar Búsqueda
  if (selectRutaCalendar) {
      selectRutaCalendar.addEventListener("change", async (e) => {
          const rutaId = e.target.value;
          if (!rutaId) {
              calendarGrid.innerHTML = '<p class="placeholder-text">Selecciona una ruta.</p>';
              return;
          }
          
          // 1. Registrar búsqueda en historial
          registrarBusqueda(rutaId);

          // 2. Cargar datos
          calendarGrid.innerHTML = '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';
          try {
              const response = await fetch(`${BACKEND_URL}/api/horarios/publico/${rutaId}`, {
                  headers: { Authorization: `Bearer ${token}` }
              });
              if (!response.ok) throw new Error("Error al obtener horarios");
              const horarios = await response.json();
              dibujarCalendario(horarios);
          } catch (error) {
              console.error(error);
              calendarGrid.innerHTML = '<p class="placeholder-text" style="color:red">Error al cargar calendario.</p>';
          }
      });
  }

  function dibujarCalendario(horarios) {
      const diasOrdenados = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
      const grupos = {};
      diasOrdenados.forEach(d => grupos[d] = []);

      horarios.forEach(h => {
          if (grupos[h.diaSemana]) grupos[h.diaSemana].push(h);
      });

      calendarGrid.innerHTML = "";
      diasOrdenados.forEach(dia => {
          const viajes = grupos[dia];
          let contenido = "";
          
          if (viajes.length === 0) {
              contenido = '<div class="no-service">Sin servicio</div>';
          } else {
              viajes.forEach(v => {
                  contenido += `
                    <div class="cal-item">
                        <span class="cal-time">${v.hora}</span>
                        <span class="cal-bus"><i class="fas fa-bus"></i> ${v.camionUnidad || "?"}</span>
                    </div>`;
              });
          }

          calendarGrid.innerHTML += `
            <div class="day-card">
                <div class="day-header"><h3>${dia}</h3></div>
                <div class="day-body">${contenido}</div>
            </div>`;
      });
  }


  // ============================================================
  // 7. FUNCIONES DEL MAPA (CORE)
  // ============================================================
  
  // Cargar Rutas en Selectores (Mapa y Calendario)
  async function cargarRutasEnSelector(selectorElement) {
     if (selectorElement.options.length > 1) return; // Evitar recargar si ya tiene datos

     try {
         const response = await fetch(`${BACKEND_URL}/api/rutas`, {
             headers: { Authorization: `Bearer ${token}` },
         });
         const rutas = await response.json();
         selectorElement.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
         rutas.forEach(ruta => {
             if (ruta.activa) {
                 selectorElement.innerHTML += `<option value="${ruta._id}">${ruta.nombre}</option>`;
             }
         });
     } catch (error) { console.error("Error cargando rutas:", error); }
  }

  // Selector del Mapa
  const mapRutaSelector = document.getElementById("ruta-selector");
  if (mapRutaSelector) {
      // Cargar inicial
      cargarRutasEnSelector(mapRutaSelector);

      // Evento cambio
      mapRutaSelector.addEventListener("change", (e) => {
          currentRouteId = e.target.value;
          
          // 1. Registrar búsqueda
          registrarBusqueda(currentRouteId);
          
          // 2. Actualizar mapa
          dibujarRuta(currentRouteId);
          filtrarCamionesEnMapa();
      });
  }

  // Dibujar Línea de Ruta
  async function dibujarRuta(rutaId) {
    try {
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      if (!rutaId) return;

      const response = await fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, {
        headers: { Authorization: `Bearer ${token}` } 
      });
      const ruta = await response.json();
      
      if (!ruta.paradas || ruta.paradas.length === 0) return;

      const coordenadas = ruta.paradas.map((p) => [
        p.ubicacion.coordinates[1], // lat
        p.ubicacion.coordinates[0], // lng
      ]);

      rutaPolyline = L.polyline(coordenadas, {
        color: "var(--color-primario)",
        weight: 6,
        opacity: 0.8,
        lineJoin: 'round'
      }).addTo(map);
      
      map.fitBounds(rutaPolyline.getBounds(), { padding: [50, 50] });
    } catch (error) { console.error(error); }
  }

  // Obtener y dibujar camiones
  async function fetchAndUpdateBuses() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/camiones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const camiones = await response.json();

      camiones.forEach((camion) => {
        if (camion.estado !== "activo" || !camion.ubicacionActual) return;
        const rutaId = camion.rutaAsignada ? camion.rutaAsignada._id : null;

        // Si ya existe, actualizar
        if (busMarkers[camion._id]) {
            busMarkers[camion._id].setLatLng([
                camion.ubicacionActual.coordinates[1], 
                camion.ubicacionActual.coordinates[0]
            ]);
            busMarkers[camion._id].rutaId = rutaId; // Actualizar ref ruta
        } else {
            // Crear nuevo
            const marker = L.marker(
                [camion.ubicacionActual.coordinates[1], camion.ubicacionActual.coordinates[0]], 
                { icon: busIcon }
            ).bindPopup(`🚍 **${camion.numeroUnidad}**<br>Ruta: ${camion.rutaAsignada ? camion.rutaAsignada.nombre : 'Sin asignar'}`);
            
            marker.rutaId = rutaId; 
            busMarkers[camion._id] = marker;
        }
      });
      filtrarCamionesEnMapa();
    } catch (error) { console.error(error); }
  }

  function filtrarCamionesEnMapa() {
    Object.values(busMarkers).forEach(marker => {
        if (!currentRouteId) { 
            map.removeLayer(marker); 
            return; 
        }
        // Mostrar solo si coincide con la ruta seleccionada
        if (marker.rutaId === currentRouteId) {
            if (!map.hasLayer(marker)) marker.addTo(map);
        } else {
            if (map.hasLayer(marker)) map.removeLayer(marker);
        }
    });
  }

  // Sockets: Actualización en vivo
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
      // Si es nuevo, recargar todo
      fetchAndUpdateBuses();
    }
  });

  // Alerta Inteligente (Predictiva)
  socket.on("smartAlert", (data) => {
      alert(`🤖 ALERTA INTELIGENTE:\n\n${data.mensaje}`);
      // Aquí también podrías usar Notification API si el navegador lo permite
  });


  // Botón "Estoy Aquí"
  const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  if (btnEstoyAqui) {
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
            (error) => {
              alert("❌ No se pudo obtener la ubicación.");
              btnEstoyAqui.innerHTML = '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
              btnEstoyAqui.disabled = false;
            }
          );
        }
      });
  }

  // Cerrar todo al hacer clic fuera de elementos
  window.addEventListener("click", (e) => {
    // Cerrar modal perfil
    if (e.target === modalPerfil) modalPerfil.classList.remove("show");
    // Cerrar modal historial
    if (modalHistorial && e.target === modalHistorial) modalHistorial.classList.remove("show");
    // Cerrar sidebar (si clic fuera y no en el botón)
    if (sidebar.classList.contains("active") && !sidebar.contains(e.target) && !e.target.closest("#btn-menu-toggle")) {
        sidebar.classList.remove("active");
    }
    // Cerrar menú perfil dropdown
    if (profileMenu && profileMenu.classList.contains("show") && !profileMenu.contains(e.target) && !e.target.closest("#profile-toggle")) {
        profileMenu.classList.remove("show");
    }
  });


  // INICIALIZACIÓN
  fetchAndUpdateBuses();
  // Polling de respaldo cada 10s
  setInterval(fetchAndUpdateBuses, 10000);
});