// frontend/assets/js/driver_map.js

document.addEventListener("DOMContentLoaded", () => {
  // 1. VERIFICACIÓN DE SESIÓN
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "login.html";
    return;
  }

  const user = JSON.parse(userString);

  if (user.tipo !== "conductor") {
    alert("Acceso denegado. No eres conductor.");
    window.location.href = "login.html";
    return;
  }

  // 2. CONSTANTES Y VARIABLES GLOBALES
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;

  // Variables de Estado
  let MI_CAMION_ID = null;
  let MI_RUTA_NOMBRE = "";
  let MIS_VIAJES_HOY = []; // Lista de todos los viajes del día ordenados
  let INDICE_VIAJE_ACTUAL = -1; // En qué viaje voy (0, 1, 2...)

  // Variables de Geofencing (Detección de Llegada)
  let DESTINO_ACTUAL = null; // { lat: ..., lng: ... } del punto final
  let LLEGADA_DETECTADA = false; // Para evitar que la alerta suene 50 veces
  let RADIO_DETECCION_METROS = 150; // Distancia para considerar que "Llegó"

  // --- CORRECCIÓN 1: Definir la variable faltante ---
  let rutaPolyline = null;

  // Elementos UI Principales
  const busDisplay = document.getElementById("driver-bus-display");
  const routeDisplay = document.getElementById("driver-route-display");
  const statusDisplay = document.getElementById("service-status");
  const headerDisplay = document.getElementById("header-bus-display");

  // Elementos del Menú Lateral
  const sidebar = document.getElementById("sidebar");
  const btnMenuToggle = document.getElementById("btn-menu-toggle");
  const btnMenuClose = document.getElementById("btn-menu-close");

  // 3. CONFIGURACIÓN DEL MAPA
  const map = L.map("map", { zoomControl: false }).setView(
    [initialLat, initialLng],
    initialZoom
  );
  L.control.zoom({ position: "bottomright" }).addTo(map);

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
    .bindPopup("Ubicación Guardada")
    .openPopup();

  // ============================================================
  // CONEXIÓN SOCKET.IO Y LÓGICA DE ESCUCHA (ESP32)
  // ============================================================
  const socket = io(SOCKET_URL);
  let geoWatchId = null;

  socket.on("connect", () => {
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id);
  });

  // --- CORRECCIÓN 2: Escuchar al Servidor (ESP32) ---
  // Esta es la parte mágica que mueve el mapa cuando el ESP32 manda datos
  // --- CORRECCIÓN FINAL: ESCUCHAR, PERO CONSULTAR BD ---
  // --- VERSIÓN DE DIAGNÓSTICO PARA SOCKETS ---
  // --- LÓGICA CORREGIDA: Consultar TODOS los camiones (Igual que Estudiante/Admin) ---
  socket.on("locationUpdate", async (data) => {
    // 1. Verificamos si la señal es relevante para nosotros
    const esMiID =
      MI_CAMION_ID && String(data.camionId) === String(MI_CAMION_ID);
    let esMiUnidad = false;
    if (headerDisplay && data.numeroUnidad) {
      esMiUnidad = headerDisplay.textContent.includes(data.numeroUnidad);
    }

    if (esMiID || esMiUnidad) {
      console.log("🔔 Señal recibida. Sincronizando con Base de Datos...");

      try {
        // 2. CORRECCIÓN: Pedimos la lista COMPLETA de camiones (esta ruta SI existe y funciona)
        const response = await fetch(`${BACKEND_URL}/api/camiones`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const listaCamiones = await response.json();

          // 3. Buscamos NUESTRO camión en la lista
          const camionDB = listaCamiones.find(
            (c) => c._id === MI_CAMION_ID || c.id === MI_CAMION_ID
          );

          if (
            camionDB &&
            camionDB.ubicacionActual &&
            camionDB.ubicacionActual.coordinates
          ) {
            // MongoDB GeoJSON: coordinates [longitud, latitud]
            const lngDB = camionDB.ubicacionActual.coordinates[0];
            const latDB = camionDB.ubicacionActual.coordinates[1];
            const velocidadDB = camionDB.velocidad || 0;

            console.log(`✅ Ubicación sincronizada: [${latDB}, ${lngDB}]`);

            const newLatLng = new L.LatLng(latDB, lngDB);

            // 4. Mover el marcador
            driverMarker.setLatLng(newLatLng);
            driverMarker
              .bindPopup(
                `📍 Ubicación Real (BD)<br>🚀 ${Math.round(velocidadDB)} km/h`
              )
              .openPopup();

            map.panTo(newLatLng);
            verificarLlegadaDestino(latDB, lngDB);
          } else {
            console.warn(
              "⚠️ Mi camión fue encontrado pero no tiene coordenadas en BD."
            );
          }
        } else {
          console.error(
            "❌ Error al obtener lista de camiones:",
            response.status
          );
        }
      } catch (error) {
        console.error("❌ Error de red consultando BD:", error);
      }
    }
  });

  // ============================================================
  // 4. LÓGICA DE GEOFENCING (DETECTAR LLEGADA)
  // ============================================================

  // Fórmula de Haversine para calcular metros entre dos coordenadas
  function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la tierra en metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distancia en metros
  }

  function verificarLlegadaDestino(latActual, lngActual) {
    if (!DESTINO_ACTUAL || LLEGADA_DETECTADA) return;

    const distancia = calcularDistanciaMetros(
      latActual,
      lngActual,
      DESTINO_ACTUAL.lat,
      DESTINO_ACTUAL.lng
    );

    if (distancia < RADIO_DETECCION_METROS) {
      console.log("✅ ¡Llegada detectada por GPS Físico!");
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
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
      alert(
        `🏁 LLegada a destino detectada.\n\n🔄 Iniciando siguiente ruta: ${siguienteViaje.rutaNombre}\n⏰ Horario: ${siguienteViaje.hora}`
      );

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

    alert(
      "🏁 Has llegado al destino final de hoy.\nTu estado ahora es: Fuera de Servicio."
    );
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
      if (rutaPolyline) map.removeLayer(rutaPolyline);
      if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
      }

      // 3. Obtener datos de la ruta
      const response = await fetch(`${BACKEND_URL}/api/rutas/${viaje.rutaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ruta = await response.json();

      if (ruta.paradas && ruta.paradas.length > 0) {
        // Separar trazo de paradas
        const puntosTrazo = ruta.paradas.filter((p) => p.tipo === "trazo");
        const puntosParada = ruta.paradas.filter(
          (p) => p.tipo === "parada_oficial" || !p.tipo
        );

        // --- CASO A: RUTA CON DISEÑO MANUAL (TRAZO) ---
        if (puntosTrazo.length > 0) {
          console.log("🎨 Cargando ruta con diseño manual...");

          // Dibujamos la línea exactamente como la diseñaste
          const coords = puntosTrazo.map((p) => [
            p.ubicacion.coordinates[1],
            p.ubicacion.coordinates[0],
          ]);

          rutaPolyline = L.polyline(coords, {
            color: "#007bff", // Color azul conductor
            weight: 6,
            opacity: 0.8,
          }).addTo(map);

          // Marcar las paradas visualmente
          puntosParada.forEach((p) => {
            L.circleMarker(
              [p.ubicacion.coordinates[1], p.ubicacion.coordinates[0]],
              {
                radius: 6,
                color: "white",
                fillColor: "#ffc107",
                fillOpacity: 1,
                weight: 2,
              }
            )
              .addTo(map)
              .bindPopup(p.nombre);
          });

          // Establecer destino (último punto del trazo)
          const ultimo = coords[coords.length - 1];
          DESTINO_ACTUAL = { lat: ultimo[0], lng: ultimo[1] };
          map.fitBounds(rutaPolyline.getBounds());
        }
        // --- CASO B: RUTA ANTIGUA (SIN TRAZO, SOLO PARADAS) ---
        else {
          console.log("🗺️ Cargando ruta automática (OSRM)...");
          const waypoints = puntosParada.map((p) =>
            L.latLng(p.ubicacion.coordinates[1], p.ubicacion.coordinates[0])
          );

          routingControl = L.Routing.control({
            waypoints: waypoints,
            router: L.Routing.osrmv1({
              serviceUrl: "https://router.project-osrm.org/route/v1",
              profile: "driving",
            }),
            lineOptions: {
              styles: [{ color: "#007bff", opacity: 0.8, weight: 6 }],
            },
            createMarker: function () {
              return null;
            },
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            show: false,
          }).addTo(map);

          const ultimoPunto = waypoints[waypoints.length - 1];
          DESTINO_ACTUAL = { lat: ultimoPunto.lat, lng: ultimoPunto.lng };
        }

        LLEGADA_DETECTADA = false;
        console.log("🚩 Destino fijado:", DESTINO_ACTUAL);
      }
    } catch (error) {
      console.error("Error cargando ruta:", error);
    }
  }

  async function inicializarSistema() {
    try {
      // --- DEFINICIÓN PREVIA PARA EVITAR EL CRASH ---
      let dataCamion = null;

      // A. Obtener Camión (Ruta Dinámica)
      const resCamion = await fetch(BACKEND_URL + "/api/camiones/mi-unidad", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // --- MANEJO DEL ESTADO ---
      if (resCamion.status === 404) {
        console.log(
          "ℹ️ Conductor logueado, pero sin horario activo en este momento."
        );
        MI_CAMION_ID = null;

        if (headerDisplay) headerDisplay.textContent = "Sin Turno Activo";
        if (busDisplay) busDisplay.textContent = "Sin Turno Activo";
        if (routeDisplay) routeDisplay.textContent = "--";
        if (statusDisplay) {
          statusDisplay.innerHTML = "● Esperando Horario";
          statusDisplay.className = "status-indicator status-off";
          statusDisplay.style.color = "gray";
        }
      } else if (!resCamion.ok) {
        console.warn("⚠️ Error desconocido al pedir camión:", resCamion.status);
        return;
      } else {
        // Si encontró camión (Status 200)
        dataCamion = await resCamion.json(); // ASIGNAMOS LA VARIABLE AQUÍ
        let textoCamion = "Sin Unidad";
        let unidad = null;

        if (dataCamion.camionId) {
          MI_CAMION_ID = dataCamion.camionId;
          unidad = dataCamion.numeroUnidad;
          textoCamion =
            `Unidad ${unidad}` +
            (dataCamion.placa ? ` (${dataCamion.placa})` : "");
        }

        if (headerDisplay) headerDisplay.textContent = textoCamion;
        if (busDisplay) busDisplay.textContent = textoCamion;

        if (
          dataCamion.ubicacionActual &&
          dataCamion.ubicacionActual.coordinates
        ) {
          const [lng, lat] = dataCamion.ubicacionActual.coordinates;
          const posInicial = new L.LatLng(lat, lng);
          driverMarker.setLatLng(posInicial);
          map.setView(posInicial, 15);
        }
      }

      // B. Obtener TODOS los horarios del día
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const todosHorarios = await resHorarios.json();

      const dias = [
        "domingo",
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
      ];
      const hoyBackend = {
        lunes: "Lunes",
        martes: "Martes",
        miercoles: "Miércoles",
        jueves: "Jueves",
        viernes: "Viernes",
        sabado: "Sábado",
        domingo: "Domingo",
      }[dias[new Date().getDay()]];

      // Filtrar mis viajes de hoy
      MIS_VIAJES_HOY = todosHorarios.filter((h) => {
        const esHoy = h.diaSemana === hoyBackend;
        const soyYo =
          h.infoConductor && h.infoConductor[0]?._id === (user._id || user.id);

        // --- CORRECCIÓN DEL CRASH AQUÍ ---
        // Verificamos si dataCamion existe antes de leer sus propiedades
        const esMiCamion =
          dataCamion &&
          String(h.camionUnidad) === String(dataCamion.numeroUnidad);

        return esHoy && (soyYo || esMiCamion);
      });

      // Ordenar por hora
      const horaAInt = (h) =>
        parseInt(h.split(":")[0]) * 60 + parseInt(h.split(":")[1]);
      MIS_VIAJES_HOY.sort((a, b) => horaAInt(a.hora) - horaAInt(b.hora));

      if (MIS_VIAJES_HOY.length === 0) {
        routeDisplay.textContent = "Día Libre";
        statusDisplay.textContent = "● Sin Recorridos";
        return;
      }

      // C. Determinar en qué viaje vamos
      const now = new Date();
      const horaActual = now.getHours() * 60 + now.getMinutes();
      let indiceEncontrado = 0;

      for (let i = 0; i < MIS_VIAJES_HOY.length; i++) {
        const horaViaje = horaAInt(MIS_VIAJES_HOY[i].hora);
        if (horaActual < horaViaje + 30) {
          indiceEncontrado = i;
          break;
        }
        if (i === MIS_VIAJES_HOY.length - 1) indiceEncontrado = i;
      }

      const ultimoViaje = MIS_VIAJES_HOY[MIS_VIAJES_HOY.length - 1];
      if (horaActual > horaAInt(ultimoViaje.hora) + 120) {
        finDelServicio();
        iniciarGeolocalizacion();
        return;
      }

      INDICE_VIAJE_ACTUAL = indiceEncontrado;
      cargarRutaActiva(MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL]);
      iniciarGeolocalizacion();
    } catch (error) {
      console.error("Error inicializando:", error);
    }
  }

  function iniciarGeolocalizacion() {
    console.log("📡 Sistema en modo: Escuchando Sockets + Fetch BD");
  }

  // ============================================================
  // 6. INICIAR MODO DE SEGUIMIENTO
  // ============================================================

  // function iniciarGeolocalizacion() {
  //   // --- CORRECCIÓN 3: MODO PASIVO ---
  //   // Ya no llamamos a navigator.geolocation.watchPosition
  //   console.log("📡 Sistema iniciado en modo RECEPTOR DE DATOS (ESP32).");
  //   console.log("   Esperando eventos 'locationUpdate' del servidor...");

  //   if (driverMarker) {
  //     // Si no se cargó la posición inicial de la BD, mostramos esto
  //     if (driverMarker.getPopup().getContent() === "Tu ubicación") {
  //       driverMarker.bindPopup("Esperando señal del ESP32...").openPopup();
  //     }
  //   }
  // }

  // 4. LÓGICA DEL MENÚ LATERAL Y MODALES

  // Toggle Sidebar
  if (btnMenuToggle) {
    btnMenuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      sidebar.classList.add("active");
    });
  }

  if (btnMenuClose) {
    btnMenuClose.addEventListener("click", () =>
      sidebar.classList.remove("active")
    );
  }

  // Cerrar sidebar al hacer click fuera
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("active") &&
      !sidebar.contains(e.target) &&
      !e.target.closest(".menu-icon")
    ) {
      sidebar.classList.remove("active");
    }
  });

  // --- MODAL PERFIL ---
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnOpenPerfilSidebar = document.getElementById(
    "btn-open-perfil-sidebar"
  );

  function abrirPerfil() {
    sidebar.classList.remove("active");

    document.getElementById("perfil-nombre").textContent =
      user.nombre || "Conductor";
    document.getElementById("perfil-email").textContent =
      user.email || "Sin correo";
    document.getElementById("perfil-id").textContent =
      user._id || user.id || "N/A";

    // --- MODIFICACIÓN INICIO ---
    // Verificamos si existe datos de conductor y si hay algo en 'licencia'
    let textoLicencia = "No registrada";

    if (user.conductor && user.conductor.licencia) {
      // Si hay una licencia (o pusiste "Si"), mostramos "Registrada"
      textoLicencia = "Registrada";
    }

    const elLicencia = document.getElementById("perfil-licencia");
    if (elLicencia) elLicencia.textContent = textoLicencia;
    // --- MODIFICACIÓN FIN ---

    modalPerfil.classList.add("modal-visible");
  }

  if (btnOpenPerfilHeader)
    btnOpenPerfilHeader.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });
  if (btnOpenPerfilSidebar)
    btnOpenPerfilSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });

  // --- MODAL HORARIOS ---
  const fullscreenHorarios = document.getElementById("fullscreen-horarios");
  const btnOpenHorarioSidebar = document.getElementById(
    "btn-open-horario-sidebar"
  );
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const calendarGrid = document.getElementById("calendario-semanal");

  async function abrirMisHorarios() {
    if (sidebar) sidebar.classList.remove("active");
    fullscreenHorarios.classList.add("active");

    calendarGrid.innerHTML =
      '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando tu agenda...</p>';

    try {
      const res = await fetch(`${BACKEND_URL}/api/horarios`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("No se pudo descargar la agenda");
      const todosLosHorarios = await res.json();

      const misHorarios = todosLosHorarios.filter((h) => {
        const info = h.infoConductor && h.infoConductor[0];
        if (info) return info._id === (user._id || user.id);
        return h.conductorNombre === user.nombre;
      });

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

      misHorarios.forEach((h) => {
        let dia = h.diaSemana;
        if (dia === "Miercoles") dia = "Miércoles";
        if (dia === "Sabado") dia = "Sábado";

        if (grupos[dia]) {
          grupos[dia].push(h);
        }
      });

      calendarGrid.innerHTML = "";

      diasOrdenados.forEach((dia) => {
        const viajes = grupos[dia];
        viajes.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));

        let contenidoHTML = "";

        if (viajes.length === 0) {
          contenidoHTML = `
                    <div class="no-service">
                        <i class="fas fa-coffee" style="font-size:1.5rem; margin-bottom:10px; display:block;"></i>
                        Descanso
                    </div>`;
        } else {
          viajes.forEach((v) => {
            contenidoHTML += `
                        <div class="cal-item">
                            <div class="cal-time-box">
                                <span class="cal-time">${v.hora}</span>
                            </div>
                            <div class="cal-info-box">
                                <span class="cal-route">${v.rutaNombre}</span>
                                <span class="cal-bus-badge">
                                    <i class="fas fa-bus"></i> ${
                                      v.camionUnidad || "S/N"
                                    }
                                </span>
                            </div>
                        </div>
                      `;
          });
        }

        calendarGrid.innerHTML += `
                <div class="day-card">
                    <div class="day-header">
                        <h3>${dia}</h3>
                        ${
                          viajes.length > 0
                            ? `<span class="badge-count">${viajes.length} Viajes</span>`
                            : ""
                        }
                    </div>
                    <div class="day-body">
                        ${contenidoHTML}
                    </div>
                </div>
              `;
      });
    } catch (error) {
      console.error(error);
      calendarGrid.innerHTML =
        '<p class="placeholder-text" style="color:var(--color-error)">Error de conexión al cargar horarios.</p>';
    }
  }

  if (btnOpenHorarioSidebar) {
    btnOpenHorarioSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirMisHorarios();
    });
  }
  if (btnCerrarHorarios) {
    btnCerrarHorarios.addEventListener("click", () => {
      fullscreenHorarios.classList.remove("active");
    });
  }

  // 5. LÓGICA DEL ESTADO DEL CONDUCTOR (Principal)

  function obtenerDiaSemana() {
    const dias = [
      "domingo",
      "lunes",
      "martes",
      "miercoles",
      "jueves",
      "viernes",
      "sabado",
    ];
    return dias[new Date().getDay()];
  }
  const mapaDiasBackend = {
    lunes: "Lunes",
    martes: "Martes",
    miercoles: "Miércoles",
    jueves: "Jueves",
    viernes: "Viernes",
    sabado: "Sábado",
    domingo: "Domingo",
  };
  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(":");
    return parseInt(h) * 60 + parseInt(m);
  }

  // Variables globales para evitar spam al servidor
  let ULTIMO_ESTADO_REPORTADO = "";

  // Función auxiliar: Convertir "06:30" a minutos (390)
  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(":");
    return parseInt(h) * 60 + parseInt(m);
  }

  // Función auxiliar: Convertir minutos (405) a "06:45"
  function minutosAHora(minutos) {
    let h = Math.floor(minutos / 60);
    const m = minutos % 60;
    h = h % 24;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }

  async function actualizarEstadoConductor() {
    try {
      const statusMsgBox = document.querySelector(".students-count");

      // Variable para guardar el número de unidad si la API /mi-unidad responde
      let unidadDetectada = null;

      // 1. INTENTO A: OBTENER CAMIÓN ASIGNADO DIRECTAMENTE
      const resCamion = await fetch(BACKEND_URL + "/api/camiones/mi-unidad", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (resCamion.ok) {
        const dataCamion = await resCamion.json();
        if (dataCamion.camionId) {
          MI_CAMION_ID = dataCamion.camionId;
          unidadDetectada = dataCamion.numeroUnidad;

          let textoCamion =
            `Unidad ${unidadDetectada}` +
            (dataCamion.placa ? ` (${dataCamion.placa})` : "");
          if (headerDisplay) headerDisplay.textContent = textoCamion;
          if (busDisplay) busDisplay.textContent = textoCamion;
        }
      } else {
        console.warn(
          "⚠️ API /mi-unidad dio 404. Usaremos el Horario para buscar el camión."
        );
      }

      // 2. OBTENER HORARIOS
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resHorarios.ok) return;

      const todosHorarios = await resHorarios.json();

      // Filtrar horarios de HOY
      const diasArr = [
        "domingo",
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
      ];
      const hoyIndex = new Date().getDay();
      const mapaDiasBackend = {
        lunes: "Lunes",
        martes: "Martes",
        miercoles: "Miércoles",
        jueves: "Jueves",
        viernes: "Viernes",
        sabado: "Sábado",
        domingo: "Domingo",
      };
      const hoyFormatted = mapaDiasBackend[diasArr[hoyIndex]];

      const salidasHoy = todosHorarios.filter((h) => {
        const esDia = h.diaSemana === hoyFormatted;
        const infoCond = h.infoConductor && h.infoConductor[0];
        const soyYo = infoCond && infoCond._id === (user._id || user.id);
        const nombreCoincide = h.conductorNombre === user.nombre;
        const esMiCamion = unidadDetectada
          ? String(h.camionUnidad) === String(unidadDetectada)
          : false;

        return esDia && (soyYo || esMiCamion || nombreCoincide);
      });

      // Ordenar por hora
      salidasHoy.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));

      // 3. DETERMINAR VIAJE ACTIVO
      const now = new Date();
      const minutosActuales = now.getHours() * 60 + now.getMinutes();

      let viajeActivo = null;
      let viajeSiguiente = null;
      let estadoActual = "Fuera de Servicio";
      let esPreparacion = false;

      for (let i = 0; i < salidasHoy.length; i++) {
        const viaje = salidasHoy[i];
        const inicio = horaAEntero(viaje.hora);
        const duracion = viaje.rutaDuracion || 45;
        const fin = inicio + duracion;

        if (minutosActuales >= inicio - 15 && minutosActuales < inicio) {
          viajeActivo = viaje;
          viajeActivo.horaFin = minutosAHora(fin);
          esPreparacion = true;
          break;
        }
        if (minutosActuales >= inicio && minutosActuales <= fin) {
          viajeActivo = viaje;
          viajeActivo.horaFin = minutosAHora(fin);
          break;
        }
        if (minutosActuales < inicio && !viajeSiguiente) {
          viajeSiguiente = viaje;
        }
      }

      // --- 4. LÓGICA PRINCIPAL DE RECUPERACIÓN ---
      if (viajeActivo) {
        // >>>>> AQUÍ ESTÁ LA SOLUCIÓN <<<<<
        // Si no tenemos ID, usamos 'camionUnidad' ("TEC-01") para buscarlo en la BD
        if (!MI_CAMION_ID && viajeActivo.camionUnidad) {
          console.log(
            `🔎 Buscando ID para la unidad: ${viajeActivo.camionUnidad}...`
          );

          try {
            // Pedimos la lista de todos los camiones
            const resAllBus = await fetch(BACKEND_URL + "/api/camiones", {
              headers: { Authorization: `Bearer ${token}` },
            });

            if (resAllBus.ok) {
              const listaCamiones = await resAllBus.json();

              // Buscamos el camión que tenga ese numeroUnidad o placa
              const camionEncontrado = listaCamiones.find(
                (c) =>
                  String(c.numeroUnidad) === String(viajeActivo.camionUnidad) ||
                  c.placa === viajeActivo.camionUnidad
              );

              if (camionEncontrado) {
                MI_CAMION_ID = camionEncontrado._id || camionEncontrado.id;
                console.log(
                  "✅ ¡ID RECUPERADO POR NOMBRE DE UNIDAD!",
                  MI_CAMION_ID
                );

                // Forzamos actualización visual del nombre del camión
                const texto = `Unidad ${camionEncontrado.numeroUnidad} (${camionEncontrado.placa})`;
                if (headerDisplay) headerDisplay.textContent = texto;
                if (busDisplay) busDisplay.textContent = texto;
              } else {
                console.error(
                  "❌ No existe ningún camión en la BD con número:",
                  viajeActivo.camionUnidad
                );
              }
            }
          } catch (errBus) {
            console.error("Error buscando camión por nombre:", errBus);
          }
        }
        // >>>>> FIN SOLUCIÓN <<<<<

        // Actualizar UI
        const textoUnidadActiva = `Unidad ${
          viajeActivo.camionUnidad || "Asignada"
        }`;
        if (!MI_CAMION_ID) {
          // Solo si no lo encontramos arriba
          if (headerDisplay) headerDisplay.textContent = textoUnidadActiva;
          if (busDisplay) busDisplay.textContent = textoUnidadActiva;
        }

        routeDisplay.textContent = viajeActivo.rutaNombre;
        iniciarGeolocalizacion();

        if (MI_RUTA_NOMBRE !== viajeActivo.rutaNombre) {
          MI_RUTA_NOMBRE = viajeActivo.rutaNombre;
          cargarRutaActiva(viajeActivo);
        }

        if (esPreparacion) {
          estadoActual = "Inicio de Recorridos";
          statusDisplay.innerHTML = `● Preparando Salida (${viajeActivo.hora})`;
          statusDisplay.className = "status-indicator status-on";
          statusDisplay.style.color = "var(--color-warning)";
          if (statusMsgBox) {
            statusMsgBox.innerHTML = '<i class="fas fa-clock"></i> Abordando';
            statusMsgBox.style.color = "var(--color-warning)";
          }
        } else {
          estadoActual = "En Servicio";
          statusDisplay.innerHTML = `● En Ruta (Llegada: ${viajeActivo.horaFin})`;
          statusDisplay.className = "status-indicator status-on";
          statusDisplay.style.color = "var(--color-exito)";
          if (statusMsgBox) {
            statusMsgBox.innerHTML = '<i class="fas fa-road"></i> En Ruta';
            statusMsgBox.style.color = "var(--color-exito)";
          }
        }
      } else {
        // --- CASO: FUERA DE SERVICIO ---
        if (!resCamion.ok) {
          MI_CAMION_ID = null;
          if (headerDisplay) headerDisplay.textContent = "Sin Turno Activo";
          if (busDisplay) busDisplay.textContent = "Sin Turno Activo";
        }

        statusDisplay.className = "status-indicator status-off";
        statusDisplay.style.color = "var(--color-error)";

        if (viajeSiguiente) {
          routeDisplay.textContent = "En Espera";
          statusDisplay.innerHTML = `● Siguiente: ${viajeSiguiente.hora} (${viajeSiguiente.rutaNombre})`;
          estadoActual = "En Espera";
          if (statusMsgBox) {
            statusMsgBox.innerHTML = '<i class="fas fa-coffee"></i> En Espera';
            statusMsgBox.style.color = "gray";
          }
        } else {
          routeDisplay.textContent = "Jornada Finalizada";
          statusDisplay.innerHTML = "● Fuera de Servicio";
          estadoActual = "Fuera de Servicio";
          if (statusMsgBox) {
            statusMsgBox.innerHTML = '<i class="fas fa-ban"></i> Terminado';
            statusMsgBox.style.color = "var(--color-error)";
          }
        }
      }

      gestionarEstadoBD(estadoActual);
    } catch (error) {
      console.error("Error estado conductor:", error);
      if (statusDisplay) {
        statusDisplay.textContent = "Error de Sistema";
        statusDisplay.style.color = "red";
      }
    }
  }

  // Nueva función para no saturar el servidor con PUTs repetidos
  async function gestionarEstadoBD(nuevoEstado) {
    if (ULTIMO_ESTADO_REPORTADO !== nuevoEstado) {
      try {
        console.log(
          `🔄 Actualizando estado en BD: ${ULTIMO_ESTADO_REPORTADO} -> ${nuevoEstado}`
        );

        // Usamos el endpoint de usuarios existente
        const userId = user._id || user.id;
        await fetch(`${BACKEND_URL}/api/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          // Solo actualizamos el estado, mantenemos el tipo conductor
          body: JSON.stringify({
            estado: nuevoEstado,
            tipo: "conductor",
          }),
        });

        ULTIMO_ESTADO_REPORTADO = nuevoEstado;
      } catch (e) {
        console.error("Error sincronizando estado con BD", e);
      }
    }
  }
  // 7. REPORTAR INCIDENTE
  const incidentModal = document.getElementById("incident-modal");
  const btnMainReporte = document.getElementById("btn-reporte-incidente");
  const btnSendIncident = document.getElementById("send-incident");

  const btnCloseIncident = incidentModal.querySelector(".close-button");
  if (btnCloseIncident) {
    btnCloseIncident.onclick = () =>
      incidentModal.classList.remove("modal-visible");
  }

  if (btnMainReporte) {
    btnMainReporte.onclick = () => incidentModal.classList.add("modal-visible");
  }

  window.onclick = (event) => {
    if (event.target.classList.contains("modal")) {
      event.target.classList.remove("modal-visible");
    }
  };

  if (btnSendIncident) {
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

        document.getElementById("incident-type").value = "";
        document.getElementById("incident-details").value = "";
      } else if (!MI_CAMION_ID) {
        alert("No tienes un camión asignado para reportar incidentes.");
      } else {
        alert("Por favor selecciona un tipo de incidente.");
      }
    };
  }

  // frontend/assets/js/driver_map.js

  // 1. Definir el Icono del Estudiante (Amarillo para resaltar)
  const studentIcon = L.divIcon({
    className: "student-marker",
    html: `<div style="
        background-color: #ffc107; 
        color: #000; 
        width: 30px; height: 30px; 
        border-radius: 50%; 
        border: 2px solid white; 
        display: flex; justify-content: center; align-items: center;
        box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        font-size: 14px;">
        <i class="fas fa-hand-paper"></i>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });

  // 2. Escuchar el evento cuando un estudiante dice "Estoy Aquí"
  socket.on("studentWaiting", (data) => {
    // Opcional: Filtrar si solo quieres ver estudiantes de TU ruta actual
    // if (currentRutaId && data.rutaId !== currentRutaId) return;

    console.log("🔔 Estudiante solicitando parada:", data);

    // Reproducir sonido (opcional)
    // const audio = new Audio('assets/sounds/notification.mp3');
    // audio.play().catch(e => console.log("Audio bloqueado por navegador"));

    // Agregar marcador al mapa
    const marker = L.marker([data.location.lat, data.location.lng], {
      icon: studentIcon,
    })
      .addTo(map)
      .bindPopup(
        `
            <strong>¡Parada Solicitada!</strong><br>
            <small>Hace un momento</small>
        `
      )
      .openPopup();

    // AUTO-ELIMINAR: Quitar el marcador después de 5 minutos (300,000 ms)
    // para no llenar el mapa de puntos viejos.
    setTimeout(() => {
      map.removeLayer(marker);
    }, 300000);
  });

  // 8. CERRAR SESIÓN
  const btnLogout = document.getElementById("logout-button");
  const btnSidebarLogout = document.getElementById("sidebar-logout");

  function logoutAction(e) {
    e.preventDefault();
    if (confirm("¿Estás seguro de que quieres cerrar sesión?")) {
      localStorage.removeItem("tecbus_token");
      localStorage.removeItem("tecbus_user");
      window.location.href = "login.html";
    }
  }

  if (btnLogout) btnLogout.addEventListener("click", logoutAction);
  if (btnSidebarLogout)
    btnSidebarLogout.addEventListener("click", logoutAction);

  // 9. DROPDOWN PERFIL
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");

  if (user && document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent =
      user.nombre.split(" ")[0];
  }

  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }

  // 7. ARRANCAR EL SISTEMA
  inicializarSistema();
  actualizarEstadoConductor();
  setInterval(actualizarEstadoConductor, 60000);
});
