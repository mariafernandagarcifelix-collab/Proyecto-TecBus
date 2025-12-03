// frontend/assets/js/driver_map.js

document.addEventListener("DOMContentLoaded", () => {
  // 1. VERIFICACIÓN DE SESIÓN
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

  // 2. CONSTANTES Y VARIABLES GLOBALES
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;
  
  // Variables de Estado
  let MI_CAMION_ID = null;
  let MIS_VIAJES_HOY = [];        // Lista de todos los viajes del día ordenados
  let INDICE_VIAJE_ACTUAL = -1;   // En qué viaje voy (0, 1, 2...)
  
  // Variables de Geofencing (Detección de Llegada)
  let DESTINO_ACTUAL = null;      // { lat: ..., lng: ... } del punto final
  let LLEGADA_DETECTADA = false;  // Para evitar que la alerta suene 50 veces
  let RADIO_DETECCION_METROS = 150; // Distancia para considerar que "Llegó"

  // Elementos UI Principales
  const busDisplay = document.getElementById("driver-bus-display");
  const routeDisplay = document.getElementById("driver-route-display");
  const statusDisplay = document.getElementById("service-status");
  const headerDisplay = document.getElementById("header-bus-display");
  
  // Elementos del Menú Lateral
  const sidebar = document.getElementById("sidebar");
  const btnMenuToggle = document.getElementById("btn-menu-toggle");
  const btnMenuClose = document.getElementById("btn-menu-close");

  // Conexión Socket.IO
  const socket = io(SOCKET_URL);
  let geoWatchId = null;
  socket.on("connect", () => {
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id);
  });

  // 3. CONFIGURACIÓN DEL MAPA
  const map = L.map("map", { zoomControl: false }).setView([initialLat, initialLng], initialZoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

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

  // ============================================================
  // 4. LÓGICA DE GEOFENCING (DETECTAR LLEGADA)
  // ============================================================

  // Fórmula de Haversine para calcular metros entre dos coordenadas
  function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
      const R = 6371e3; // Radio de la tierra en metros
      const φ1 = lat1 * Math.PI/180;
      const φ2 = lat2 * Math.PI/180;
      const Δφ = (lat2-lat1) * Math.PI/180;
      const Δλ = (lon2-lon1) * Math.PI/180;

      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      return R * c; // Distancia en metros
  }

  function verificarLlegadaDestino(latActual, lngActual) {
      if (!DESTINO_ACTUAL || LLEGADA_DETECTADA) return;

      const distancia = calcularDistanciaMetros(latActual, lngActual, DESTINO_ACTUAL.lat, DESTINO_ACTUAL.lng);
      
      // Debug en consola para ver qué tan cerca estás
      // console.log(`Distancia al destino: ${Math.round(distancia)} metros`);

      if (distancia < RADIO_DETECCION_METROS) {
          console.log("✅ ¡Llegada detectada!");
          LLEGADA_DETECTADA = true; // Bloquear para no disparar múltiples veces
          avanzarSiguienteTurno();
      }
  }

  function avanzarSiguienteTurno() {
      // 1. Verificar si hay más viajes hoy
      if (INDICE_VIAJE_ACTUAL >= MIS_VIAJES_HOY.length - 1) {
          // SE ACABARON LOS VIAJES
          finDelServicio();
      } else {
          // 2. Cargar el siguiente
          INDICE_VIAJE_ACTUAL++;
          const siguienteViaje = MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL];
          
          // Notificación Visual y Sonora
          if("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
          alert(`🏁 LLegada a destino detectada.\n\n🔄 Iniciando siguiente ruta: ${siguienteViaje.rutaNombre}\n⏰ Horario: ${siguienteViaje.hora}`);
          
          // Cargar la nueva ruta
          cargarRutaActiva(siguienteViaje);
      }
  }

  function finDelServicio() {
      routeDisplay.textContent = "Jornada Finalizada";
      statusDisplay.innerHTML = "● Fuera de Servicio";
      statusDisplay.className = "status-indicator status-off";
      statusDisplay.style.color = "var(--color-error)";
      DESTINO_ACTUAL = null;
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      
      alert("🏁 Has llegado al destino final de hoy.\nTu estado ahora es: Fuera de Servicio.");
  }


  // ============================================================
  // 5. CARGA DE DATOS Y RUTAS
  // ============================================================
// Variable global para guardar el control de ruta y poder borrarlo después
  let routingControl = null; 

  async function cargarRutaActiva(viaje) {
      // 1. Actualizar Textos UI
      routeDisplay.textContent = viaje.rutaNombre;
      statusDisplay.innerHTML = `● En Ruta (${viaje.hora})`;
      statusDisplay.className = "status-indicator status-on";
      statusDisplay.style.color = "var(--color-exito)";

      try {
          // 2. Limpiar mapa anterior
          if (rutaPolyline) map.removeLayer(rutaPolyline); // Limpiar línea simple vieja
          if (routingControl) map.removeControl(routingControl); // Limpiar ruta inteligente vieja
          
          // 3. Obtener datos de la ruta
          const response = await fetch(`${BACKEND_URL}/api/rutas/${viaje.rutaId}`, {
            headers: { Authorization: `Bearer ${token}` } 
          });
          const ruta = await response.json();

          if (ruta.paradas && ruta.paradas.length > 0) {
              
              // Convertir paradas a formato Waypoints de Leaflet
              const waypoints = ruta.paradas.map(p => L.latLng(
                  p.ubicacion.coordinates[1], 
                  p.ubicacion.coordinates[0]
              ));

              // 4. Dibujar la Ruta Inteligente (Sigue calles)
              routingControl = L.Routing.control({
                  waypoints: waypoints,
                  router: L.Routing.osrmv1({
                      serviceUrl: 'https://router.project-osrm.org/route/v1', // Servidor público demo
                      profile: 'driving'
                  }),
                  // Opciones visuales de la línea
                  lineOptions: {
                      styles: [{ color: '#007bff', opacity: 0.8, weight: 6 }] // Usa tu color primario aquí
                  },
                  // Opciones para ocultar cosas que no queremos (instrucciones paso a paso, marcadores extra, etc)
                  createMarker: function() { return null; }, // No crear marcadores automáticos (usamos los nuestros)
                  addWaypoints: false,      // No permitir al usuario agregar puntos
                  draggableWaypoints: false, // No permitir arrastrar
                  fitSelectedRoutes: true,   // Centrar mapa en la ruta
                  show: false                // Ocultar la caja de texto con instrucciones
              }).addTo(map);

              // 5. ESTABLECER DESTINO PARA EL GEOFENCING
              // El routing es asíncrono, pero el destino geográfico sigue siendo la última parada
              const ultimoPunto = waypoints[waypoints.length - 1];
              DESTINO_ACTUAL = { lat: ultimoPunto.lat, lng: ultimoPunto.lng };
              
              LLEGADA_DETECTADA = false; 
              console.log("🚩 Nuevo destino (Geofence) fijado en:", DESTINO_ACTUAL);
          }
      } catch (error) {
          console.error("Error cargando ruta:", error);
      }
  }

  async function inicializarSistema() {
      try {
          // A. Obtener Camión
          const resCamion = await fetch(BACKEND_URL + "/api/users/mi-camion", { headers: { Authorization: `Bearer ${token}` }});
          const dataCamion = await resCamion.json();
          
          if (resCamion.ok && dataCamion.camionId) {
               MI_CAMION_ID = dataCamion.camionId;
               let texto = `Unidad ${dataCamion.numeroUnidad}`;
               if(dataCamion.placa) texto += ` (${dataCamion.placa})`;
               headerDisplay.textContent = texto;
               busDisplay.textContent = texto;
          } else {
               routeDisplay.textContent = "--";
               statusDisplay.textContent = "● Sin Camión Asignado";
               return; // No iniciar nada si no tiene camión
          }

          // B. Obtener TODOS los horarios del día
          const resHorarios = await fetch(BACKEND_URL + "/api/horarios", { headers: { Authorization: `Bearer ${token}` }});
          const todosHorarios = await resHorarios.json();
          
          const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
          const hoyBackend = {
            "lunes": "Lunes", "martes": "Martes", "miercoles": "Miércoles",
            "jueves": "Jueves", "viernes": "Viernes", "sabado": "Sábado", "domingo": "Domingo"
          }[dias[new Date().getDay()]];

          // Filtrar mis viajes de hoy
          MIS_VIAJES_HOY = todosHorarios.filter(h => {
              const esHoy = h.diaSemana === hoyBackend;
              const soyYo = h.infoConductor && h.infoConductor[0]?._id === (user._id || user.id);
              const esMiCamion = String(h.camionUnidad) === String(dataCamion.numeroUnidad);
              return esHoy && (soyYo || esMiCamion);
          });

          // Ordenar por hora
          const horaAInt = (h) => parseInt(h.split(':')[0]) * 60 + parseInt(h.split(':')[1]);
          MIS_VIAJES_HOY.sort((a, b) => horaAInt(a.hora) - horaAInt(b.hora));

          if (MIS_VIAJES_HOY.length === 0) {
              routeDisplay.textContent = "Día Libre";
              statusDisplay.textContent = "● Sin Recorridos";
              return;
          }

          // C. Determinar en qué viaje vamos (según la hora actual)
          const now = new Date();
          const horaActual = now.getHours() * 60 + now.getMinutes();
          
          // Buscamos el primer viaje que no haya terminado (hora + 45 mins aprox)
          // Si todos pasaron, marcamos el último. Si ninguno empezó, marcamos el primero.
          let indiceEncontrado = 0; 
          
          for (let i = 0; i < MIS_VIAJES_HOY.length; i++) {
              const horaViaje = horaAInt(MIS_VIAJES_HOY[i].hora);
              // Si la hora actual es menor que (horaViaje + 30 mins), asumimos que ese es el viaje actual/siguiente
              if (horaActual < (horaViaje + 30)) {
                  indiceEncontrado = i;
                  break;
              }
              // Si ya es muy tarde, nos quedamos en el último (que seguramente activará fin de servicio)
              if (i === MIS_VIAJES_HOY.length - 1) indiceEncontrado = i; 
          }
          
          // Si ya es MUY tarde (2 horas despues del ultimo viaje), marcar fin
          const ultimoViaje = MIS_VIAJES_HOY[MIS_VIAJES_HOY.length - 1];
          if (horaActual > (horaAInt(ultimoViaje.hora) + 120)) {
             finDelServicio();
             iniciarGeolocalizacion(); // Iniciamos GPS solo para ubicación, sin lógica de ruta
             return;
          }

          // D. Iniciar el viaje detectado
          INDICE_VIAJE_ACTUAL = indiceEncontrado;
          cargarRutaActiva(MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL]);
          iniciarGeolocalizacion();

      } catch (error) {
          console.error("Error inicializando:", error);
      }
  }


  // ============================================================
  // 6. GPS Y SOCKETS
  // ============================================================

  function iniciarGeolocalizacion() {
      if ("geolocation" in navigator) {
          geoWatchId = navigator.geolocation.watchPosition(
              (position) => {
                  const lat = position.coords.latitude;
                  const lng = position.coords.longitude;
                  
                  // 1. Mover marcador visual
                  const newLatLng = new L.LatLng(lat, lng);
                  driverMarker.setLatLng(newLatLng);
                  map.panTo(newLatLng);
                  
                  // 2. Enviar a estudiantes (Socket)
                  if (MI_CAMION_ID && socket.connected) {
                      socket.emit("driverLocationUpdate", {
                          camionId: MI_CAMION_ID,
                          location: { lat, lng }
                      });
                  }

                  // 3. 🔥 VERIFICAR SI LLEGÓ AL DESTINO (GEOFENCING)
                  verificarLlegadaDestino(lat, lng);
              },
              (err) => console.warn("GPS Error:", err),
              { enableHighAccuracy: true, maximumAge: 0 }
          );
      }
  }


  // 4. LÓGICA DEL MENÚ LATERAL Y MODALES
  
  // Toggle Sidebar
  if (btnMenuToggle) {
    btnMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation(); // Evitar que el click cierre el menú inmediatamente
        sidebar.classList.add("active");
    });
  }
  
  if (btnMenuClose) {
    btnMenuClose.addEventListener("click", () => sidebar.classList.remove("active"));
  }

  // Cerrar sidebar al hacer click fuera
  document.addEventListener("click", (e) => {
      if (sidebar.classList.contains("active") && 
          !sidebar.contains(e.target) && 
          !e.target.closest(".menu-icon")) {
          sidebar.classList.remove("active");
      }
  });

  // --- MODAL PERFIL ---
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnOpenPerfilSidebar = document.getElementById("btn-open-perfil-sidebar");

  function abrirPerfil() {
      sidebar.classList.remove("active"); // Cerrar menú si está abierto
      
      // Llenar datos
      document.getElementById("perfil-nombre").textContent = user.nombre || "Conductor";
      document.getElementById("perfil-email").textContent = user.email || "Sin correo";
      document.getElementById("perfil-id").textContent = (user._id || user.id || "N/A").substring(0, 10) + "...";
      
      // Intentar mostrar licencia si existe en el objeto user (si se guardó al login)
      const licencia = user.conductor ? user.conductor.licencia : "No registrada";
      const elLicencia = document.getElementById("perfil-licencia");
      if(elLicencia) elLicencia.textContent = licencia;

      modalPerfil.classList.add("modal-visible");
  }

  if (btnOpenPerfilHeader) btnOpenPerfilHeader.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnOpenPerfilSidebar) btnOpenPerfilSidebar.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });

  // --- MODAL HORARIOS ---
  // ============================================================
  // SECCIÓN: VISOR DE HORARIOS SEMANAL (ESTILO GRID)
  // ============================================================
  const fullscreenHorarios = document.getElementById("fullscreen-horarios");
  const btnOpenHorarioSidebar = document.getElementById("btn-open-horario-sidebar");
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const calendarGrid = document.getElementById("calendario-semanal");

  async function abrirMisHorarios() {
      // 1. UI: Cerrar sidebar y mostrar pantalla completa
      if(sidebar) sidebar.classList.remove("active");
      fullscreenHorarios.classList.add("active");
      
      calendarGrid.innerHTML = '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando tu agenda...</p>';

      try {
          // 2. Petición al backend
          const res = await fetch(`${BACKEND_URL}/api/horarios`, {
              headers: { Authorization: `Bearer ${token}` }
          });
          
          if(!res.ok) throw new Error("No se pudo descargar la agenda");
          const todosLosHorarios = await res.json();

          // 3. Filtrar SOLO lo asignado a ESTE conductor
          const misHorarios = todosLosHorarios.filter(h => {
             const info = h.infoConductor && h.infoConductor[0];
             if (info) return info._id === (user._id || user.id);
             return h.conductorNombre === user.nombre;
          });

          // 4. Agrupar por días (Lunes a Domingo)
          const diasOrdenados = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
          const grupos = {};
          
          // Inicializamos todos los días vacíos para que aparezcan en el calendario
          diasOrdenados.forEach(d => grupos[d] = []);

          misHorarios.forEach(h => {
              // Mapeo simple para normalizar acentos si el backend varía
              let dia = h.diaSemana;
              if(dia === "Miercoles") dia = "Miércoles";
              if(dia === "Sabado") dia = "Sábado";

              if (grupos[dia]) {
                  grupos[dia].push(h);
              }
          });

          // 5. Generar HTML del Grid
          calendarGrid.innerHTML = "";
          
          diasOrdenados.forEach(dia => {
              const viajes = grupos[dia];
              
              // Ordenar viajes por hora (de temprano a tarde)
              viajes.sort((a,b) => horaAEntero(a.hora) - horaAEntero(b.hora));

              let contenidoHTML = "";

              if (viajes.length === 0) {
                  // Diseño para día libre
                  contenidoHTML = `
                    <div class="no-service">
                        <i class="fas fa-coffee" style="font-size:1.5rem; margin-bottom:10px; display:block;"></i>
                        Descanso
                    </div>`;
              } else {
                  // Diseño de lista de viajes
                  viajes.forEach(v => {
                      contenidoHTML += `
                        <div class="cal-item">
                            <div class="cal-time-box">
                                <span class="cal-time">${v.hora}</span>
                            </div>
                            <div class="cal-info-box">
                                <span class="cal-route">${v.rutaNombre}</span>
                                <span class="cal-bus-badge">
                                    <i class="fas fa-bus"></i> ${v.camionUnidad || "S/N"}
                                </span>
                            </div>
                        </div>
                      `;
                  });
              }

              // Construcción de la Tarjeta del Día
              calendarGrid.innerHTML += `
                <div class="day-card">
                    <div class="day-header">
                        <h3>${dia}</h3>
                        ${viajes.length > 0 ? `<span class="badge-count">${viajes.length} Viajes</span>` : ''}
                    </div>
                    <div class="day-body">
                        ${contenidoHTML}
                    </div>
                </div>
              `;
          });

      } catch (error) {
          console.error(error);
          calendarGrid.innerHTML = '<p class="placeholder-text" style="color:var(--color-error)">Error de conexión al cargar horarios.</p>';
      }
  }

  // Listeners para abrir/cerrar
  if(btnOpenHorarioSidebar) {
      btnOpenHorarioSidebar.addEventListener("click", (e) => {
          e.preventDefault();
          abrirMisHorarios();
      });
  }
  if(btnCerrarHorarios) {
      btnCerrarHorarios.addEventListener("click", () => {
          fullscreenHorarios.classList.remove("active");
      });
  }

  // 5. LÓGICA DEL ESTADO DEL CONDUCTOR (Principal)
  
  // Utilidades de Fecha
  function obtenerDiaSemana() {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return dias[new Date().getDay()];
  }
  const mapaDiasBackend = {
    "lunes": "Lunes", "martes": "Martes", "miercoles": "Miércoles",
    "jueves": "Jueves", "viernes": "Viernes", "sabado": "Sábado", "domingo": "Domingo"
  };
  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(':');
    return parseInt(h) * 60 + parseInt(m);
  }

  async function actualizarEstadoConductor() {
    try {
      // A. Obtener mi camión
      const resCamion = await fetch(BACKEND_URL + "/api/users/mi-camion", {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const dataCamion = await resCamion.json();
      
      let textoCamion = "Sin Unidad";
      let unidad = null;

      if (resCamion.ok && dataCamion.camionId) {
         MI_CAMION_ID = dataCamion.camionId;
         const placa = dataCamion.placa; 
         unidad = dataCamion.numeroUnidad;

         if (unidad && placa) textoCamion = `Unidad ${unidad} (${placa})`;
         else if (unidad) textoCamion = `Unidad ${unidad}`;
         else textoCamion = "Unidad Asignada";
      } else {
         MI_CAMION_ID = null;
         textoCamion = "Sin Unidad Asignada";
      }

      if (headerDisplay) headerDisplay.textContent = textoCamion;
      if (busDisplay) busDisplay.textContent = textoCamion;

      if (!MI_CAMION_ID) {
          routeDisplay.textContent = "--";
          statusDisplay.textContent = "● Sin Asignación";
          statusDisplay.style.color = "gray";
          return; // No seguimos si no hay camión
      }

      // B. Obtener Horarios para saber la Ruta actual
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!resHorarios.ok) return;

      const todosHorarios = await resHorarios.json();
      const hoyRaw = obtenerDiaSemana(); 
      const hoyFormatted = mapaDiasBackend[hoyRaw]; 

      // Buscamos salidas de HOY que coincidan con MI CAMION (por unidad) o MI ID
      const misSalidasHoy = todosHorarios.filter(h => {
          const esHoy = (h.diaSemana === hoyFormatted);
          // Verificación robusta: Por ID de conductor O por Unidad de camión
          const conductorEsYo = h.infoConductor && h.infoConductor[0] && h.infoConductor[0]._id === (user._id || user.id);
          const camionEsMio = String(h.camionUnidad) === String(unidad);
          
          return esHoy && (conductorEsYo || camionEsMio);
      });

      if (misSalidasHoy.length === 0) {
        routeDisplay.textContent = "Sin Recorridos Hoy";
        statusDisplay.innerHTML = "● Fuera de Servicio";
        statusDisplay.className = "status-indicator status-off";
        statusDisplay.style.color = "var(--color-error)";
        return;
      }

      // Asumimos la ruta del primer horario encontrado
      MI_RUTA_NOMBRE = misSalidasHoy[0].rutaNombre || "Ruta Desconocida";
      routeDisplay.textContent = MI_RUTA_NOMBRE;

      // Calcular estado activo
      misSalidasHoy.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));
      const ultimaSalida = misSalidasHoy[misSalidasHoy.length - 1].hora;
      const now = new Date();
      const horaActual = now.getHours() * 60 + now.getMinutes();
      const horaLimite = horaAEntero(ultimaSalida) + 90; // 90 mins de gracia

      if (horaActual > horaLimite) {
        statusDisplay.innerHTML = "● Fuera de Servicio";
        statusDisplay.className = "status-indicator status-off";
        statusDisplay.style.color = "var(--color-error)";
      } else {
        statusDisplay.innerHTML = `● En Servicio (Fin: ${ultimaSalida})`;
        statusDisplay.className = "status-indicator status-on";
        statusDisplay.style.color = "var(--color-exito)";
        
        // Iniciar GPS solo si está en servicio activo
        iniciarGeolocalizacion();
      }

    } catch (error) {
      console.error("Error estado conductor:", error);
      routeDisplay.textContent = "Error de conexión";
    }
  }

  // // 6. GEOLOCALIZACIÓN
  // function iniciarGeolocalizacion() {
  //   if ("geolocation" in navigator) {
  //     if (geoWatchId) return; // Ya está corriendo

  //     console.log("📍 Iniciando GPS Conductor...");
  //     geoWatchId = navigator.geolocation.watchPosition(
  //       (position) => {
  //         const newPos = {
  //           lat: position.coords.latitude,
  //           lng: position.coords.longitude,
  //         };

  //         driverMarker.setLatLng(newPos);
  //         map.panTo(newPos);

  //         // Emitir al servidor solo si tengo camión asignado
  //         if (MI_CAMION_ID && socket.connected) {
  //           socket.emit("driverLocationUpdate", {
  //             camionId: MI_CAMION_ID,
  //             location: newPos,
  //           });
  //         }
  //       },
  //       (error) => console.warn("Error GPS:", error.message),
  //       { enableHighAccuracy: true, maximumAge: 0 }
  //     );
  //   } else {
  //      alert("Tu dispositivo no soporta GPS.");
  //   }
  // }

  // 7. REPORTAR INCIDENTE (Modal Lógica)
  const incidentModal = document.getElementById("incident-modal");
  const btnSidebarReporte = document.getElementById("btn-reporte-falla"); // Botón del menú
  const btnMainReporte = document.getElementById("btn-reporte-incidente"); // Botón del panel flotante
  const btnSendIncident = document.getElementById("send-incident");
  
  // Abrir modal desde el panel principal
  if(btnMainReporte) {
      btnMainReporte.onclick = () => incidentModal.classList.add("modal-visible");
  }
  // Abrir modal desde el sidebar (ya gestionado arriba, pero aseguramos)
  
  // Cerrar modales
  window.onclick = (event) => {
    if (event.target.classList.contains("modal")) {
        event.target.classList.remove("modal-visible");
    }
  };

  // Enviar Incidente
  if(btnSendIncident) {
      btnSendIncident.onclick = () => {
        const incidentType = document.getElementById("incident-type").value;
        const incidentDetails = document.getElementById("incident-details").value;

        if (incidentType && MI_CAMION_ID) {
          socket.emit("incidentReport", {
            camionId: MI_CAMION_ID,
            tipo: incidentType,
            detalles: incidentDetails,
            hora: new Date().toISOString(),
          });

          incidentModal.classList.remove("modal-visible");
          alert("⚠️ Incidente reportado a los estudiantes.");
          
          // Reset
          document.getElementById("incident-type").value = "";
          document.getElementById("incident-details").value = "";
        } else if (!MI_CAMION_ID) {
          alert("No tienes un camión asignado para reportar incidentes.");
        } else {
          alert("Por favor selecciona un tipo de incidente.");
        }
      };
  }

  // 8. CERRAR SESIÓN
  const btnLogout = document.getElementById("logout-button");
  const btnSidebarLogout = document.getElementById("sidebar-logout");

  function logoutAction(e) {
      e.preventDefault();
      if (confirm("¿Estás seguro de que quieres cerrar sesión?")) {
        localStorage.removeItem("tecbus_token");
        localStorage.removeItem("tecbus_user");
        window.location.href = "index.html";
      }
  }

  if(btnLogout) btnLogout.addEventListener("click", logoutAction);
  if(btnSidebarLogout) btnSidebarLogout.addEventListener("click", logoutAction);

  // 9. DROPDOWN PERFIL (HEADER)
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");
  
  if(user && document.getElementById("user-name-display")) {
      document.getElementById("user-name-display").textContent = user.nombre.split(" ")[0];
  }

  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }

  // Iniciar
  // 7. ARRANCAR EL SISTEMA
  inicializarSistema();
  actualizarEstadoConductor();
  setInterval(actualizarEstadoConductor, 60000);
});