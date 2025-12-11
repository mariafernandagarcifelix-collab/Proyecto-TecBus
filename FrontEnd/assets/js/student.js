// frontend/assets/js/student_map.js

// Función auxiliar para VAPID keys (Notificaciones Push)
// function urlBase64ToUint8Array(base64String) {
//   const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
//   const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
//   const rawData = window.atob(base64);
//   const outputArray = new Uint8Array(rawData.length);
//   for (let i = 0; i < rawData.length; ++i) {
//     outputArray[i] = rawData.charCodeAt(i);
//   }
//   return outputArray;
// }

// frontend/assets/js/student_map.js

// 1. Tu Clave Pública VAPID (Debe coincidir con la privada del Backend)
// Si no la tienes, genérala con: npx web-push generate-vapid-keys
const PUBLIC_VAPID_KEY =
  "BB2W0pmQXVhTWikH1YxYYJb2hMGjqU5aAechud7OzKxJiKH9-8_jWnygraHnh7WzlpuwwXWmLDUI65eosU6cZSs";

// 2. Utilidad para convertir la clave (Necesario para Chrome/Brave antiguos y Safari)
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
  const userS = userString ? JSON.parse(userString) : null;

  if (user && user.tipo === "estudiante") {
        const userId = user._id || user.id; // Asegurar compatibilidad de ID
        fetch(`${BACKEND_URL}/api/users/${userId}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ estado: "activo" }) 
        }).catch(err => console.error("Error activando estudiante:", err));
    }

  const btnNotif = document.getElementById("btn-activar-notificaciones");
  if (btnNotif) {
    // Clonamos el botón para eliminar eventos anteriores y evitar dobles clics
    const newBtn = btnNotif.cloneNode(true);
    btnNotif.parentNode.replaceChild(newBtn, btnNotif);
    newBtn.addEventListener("click", activarNotificaciones);
    console.log("✅ Botón de notificaciones activado");
  }

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

  const studentIcon = L.divIcon({
    className: "student-icon",
    html: `<div style="
        background-color: #ffc107; 
        color: #000;
        width: 35px; height: 35px; 
        border-radius: 50%; 
        border: 2px solid white; 
        display: flex; justify-content: center; align-items: center;
        box-shadow: 0 4px 8px rgba(0,0,0,0.4);
        font-size: 16px;">
        <i class="fas fa-street-view"></i>
    </div>`,
    iconSize: [35, 35],
    iconAnchor: [17, 35], // La punta abajo al centro
    popupAnchor: [0, -35]
  });

  // ============================================================
  // 3. LÓGICA DE PERFIL (MODAL)
  // ============================================================
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilSidebar = document.getElementById(
    "btn-open-perfil-sidebar"
  );
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnClosePerfil = document.getElementById("btn-perfil-close");
  const profileMenu = document.getElementById("profile-menu");
  const profileToggle = document.getElementById("profile-toggle");
  const userNameDisplay = document.getElementById("user-name-display");

  // Mostrar nombre corto en header
  if (userNameDisplay) userNameDisplay.textContent = user.nombre.split(" ")[0];

  function abrirPerfil() {
    // Llenar datos del usuario
    document.getElementById("perfil-nombre-completo").textContent =
      user.nombre || "Usuario";
    // CORRECCIÓN: Usamos user.email (el campo estándar de DB)
    document.getElementById("perfil-correo").textContent =
      user.email || user.correo || "No registrado";
    //document.getElementById("perfil-id").textContent = user.matricula || user._id || "N/A";
    // --- LÓGICA DE ID MEJORADA (BUSCADOR INTELIGENTE) ---
    let idMostrar = "N/A";

    // 1. Intenta buscar Matricula dentro del sub-objeto estudiante
    if (user.estudiante && user.estudiante.matricula) {
        idMostrar = user.estudiante.matricula;
    } 
    // 2. Intenta buscar Matricula en la raíz (por si acaso)
    else if (user.matricula) {
        idMostrar = user.matricula; 
    } 
    // 3. Si no hay matricula, usa el ID de MongoDB (el largo)
    else if (user._id) {
        idMostrar = user._id; 
    } 
    // 4. Intenta 'id' simple
    else if (user.id) {
        idMostrar = user.id;
    }

    console.log("👤 Datos de usuario cargados:", user); // Abre la consola (F12) para ver qué datos tiene realmente el usuario
    document.getElementById("perfil-id").textContent = idMostrar;

    // Cerrar otros menús/sidebars
    document.getElementById("sidebar").classList.remove("active");
    if (profileMenu) profileMenu.classList.remove("show");

    // Abrir modal
    modalPerfil.classList.add("show");
  }

  if (btnOpenPerfilSidebar)
    btnOpenPerfilSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });
  if (btnOpenPerfilHeader)
    btnOpenPerfilHeader.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });
  if (btnClosePerfil)
    btnClosePerfil.addEventListener("click", () =>
      modalPerfil.classList.remove("show")
    );

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
    if (confirm("¿Cerrar sesión?")) {
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

  if (btnMenuToggle)
    btnMenuToggle.addEventListener("click", () =>
      sidebar.classList.add("active")
    );
  if (btnMenuClose)
    btnMenuClose.addEventListener("click", () =>
      sidebar.classList.remove("active")
    );

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
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          enviarBusquedaAlBackend(rutaId, location);
        },
        () => {
          // Si falla geolocalización, enviamos sin ubicación
          enviarBusquedaAlBackend(rutaId, null);
        }
      );
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rutaId, location }),
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
      container.innerHTML =
        '<p class="horario-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</p>';

      try {
        const response = await fetch(`${BACKEND_URL}/api/historial`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const historial = await response.json();

        if (historial.length === 0) {
          container.innerHTML =
            '<p class="horario-vacio">No hay búsquedas recientes.</p>';
          return;
        }

        let html = "";
        historial.forEach((item) => {
          const fecha = new Date(item.createdAt).toLocaleDateString();
          const origenTexto = item.ubicacionOrigen
            ? "📍 Ubicación registrada"
            : "📍 Ubicación desconocida";

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
        container.innerHTML =
          '<p class="horario-vacio" style="color: #ff6b6b;">Error cargando historial.</p>';
      }
    });
  }

  if (btnCerrarHistorial)
    btnCerrarHistorial.addEventListener("click", () =>
      modalHistorial.classList.remove("show")
    );

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

  if (btnCerrarHorarios)
    btnCerrarHorarios.addEventListener("click", () =>
      fullscreenHorarios.classList.remove("active")
    );

  // Evento al cambiar ruta en Calendario -> Cargar Horarios + Registrar Búsqueda
  if (selectRutaCalendar) {
    selectRutaCalendar.addEventListener("change", async (e) => {
      const rutaId = e.target.value;
      if (!rutaId) {
        calendarGrid.innerHTML =
          '<p class="placeholder-text">Selecciona una ruta.</p>';
        return;
      }

      // 1. Registrar búsqueda en historial
      registrarBusqueda(rutaId);

      // 2. Cargar datos
      calendarGrid.innerHTML =
        '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';
      try {
        const response = await fetch(
          `${BACKEND_URL}/api/horarios/publico/${rutaId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!response.ok) throw new Error("Error al obtener horarios");
        const horarios = await response.json();
        dibujarCalendario(horarios);
      } catch (error) {
        console.error(error);
        calendarGrid.innerHTML =
          '<p class="placeholder-text" style="color:red">Error al cargar calendario.</p>';
      }
    });
  }

  function dibujarCalendario(horarios) {
    const diasOrdenados = [
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ];
    const grupos = {};
    diasOrdenados.forEach((d) => (grupos[d] = []));

    horarios.forEach((h) => {
      if (grupos[h.diaSemana]) grupos[h.diaSemana].push(h);
    });

    calendarGrid.innerHTML = "";
    diasOrdenados.forEach((dia) => {
      const viajes = grupos[dia];
      let contenido = "";

      if (viajes.length === 0) {
        contenido = '<div class="no-service">Sin servicio</div>';
      } else {
        viajes.forEach((v) => {
          contenido += `
                    <div class="cal-item">
                        <span class="cal-time">${v.hora}</span>
                        <span class="cal-bus"><i class="fas fa-bus"></i> ${
                          v.camionUnidad || "?"
                        }</span>
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
      selectorElement.innerHTML =
        '<option value="">-- Selecciona una ruta --</option>';
      rutas.forEach((ruta) => {
        if (ruta.activa) {
          selectorElement.innerHTML += `<option value="${ruta._id}">${ruta.nombre}</option>`;
        }
      });
    } catch (error) {
      console.error("Error cargando rutas:", error);
    }
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
  // Dibujar Línea de Ruta (Con soporte para Trazado Manual)
  let stopMarkers = []; // Arreglo para guardar los marcadores de paradas y borrarlos al cambiar

  async function dibujarRuta(rutaId) {
    try {
      // 1. Limpiar mapa anterior
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      stopMarkers.forEach(m => map.removeLayer(m));
      stopMarkers = [];
      
      if (!rutaId) return;

      const response = await fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ruta = await response.json();

      if (!ruta.paradas || ruta.paradas.length === 0) return;

      // 2. SEPARAR PUNTOS (Trazo vs Paradas)
      // Si la ruta es antigua y no tiene 'tipo', asumimos que todo son paradas (fallback)
      const puntosTrazo = ruta.paradas.filter(p => p.tipo === 'trazo');
      const puntosParada = ruta.paradas.filter(p => p.tipo === 'parada_oficial' || !p.tipo);

      // 3. DIBUJAR LÍNEA (El diseño)
      // Usamos el trazo si existe, si no, unimos las paradas (modo simple)
      const puntosParaLinea = puntosTrazo.length > 0 ? puntosTrazo : puntosParada;
      
      const coordenadas = puntosParaLinea.map((p) => [
        p.ubicacion.coordinates[1], // lat
        p.ubicacion.coordinates[0], // lng
      ]);

      rutaPolyline = L.polyline(coordenadas, {
        color: "var(--color-primario)",
        weight: 6,
        opacity: 0.8,
        lineJoin: "round",
      }).addTo(map);

      // 4. DIBUJAR MARCADORES DE PARADAS (Iconos)
      // Icono visual para las paradas físicas
      const paradaIcon = L.divIcon({
          className: 'stop-marker-icon',
          html: '<div style="background-color:#ffc107; border:2px solid white; width:12px; height:12px; border-radius:50%; box-shadow:0 0 4px black;"></div>',
          iconSize: [12, 12]
      });

      puntosParada.forEach(p => {
          const marker = L.marker([p.ubicacion.coordinates[1], p.ubicacion.coordinates[0]], { icon: paradaIcon })
              .bindPopup(`🚏 <strong>${p.nombre || "Parada"}</strong>`)
              .addTo(map);
          stopMarkers.push(marker);
      });

      map.fitBounds(rutaPolyline.getBounds(), { padding: [50, 50] });
    } catch (error) {
      console.error(error);
    }
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
            camion.ubicacionActual.coordinates[0],
          ]);
          busMarkers[camion._id].rutaId = rutaId; // Actualizar ref ruta
        } else {
          // Crear nuevo
          const marker = L.marker(
            [
              camion.ubicacionActual.coordinates[1],
              camion.ubicacionActual.coordinates[0],
            ],
            { icon: busIcon }
          ).bindPopup(
            `🚍 **${camion.numeroUnidad}**<br>Ruta: ${
              camion.rutaAsignada ? camion.rutaAsignada.nombre : "Sin asignar"
            }`
          );

          marker.rutaId = rutaId;
          busMarkers[camion._id] = marker;
        }
      });
      filtrarCamionesEnMapa();
    } catch (error) {
      console.error(error);
    }
  }

  function filtrarCamionesEnMapa() {
    Object.values(busMarkers).forEach((marker) => {
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

  socket.on("studentWaiting", (data) => {
      console.log("🙋‍♂️ Nuevo estudiante esperando:", data);
      
      const marker = L.marker([data.location.lat, data.location.lng], { icon: studentIcon })
          .addTo(map)
          .bindPopup("<strong>¡Estudiante Aquí!</strong><br>Esperando transporte.")
          .openPopup();

      // Opcional: Centrar el mapa en mí si soy yo quien lo envió
      if (data.userId === user.id || data.userId === user._id) {
          map.setView([data.location.lat, data.location.lng], 16);
      }

      // Opcional: Quitar el marcador después de 5 minutos automáticamente
      setTimeout(() => {
          map.removeLayer(marker);
      }, 300000); 
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
      console.log("📍 Solicitando ubicación...");

      // 1. VERIFICACIÓN DE SEGURIDAD (Crucial para móviles/Safari/Chrome)
      // La geolocalización REQUIERE https o localhost.
      if (
        !window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1"
      ) {
        alert(
          "⚠️ ERROR DE SEGURIDAD:\n\nEl navegador ha bloqueado el GPS porque el sitio no es seguro (HTTP).\n\nPara usar el GPS en el celular, necesitas subir el proyecto a un servidor HTTPS (como Render/Vercel) o usar localhost en la PC."
        );
        return;
      }

      if (!("geolocation" in navigator)) {
        alert("❌ Tu dispositivo no soporta geolocalización.");
        return;
      }

      // UI de carga
      const textoOriginal = btnEstoyAqui.innerHTML;
      btnEstoyAqui.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Obteniendo ubicación...';
      btnEstoyAqui.disabled = true;

      // Opciones para forzar alta precisión (importante para Safari)
      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          // --- ÉXITO ---
          const myPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          console.log("✅ Ubicación obtenida:", myPos);

          socket.emit("studentAtStop", {
            userId: user.id,
            rutaId: currentRouteId || "SIN_RUTA",
            location: myPos,
          });

          alert(
            `✅ ¡Ubicación enviada al conductor!\n\nEl chofer ahora sabe que estás esperando en este punto.`
          );

          // Restaurar botón
          btnEstoyAqui.innerHTML = textoOriginal;
          btnEstoyAqui.disabled = false;
        },
        (error) => {
          // --- MANEJO DE ERRORES DETALLADO ---
          console.warn("Error GPS:", error);
          let mensajeError = "No se pudo obtener la ubicación.";

          switch (error.code) {
            case error.PERMISSION_DENIED:
              mensajeError =
                "⛔ Permiso denegado. Debes habilitar la ubicación en el icono del candado 🔒 de la barra de dirección o en la configuración de tu navegador (Brave/Safari).";
              break;
            case error.POSITION_UNAVAILABLE:
              mensajeError =
                "📡 La señal GPS es débil o no está disponible (¿Estás bajo techo?).";
              break;
            case error.TIMEOUT:
              mensajeError =
                "⏳ Se agotó el tiempo de espera para obtener el GPS.";
              break;
          }

          alert(`❌ Error: ${mensajeError}`);

          // Restaurar botón
          btnEstoyAqui.innerHTML = textoOriginal;
          btnEstoyAqui.disabled = false;
        },
        options
      );
    });
  }
  // const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  // if (btnEstoyAqui) {
  //     btnEstoyAqui.addEventListener("click", () => {
  //       if (navigator.geolocation) {
  //         btnEstoyAqui.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
  //         btnEstoyAqui.disabled = true;
  //         navigator.geolocation.getCurrentPosition(
  //           (position) => {
  //             const myPos = { lat: position.coords.latitude, lng: position.coords.longitude };
  //             socket.emit("studentAtStop", {
  //               userId: user.id,
  //               rutaId: currentRouteId || "SIN_RUTA",
  //               location: myPos,
  //             });
  //             alert(`✅ ¡Parada notificada!`);
  //             btnEstoyAqui.innerHTML = '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
  //             btnEstoyAqui.disabled = false;
  //           },
  //           (error) => {
  //             alert("❌ No se pudo obtener la ubicación.");
  //             btnEstoyAqui.innerHTML = '<i class="fas fa-location-arrow"></i> Notificar mi Parada';
  //             btnEstoyAqui.disabled = false;
  //           }
  //         );
  //       }
  //     });
  // }

  // Cerrar todo al hacer clic fuera de elementos
  window.addEventListener("click", (e) => {
    // Cerrar modal perfil
    if (e.target === modalPerfil) modalPerfil.classList.remove("show");
    // Cerrar modal historial
    if (modalHistorial && e.target === modalHistorial)
      modalHistorial.classList.remove("show");
    // Cerrar sidebar (si clic fuera y no en el botón)
    if (
      sidebar.classList.contains("active") &&
      !sidebar.contains(e.target) &&
      !e.target.closest("#btn-menu-toggle")
    ) {
      sidebar.classList.remove("active");
    }
    // Cerrar menú perfil dropdown
    if (
      profileMenu &&
      profileMenu.classList.contains("show") &&
      !profileMenu.contains(e.target) &&
      !e.target.closest("#profile-toggle")
    ) {
      profileMenu.classList.remove("show");
    }
  });

  // 3. Función Principal de Suscripción (Cross-Browser)
  // frontend/assets/js/student_map.js

  async function activarNotificaciones() {
    const deseaActivar = confirm(
      "¿Quieres recibir notificaciones cuando tu camión esté cerca?"
    );

    if (!deseaActivar) {
      console.log("🚫 Activación cancelada por el usuario.");
      return; // Se detiene aquí si dice que no
    }
    console.log("🚀 Iniciando activación de notificaciones...");

    // 1. Diagnóstico de Seguridad
    if (
      window.location.protocol === "http:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      alert(
        "⚠️ ERROR CRÍTICO DE SEGURIDAD:\n\nLas notificaciones NO funcionan en direcciones IP (http://192.168...). \n\nDebes usar 'localhost' o subirlo a un servidor seguro (https)."
      );
      return;
    }

    // 2. Diagnóstico de Soporte
    if (!("serviceWorker" in navigator)) {
      alert("❌ Tu navegador no soporta Service Workers.");
      return;
    }

    try {
      // 3. Solicitar Permiso
      const permission = await Notification.requestPermission();
      console.log("Permiso:", permission);

      if (permission !== "granted") {
        alert(
          "⛔ Permiso denegado. Tienes que habilitar las notificaciones manualmente en la configuración del sitio (candado 🔒)."
        );
        return;
      }

      // 4. Registrar Service Worker
      // INTENTO ROBUSTO: Probamos rutas comunes por si sw.js no está en la raíz
      let register;
      try {
        register = await navigator.serviceWorker.register("sw.js");
      } catch (e) {
        console.warn("Fallo ruta raíz, probando ../sw.js");
        register = await navigator.serviceWorker.register("../sw.js");
      }

      console.log("✅ Service Worker registrado:", register);
      await navigator.serviceWorker.ready;

      // 5. Suscribirse
      const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
      });

      console.log("✅ Suscripción generada:", subscription);

      // 6. Guardar en Backend
      const token = localStorage.getItem("tecbus_token");
      const response = await fetch(
        `${BACKEND_URL}/api/notificaciones/suscribir`,
        {
          method: "POST",
          body: JSON.stringify(subscription),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok)
        throw new Error(`Error del Servidor: ${response.status}`);

      alert(
        "🎉 ¡ÉXITO! Notificaciones activadas.\n\nEn unos segundos deberías recibir una notificación de confirmación de la activación."
      );

      // 7. Prueba Inmediata
      await fetch(`${BACKEND_URL}/api/notificaciones/mi-prediccion-prueba`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error("❌ ERROR TÉCNICO DETALLADO:", error);
      // Esta alerta te dirá exactamente qué pasó
      alert(
        `❌ ERROR TÉCNICO:\n${error.name}: ${error.message}\n\n(Revisa la consola con F12 para más detalles)`
      );
    }
  }

  const btnAyuda = document.getElementById("btn-abrir-ayuda");
  const modalInstrucciones = document.getElementById(
    "fullscreen-instrucciones"
  );
  const btnCerrarAyuda = document.getElementById("btn-cerrar-instrucciones");

  if (btnAyuda && modalInstrucciones) {
    // Abrir
    btnAyuda.addEventListener("click", () => {
      modalInstrucciones.classList.add("active");
    });

    // Cerrar con botón X
    if (btnCerrarAyuda) {
      btnCerrarAyuda.addEventListener("click", () => {
        modalInstrucciones.classList.remove("active");
      });
    }

    // Cerrar con tecla ESC
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        modalInstrucciones.classList.contains("active")
      ) {
        modalInstrucciones.classList.remove("active");
      }
    });
  }

  // INICIALIZACIÓN
  fetchAndUpdateBuses();
  // Polling de respaldo cada 10s
  setInterval(fetchAndUpdateBuses, 10000);

window.addEventListener("beforeunload", () => {
    const token = localStorage.getItem("tecbus_token");
    const userString = localStorage.getItem("tecbus_user");

    if (token && userString) {
        const user = JSON.parse(userString);

        if (user.tipo === "estudiante") {
            const userId = user._id || user.id;
            
            // Usamos keepalive: true para asegurar que el server reciba el aviso
            // aunque la ventana se cierre inmediatamente.
            fetch(`${BACKEND_URL}/api/users/${userId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ estado: "inactivo" }),
                keepalive: true, 
            });
        }
    }
});

window.addEventListener("beforeunload", () => {
    const token = localStorage.getItem("tecbus_token");
    const userString = localStorage.getItem("tecbus_user");

    if (token && userString) {
        const user = JSON.parse(userString);

        if (user.tipo === "estudiante") {
            const userId = user._id || user.id;
            
            // Usamos keepalive: true para asegurar que el server reciba el aviso
            // aunque la ventana se cierre inmediatamente.
            fetch(`${BACKEND_URL}/api/users/${userId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ estado: "inactivo" }),
                keepalive: true, 
            });
        }
    }
});

});
