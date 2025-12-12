// frontend/assets/js/admin_dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICACIÓN DE SEGURIDAD ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");
  if (!token || !userString) {
    window.location.href = "login.html";
    return;
  }
  const user = JSON.parse(userString);
  if (user.tipo !== "administrador") {
    alert("Acceso denegado.");
    window.location.href = "login.html";
    return;
  }

  // Activar usuario al entrar (Lógica de V2)
  if (user && user.id) {
    fetch(`${BACKEND_URL}/api/users/${user.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ estado: "activo" }),
    }).catch((err) => console.log("Error activando usuario al inicio", err));
  }

  // --- MOSTRAR FECHA ACTUAL (Recuperado de V1) ---
  const currentDateEl = document.getElementById("current-date");
  if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // --- Variables Globales de Datos ---
  let camionesCargados = [];
  let rutasCargadas = [];
  let usuariosCargados = [];
  let horariosCargados = [];
  let alertasCargadas = [];
  let busMarkers = {};
  let alertCount = 0;

  // --- Configuración Inicial ---
  // Lugares clave para el buscador
  const LUGARES_CLAVE = [
    {
      nombre: "Instituto Tecnológico Superior de Guasave (TEC)",
      lat: 25.523708,
      lon: -108.382035,
      tipo: "escuela",
    },
    {
      nombre: "Central Camionera Regional de Guasave",
      lat: 25.570119,
      lon: -108.473013,
      tipo: "estacion",
    },
    { nombre: "Rochin", lat: 25.579152, lon: -108.462641, tipo: "tienda" },
  ];

  // Conexión Socket
  const socket = io(SOCKET_URL);
  socket.on("connect", () =>
    console.log("🔌 Admin Dashboard conectado a Socket.io:", socket.id)
  );

  // ============================================================
  //  DETECTOR DE CAMBIO DE PESTAÑA (Sincronización con Sidebar)
  // ============================================================
  const navLinks = document.querySelectorAll(".nav-item");
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetId = link.getAttribute("href");

      // Si es cerrar sesión, ejecutamos logout (Por si acaso está aquí el botón)
      if (
        link.id === "btn-cerrar-sesion" ||
        link.classList.contains("logout-item")
      ) {
        return; // La lógica de logout se maneja aparte o en sidebar.js
      }

      // Cargar datos según la sección que el usuario eligió
      if (targetId === "#mapa") inicializarDashboard();
      if (targetId === "#usuarios") cargarUsuarios();
      if (targetId === "#camiones") cargarCamiones();
      if (targetId === "#rutas") cargarRutas();
      if (targetId === "#horarios") {
        cargarHorarios();
        popularDropdownsHorarios();
      }
      if (targetId === "#alertas") cargarAlertas();
    });
  });

  // Carga inicial por defecto (Mapa y KPIs)
  inicializarDashboard();

  // ============================================================
  //  3. LÓGICA DEL MAPA
  // ============================================================
  const initialLat = 25.567,
    initialLng = -108.473,
    initialZoom = 13;
  const map = L.map("admin-map").setView([initialLat, initialLng], initialZoom);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);

  const busIcon = L.divIcon({
    className: "custom-bus-icon",
    html: `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align: center; color: white; border: 2px solid white; font-size: 14px;"><i class="fas fa-bus"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
  const alertIcon = L.divIcon({
    className: "custom-bus-icon-alert",
    html: `<div style="background-color:var(--color-error); border-radius: 50%; width: 35px; height: 35px; display: flex; justify-content: center; align-items: center; color: white; border: 3px solid white; font-size: 16px; animation: pulse 1.5s infinite;"><i class="fas fa-bus"></i></div>`,
    iconSize: [35, 35],
    iconAnchor: [17, 17],
  });

  // --- FUNCIÓN PRINCIPAL DASHBOARD (KPIs y Mapa) ---
  async function inicializarDashboard() {
    console.log("🔄 Cargando datos del dashboard...");

    // 1. Camiones (Lo usaremos para el KPI de Total)
    try {
      const res = await fetch(BACKEND_URL + "/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const camiones = await res.json();
        camionesCargados = camiones;

        // Limpiar y redibujar marcadores
        Object.values(busMarkers).forEach((m) => map.removeLayer(m));
        busMarkers = {};

        // --- AQUÍ ACTUALIZAMOS EL KPI DE TOTAL DE CAMIONES ---
        const elTotal = document.getElementById("kpi-total-buses");
        if (elTotal) elTotal.textContent = camiones.length;

        camiones.forEach((c) => {
          if (c.ubicacionActual && c.ubicacionActual.coordinates) {
            const [lng, lat] = c.ubicacionActual.coordinates;
            const m = L.marker([lat, lng], { icon: busIcon })
              .addTo(map)
              .bindPopup(
                `🚍 <b>${c.numeroUnidad}</b><br>Vel: ${c.velocidad || 0} km/h`
              );
            busMarkers[c._id] = m;
          }
        });
      }
    } catch (e) {
      console.error("Error camiones:", e);
    }

    // 2. Conductores Activos (CORREGIDO)
    try {
      const res = await fetch(BACKEND_URL + "/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const users = await res.json();
        usuariosCargados = users;

        // --- CORRECCIÓN CLAVE: ACEPTAR MÁS ESTADOS ---
        const conductoresActivos = users.filter((u) => {
          if (u.tipo !== "conductor") return false;

          // Lista de estados que consideramos "Trabajando"
          const estadosActivos = [
            "En Servicio",
            "Abordando",
            "Inicio de Recorridos",
            "En Ruta",
          ];

          // Verificamos si el estado del usuario está en la lista
          return estadosActivos.includes(u.estado);
        });

        // Actualizamos el KPI
        const elDrivers = document.getElementById("kpi-drivers-active");
        if (elDrivers) elDrivers.textContent = conductoresActivos.length;
      }
    } catch (e) {
      console.error("Error usuarios:", e);
    }

    // 3. Alertas
    try {
      const res = await fetch(BACKEND_URL + "/api/notificaciones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const alerts = await res.json();
        // Filtramos solo las de hoy o recientes si quieres, o todas
        alertCount = alerts.length;
        const elAlerts = document.getElementById("kpi-active-alerts");
        if (elAlerts) elAlerts.textContent = alertCount;
      }
    } catch (e) {
      console.error("Error alertas:", e);
    }
  }

  const kpiStudents = document.getElementById("kpi-students-waiting");
  const kpiAlerts = document.getElementById("kpi-active-alerts");
  let studentCount = 0;

  // --- SOCKETS ---
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
      // Si es un camión nuevo, recargamos todo el mapa para asegurarnos
      inicializarDashboard();
    }
  });

  socket.on("newIncidentAlert", (data) => {
    alert(`🚨 ¡NUEVO INCIDENTE!\nCamión: ${data.camionId}\nTipo: ${data.tipo}`);
    alertCount++;
    if (kpiAlerts) kpiAlerts.textContent = alertCount;

    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setIcon(alertIcon);
      marker
        .bindPopup(`🚨 <b>ALERTA: ${data.tipo}</b><br>${data.detalles || ""}`)
        .openPopup();
    }
  });

  socket.on("studentWaiting", (data) => {
    console.log("🙋‍♂️ Estudiante esperando:", data);
    studentCount++;
    if (kpiStudents) kpiStudents.textContent = studentCount;

    if (data.location && data.location.lat && data.location.lng) {
      L.circle([data.location.lat, data.location.lng], {
        color: "var(--color-exito)",
        fillColor: "#2ecc71",
        fillOpacity: 0.5,
        radius: 30,
      })
        .addTo(map)
        .bindPopup(
          `<b>Estudiante Esperando</b><br>Hora: ${new Date().toLocaleTimeString()}`
        );
    }
  });

  window.abrirModalBusqueda = function (tipo) {
    if (tipo === "horario") {
      popularDropdownsHorarios("buscar");
    }
    const modal = document.getElementById(`search-${tipo}-modal`);
    if (modal) modal.classList.add("modal-visible");
  };

  // Cerrar cualquier modal con la X o botón cerrar
  document.addEventListener("click", (e) => {
    // Cerrar con botón X o Cancelar
    if (
      e.target.matches(".close-button") ||
      e.target.matches(".btn-secondary")
    ) {
      const modal = e.target.closest(".modal");
      const overlay = e.target.closest(".fullscreen-overlay");
      if (modal) modal.classList.remove("modal-visible");
      if (overlay) overlay.classList.remove("active");
      // Si es botón limpiar/cancelar de búsqueda, reseteamos el form
      if (e.target.classList.contains("btn-reset-search")) {
        const form = e.target.closest("form");
        if (form) form.reset();
        // Recargar tabla completa
        if (form.id.includes("usuario")) renderTablaUsuarios(usuariosCargados);
        if (form.id.includes("camion")) renderTablaCamiones(camionesCargados);
        if (form.id.includes("ruta")) renderTablaRutas(rutasCargadas);
        if (form.id.includes("horario")) renderTablaHorarios(horariosCargados);
        if (form.id.includes("alerta")) renderTablaAlertas(alertasCargadas);
      }
    }
    // Cerrar al dar click fuera (backdrop)
    if (e.target.classList.contains("modal")) {
      e.target.classList.remove("modal-visible");
    }
  });

  // ============================================================
  //  4. CRUD USUARIOS
  // ============================================================
  const modalUser = document.getElementById("edit-user-modal");
  const modalFormUser = document.getElementById("form-edit-user");
  const closeModalBtnUser = modalUser?.querySelector(".close-button");
  const camposConductorEdit = document.getElementById("campos-conductor");
  const formRegistrarUsuario = document.getElementById(
    "form-registrar-usuario"
  );
  const userTipoSelect = document.getElementById("user-tipo");
  const camposConductorNew = document.getElementById(
    "new-user-conductor-fields"
  );

  // Lógica campos dinámicos
  if (userTipoSelect) {
    userTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor") {
        camposConductorNew.style.display = "block";
      } else {
        camposConductorNew.style.display = "none";
        document.getElementById("user-licencia").value = "Si";
      }
    });
  }
  const editUserTipoSelect = document.getElementById("edit-user-tipo");
  if (editUserTipoSelect) {
    editUserTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor")
        camposConductorEdit.style.display = "block";
      else camposConductorEdit.style.display = "none";
    });
  }

  function renderTablaUsuarios(lista) {
    const tbody = document.getElementById("tabla-usuarios-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No hay usuarios.</td></tr>';
      return;
    }

    lista.forEach((u) => {
      const row = document.createElement("tr");

      // 1. LÓGICA DE COLOR PARA LA COLUMNA "TIPO"
      let badgeClass = "badge-secondary";
      let tipoTexto = u.tipo.charAt(0).toUpperCase() + u.tipo.slice(1); // Capitalizar

      if (u.tipo === "administrador") {
        badgeClass = "badge-admin"; // Verde
      } else if (u.tipo === "conductor") {
        badgeClass = "badge-conductor"; // Naranja
      } else if (u.tipo === "estudiante") {
        badgeClass = "badge-estudiante"; // Azul
      }

      // 2. LÓGICA PARA LA COLUMNA "ESTADO" (Activo vs Inactivo)
      let estaActivo = false;
      let textoEstadoReal = "Inactivo";

      if (u.tipo === "conductor") {
        // Lógica Especial Conductor: Depende del horario/servicio
        if (u.estado === "En Servicio") {
          estaActivo = true;
          textoEstadoReal = "Activo";
        } else {
          estaActivo = false;
          textoEstadoReal = "Inactivo";
        }
      } else {
        // Lógica Admin/Estudiante
        if (u.estado === "activo" || u.estado === "online") {
          estaActivo = true;
          textoEstadoReal = "Activo";
        } else {
          estaActivo = false;
          textoEstadoReal = "Inactivo";
        }
      }

      // Generar HTML del estado (Bolita verde o roja)
      const estadoHtml = estaActivo
        ? `<span class="status-active">● Activo</span>`
        : `<span class="status-inactive">● Inactivo</span>`;

      // 3. RENDERIZADO
      row.innerHTML = `
        <td>${u.nombre}</td>
        <td>${u.email}</td>
        <td><span class="badge ${badgeClass}">${tipoTexto}</span></td>
        <td>${estadoHtml}</td>
        <td>
            <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${u._id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm btn-delete-user" data-id="${u._id}"><i class="fas fa-trash"></i></button>
        </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarUsuarios() {
    const tablaBody = document.getElementById("tabla-usuarios-body");
    if (tablaBody)
      tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch(BACKEND_URL + "/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error usuarios");
      usuariosCargados = await response.json();
      renderTablaUsuarios(usuariosCargados);
    } catch (error) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }

  // Buscador Usuarios
  const formSearchUsuario = document.getElementById("form-search-usuario");
  if (formSearchUsuario) {
    formSearchUsuario.addEventListener("submit", (e) => {
      e.preventDefault();
      const nombre = document
        .getElementById("search-user-nombre")
        .value.toLowerCase();
      const email = document
        .getElementById("search-user-email")
        .value.toLowerCase();
      const tipo = document.getElementById("search-user-tipo").value;
      const estado = document.getElementById("search-user-estado").value;

      const filtrados = usuariosCargados.filter((user) => {
        const matchNombre =
          !nombre || user.nombre.toLowerCase().includes(nombre);
        const matchEmail = !email || user.email.toLowerCase().includes(email);
        const matchTipo = !tipo || user.tipo === tipo;
        const matchEstado = !estado || (user.estado || "activo") === estado;
        return matchNombre && matchEmail && matchTipo && matchEstado;
      });
      renderTablaUsuarios(filtrados);
      document
        .getElementById("search-usuario-modal")
        .classList.remove("modal-visible");
    });
  }

  // Registrar Usuario
  if (formRegistrarUsuario) {
    formRegistrarUsuario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tipo = document.getElementById("user-tipo").value;
      const datos = {
        nombre: document.getElementById("user-nombre").value,
        email: document.getElementById("user-email").value,
        password: document.getElementById("user-password").value,
        tipo: tipo,
      };
      if (tipo === "conductor") {
        datos.licencia = document.getElementById("user-licencia").value;
      }
      try {
        const response = await fetch(BACKEND_URL + "/api/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error registro");
        alert("¡Usuario registrado!");
        formRegistrarUsuario.reset();
        camposConductorNew.style.display = "none";
        cargarUsuarios();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // Eventos Tabla Usuarios (Editar/Borrar)
  const tablaBodyUsuarios = document.getElementById("tabla-usuarios-body");
  if (tablaBodyUsuarios) {
    tablaBodyUsuarios.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-user");
      const btnDelete = e.target.closest(".btn-delete-user");
      if (btnEdit) {
        const user = usuariosCargados.find((u) => u._id === btnEdit.dataset.id);
        if (user) openEditUserModal(user);
      }
      if (btnDelete) handleDeleteUser(btnDelete.dataset.id);
    });
  }

  function openEditUserModal(user) {
    document.getElementById("edit-user-id").value = user._id;
    document.getElementById("edit-user-nombre").value = user.nombre;
    document.getElementById("edit-user-email").value = user.email;
    document.getElementById("edit-user-tipo").value = user.tipo;
    if (user.tipo === "conductor") {
      camposConductorEdit.style.display = "block";
      document.getElementById("edit-user-licencia").value =
        user.conductor?.licencia || "No";
    } else {
      camposConductorEdit.style.display = "none";
    }
    modalUser.classList.add("modal-visible");
  }

  if (closeModalBtnUser)
    closeModalBtnUser.onclick = () =>
      modalUser.classList.remove("modal-visible");

  if (modalFormUser) {
    modalFormUser.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-user-id").value;
      const tipo = document.getElementById("edit-user-tipo").value;
      const datos = {
        nombre: document.getElementById("edit-user-nombre").value,
        email: document.getElementById("edit-user-email").value,
        tipo: tipo,
      };
      if (tipo === "conductor") {
        datos.licencia = document.getElementById("edit-user-licencia").value;
      }
      try {
        const response = await fetch(`${BACKEND_URL}/api/users/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualización");
        alert("¡Usuario actualizado!");
        modalUser.classList.remove("modal-visible");
        cargarUsuarios();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  async function handleDeleteUser(id) {
    if (!confirm("¿Eliminar usuario?")) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error eliminando");
      alert("✅ Usuario eliminado");
      cargarUsuarios();
      inicializarDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  // ============================================================
  //  5. CRUD CAMIONES
  // ============================================================
  const modalCamion = document.getElementById("edit-camion-modal");
  const modalFormCamion = document.getElementById("form-edit-camion");
  const closeModalBtnCamion = modalCamion?.querySelector(".close-button");

  function renderTablaCamiones(lista) {
    const tbody = document.getElementById("tabla-camiones-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (lista.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5">No se encontraron camiones.</td></tr>';
      return;
    }

    lista.forEach((c) => {
      const row = document.createElement("tr");

      // Lógica de Estado del Camión
      let estaActivo = false;
      if (c.estado === "En Servicio") {
        estaActivo = true;
      }

      const estadoHtml = estaActivo
        ? `<span class="status-active">● Activo</span>`
        : `<span class="status-inactive">● Inactivo</span>`;

      row.innerHTML = `
          <td>${c.placa}</td>
          <td>${c.numeroUnidad}</td>
          <td>${c.modelo || "N/A"}</td>
          <td>${estadoHtml}</td>
          <td>
              <button class="btn btn-secondary btn-sm btn-edit-camion" data-id="${
                c._id
              }"><i class="fas fa-edit"></i></button>
              <button class="btn btn-danger btn-sm btn-delete-camion" data-id="${
                c._id
              }"><i class="fas fa-trash"></i></button>
          </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarCamiones() {
    const tablaBody = document.getElementById("tabla-camiones-body");
    if (tablaBody)
      tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch(BACKEND_URL + "/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error");
      camionesCargados = await response.json();
      renderTablaCamiones(camionesCargados);
    } catch (e) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${e.message}</td></tr>`;
    }
  }

  const formSearchCamion = document.getElementById("form-search-camion");
  if (formSearchCamion) {
    formSearchCamion.addEventListener("submit", (e) => {
      e.preventDefault();
      const placa = document
        .getElementById("search-camion-placa")
        .value.toLowerCase();
      const unidad = document
        .getElementById("search-camion-unidad")
        .value.toLowerCase();
      const modelo = document
        .getElementById("search-camion-modelo")
        .value.toLowerCase();
      const capacidad = document.getElementById(
        "search-camion-capacidad"
      ).value;
      const estado = document.getElementById("search-camion-estado").value;

      const filtrados = camionesCargados.filter((c) => {
        const matchPlaca = !placa || c.placa.toLowerCase().includes(placa);
        const matchUnidad =
          !unidad || c.numeroUnidad.toLowerCase().includes(unidad);
        const matchModelo =
          !modelo || (c.modelo && c.modelo.toLowerCase().includes(modelo));
        // Comparación flexible de capacidad (si escriben 40, busca los de 40)
        const matchCapacidad =
          !capacidad || (c.capacidad && c.capacidad.toString() === capacidad);
        //const matchEstado = !estado || c.estado === estado;

        let matchEstado = true;
        if (estado === "Activo") {
          // Consideramos activo si está En Servicio
          matchEstado = c.estado === "En Servicio";
        } else if (estado === "Inactivo") {
          // Consideramos inactivo cualquier otra cosa
          matchEstado = c.estado !== "En Servicio";
        }

        return (
          matchPlaca &&
          matchUnidad &&
          matchModelo &&
          matchCapacidad &&
          matchEstado
        );
      });
      renderTablaCamiones(filtrados);
      document
        .getElementById("search-camion-modal")
        .classList.remove("modal-visible");
    });
  }

  const formRegistrarCamion = document.getElementById("form-registrar-camion");
  if (formRegistrarCamion) {
    formRegistrarCamion.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        placa: document.getElementById("camion-placa").value,
        numeroUnidad: document.getElementById("camion-unidad").value,
        modelo: document.getElementById("camion-modelo").value,
        capacidad: document.getElementById("camion-capacidad").value,
      };
      try {
        const response = await fetch(BACKEND_URL + "/api/camiones", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error registrar");
        alert("¡Camión registrado!");
        formRegistrarCamion.reset();
        cargarCamiones();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const tablaBodyCamiones = document.getElementById("tabla-camiones-body");
  if (tablaBodyCamiones) {
    tablaBodyCamiones.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-camion");
      const btnDelete = e.target.closest(".btn-delete-camion");
      if (btnEdit) {
        const c = camionesCargados.find((x) => x._id === btnEdit.dataset.id);
        if (c) openEditCamionModal(c);
      }
      if (btnDelete) handleDeleteCamion(btnDelete.dataset.id);
    });
  }

  function openEditCamionModal(camion) {
    document.getElementById("edit-camion-id").value = camion._id;
    document.getElementById("edit-camion-placa").value = camion.placa;
    document.getElementById("edit-camion-unidad").value = camion.numeroUnidad;
    document.getElementById("edit-camion-modelo").value = camion.modelo || "";
    document.getElementById("edit-camion-capacidad").value =
      camion.capacidad || "";
    modalCamion.classList.add("modal-visible");
  }

  async function handleDeleteCamion(id) {
    if (!confirm("¿Eliminar camión?")) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Camión eliminado!");
      cargarCamiones();
      inicializarDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  if (closeModalBtnCamion)
    closeModalBtnCamion.onclick = () =>
      modalCamion.classList.remove("modal-visible");

  if (modalFormCamion) {
    modalFormCamion.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-camion-id").value;
      const datos = {
        placa: document.getElementById("edit-camion-placa").value,
        numeroUnidad: document.getElementById("edit-camion-unidad").value,
        modelo: document.getElementById("edit-camion-modelo").value,
        capacidad: document.getElementById("edit-camion-capacidad").value,
      };
      try {
        const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualizar");
        alert("¡Camión actualizado!");
        modalCamion.classList.remove("modal-visible");
        cargarCamiones();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  6. CRUD RUTAS
  // ============================================================
  const modalRuta = document.getElementById("edit-ruta-modal");
  const modalFormRuta = document.getElementById("form-edit-ruta");
  const closeModalBtnRuta = modalRuta?.querySelector(".close-button");

  function renderTablaRutas(lista) {
    const tablaBody = document.getElementById("tabla-rutas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (lista.length === 0) {
      tablaBody.innerHTML =
        '<tr><td colspan="5">No se encontraron rutas.</td></tr>';
      return;
    }
    lista.forEach((r) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${r.nombre}</td><td>${
        r.descripcion || "N/A"
      }</td><td><span class="badge ${
        r.activa ? "badge-admin" : "badge-conductor"
      }">${r.activa ? "Activa" : "Inactiva"}</span></td>
      <td><button class="btn btn-secondary btn-sm btn-edit-ruta" data-id="${
        r._id
      }"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm btn-delete-ruta" data-id="${
        r._id
      }"><i class="fas fa-trash"></i></button></td>
      <td><button class="btn btn-primary btn-sm btn-edit-mapa-ruta" data-id="${
        r._id
      }"><i class="fas fa-map-marked-alt"></i> Editar Trazado</button></td>`;
      tablaBody.appendChild(row);
    });
  }

  async function cargarRutas() {
    try {
      const response = await fetch(BACKEND_URL + "/api/rutas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      rutasCargadas = await response.json();
      renderTablaRutas(rutasCargadas);
    } catch (e) {}
  }

  const formSearchRuta = document.getElementById("form-search-ruta");
  if (formSearchRuta) {
    formSearchRuta.addEventListener("submit", (e) => {
      e.preventDefault();
      const nombre = document
        .getElementById("search-ruta-nombre")
        .value.toLowerCase();
      const activaVal = document.getElementById("search-ruta-activa").value;
      const filtrados = rutasCargadas.filter((r) => {
        const matchName = !nombre || r.nombre.toLowerCase().includes(nombre);
        let matchActive = true;
        if (activaVal !== "") {
          matchActive = r.activa === (activaVal === "true");
        }
        return matchName && matchActive;
      });
      renderTablaRutas(filtrados);
      document
        .getElementById("search-ruta-modal")
        .classList.remove("modal-visible");
    });
  }

  const formRegistrarRuta = document.getElementById("form-registrar-ruta");
  if (formRegistrarRuta) {
    formRegistrarRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById("ruta-nombre").value,
        descripcion: document.getElementById("ruta-descripcion").value,
        tiempoEstimadoTotal: document.getElementById("ruta-tiempo").value,
      };
      try {
        const response = await fetch(BACKEND_URL + "/api/rutas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error al registrar");
        alert("¡Ruta registrada!");
        formRegistrarRuta.reset();
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const tablaBodyRutas = document.getElementById("tabla-rutas-body");
  if (tablaBodyRutas) {
    tablaBodyRutas.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-ruta");
      const btnDelete = e.target.closest(".btn-delete-ruta");
      const btnEditMapa = e.target.closest(".btn-edit-mapa-ruta");
      if (btnEdit) {
        const r = rutasCargadas.find((x) => x._id === btnEdit.dataset.id);
        if (r) openEditRutaModal(r);
      }
      if (btnDelete) handleDeleteRuta(btnDelete.dataset.id);
      if (btnEditMapa) {
        const r = rutasCargadas.find((x) => x._id === btnEditMapa.dataset.id);
        if (r) openEditRutaMapaModal(r);
      }
    });
  }

  async function handleDeleteRuta(id) {
    if (!confirm("¿Eliminar ruta?")) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error eliminar");
      alert("¡Ruta eliminada!");
      cargarRutas();
    } catch (error) {
      alert(error.message);
    }
  }

  function openEditRutaModal(ruta) {
    document.getElementById("edit-ruta-id").value = ruta._id;
    document.getElementById("edit-ruta-nombre").value = ruta.nombre;
    document.getElementById("edit-ruta-descripcion").value =
      ruta.descripcion || "";
    document.getElementById("edit-ruta-tiempo").value =
      ruta.tiempoEstimadoTotal || "";
    document.getElementById("edit-ruta-activa").value = ruta.activa;
    modalRuta.classList.add("modal-visible");
  }

  if (closeModalBtnRuta)
    closeModalBtnRuta.onclick = () =>
      modalRuta.classList.remove("modal-visible");

  if (modalFormRuta) {
    modalFormRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-id").value;
      const datos = {
        nombre: document.getElementById("edit-ruta-nombre").value,
        descripcion: document.getElementById("edit-ruta-descripcion").value,
        tiempoEstimadoTotal: document.getElementById("edit-ruta-tiempo").value,
        activa: document.getElementById("edit-ruta-activa").value === "true",
      };
      try {
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualizar");
        alert("¡Ruta actualizada!");
        modalRuta.classList.remove("modal-visible");
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  7. CRUD HORARIOS
  // ============================================================
  const formRegistrarHorario = document.getElementById(
    "form-registrar-horario"
  );
  const modalEditarHorario = document.getElementById("modal-editar-horario");
  const formEditarHorario = document.getElementById("form-editar-horario");
  const closeBtnHorario = modalEditarHorario?.querySelector(".close-button");
  let editingSalidaId = null;
  let editingHorarioId = null;

  if (formRegistrarHorario) {
    formRegistrarHorario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        ruta: document.getElementById("horario-ruta").value,
        diaSemana: document.getElementById("horario-dia").value,
        hora: document.getElementById("horario-hora").value,
        camionAsignado: document.getElementById("horario-camion").value,
        conductorAsignado: document.getElementById("horario-conductor").value,
      };
      try {
        const res = await fetch(BACKEND_URL + "/api/horarios", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (res.ok) {
          alert("✅ ¡Horario registrado!");
          formRegistrarHorario.reset();
          cargarHorarios();
        } else {
          const d = await res.json();
          alert("Error: " + d.message);
        }
      } catch (error) {
        alert("Error conexión");
      }
    });
  }

  function renderTablaHorarios(lista) {
    const tbody = document.getElementById("tabla-horarios-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (lista.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6">No se encontraron horarios.</td></tr>';
      return;
    }
    lista.forEach((h) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${h.diaSemana}</td>
        <td><strong>${h.hora}</strong></td>
        <td>${h.rutaNombre || "N/A"}</td>
        <td>${h.camionUnidad || '<span class="text-muted">--</span>'}</td>
        <td>${h.conductorNombre || '<span class="text-muted">--</span>'}</td>
        <td>
            <button class="btn btn-secondary btn-sm btn-edit-horario" data-id="${
              h._id
            }" data-salida-id="${
        h.salidaId
      }"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm btn-delete-horario" data-id="${
              h._id
            }" data-salida-id="${
        h.salidaId
      }"><i class="fas fa-trash"></i></button>
        </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarHorarios() {
    try {
      const response = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      horariosCargados = await response.json();
      renderTablaHorarios(horariosCargados);
    } catch (e) {}
  }

  // --- LÓGICA DE BÚSQUEDA DE HORARIOS CORREGIDA (VERSIÓN FINAL) ---
  // --- LÓGICA DE BÚSQUEDA DE HORARIOS (CORREGIDA Y UNIFICADA) ---
  const formSearchHorario = document.getElementById("form-search-horario");

  if (formSearchHorario) {
    formSearchHorario.addEventListener("submit", (e) => {
      e.preventDefault();

      // 1. Obtener valores de los campos (Con nombres claros)
      const selRuta = document.getElementById("search-horario-ruta");
      const selDia = document.getElementById("search-horario-dia");
      const elHora = document.getElementById("search-horario-hora"); // El input de hora
      const selCamion = document.getElementById("search-horario-camion");
      const selConductor = document.getElementById("search-horario-conductor");

      // 2. Extraer texto para comparar
      const busquedaRuta = selRuta ? selRuta.value.toLowerCase() : "";
      const busquedaDia = selDia ? selDia.value : "";
      const busquedaHora = elHora ? elHora.value : ""; // Valor ej: "08:00"
      const busquedaCamion = selCamion ? selCamion.value.toLowerCase() : "";
      const busquedaConductor = selConductor
        ? selConductor.value.toLowerCase()
        : "";

      const filtrados = horariosCargados.filter((h) => {
        // A. Filtro Ruta
        const matchRuta =
          !busquedaRuta ||
          (h.rutaNombre && h.rutaNombre.toLowerCase().includes(busquedaRuta));

        // B. Filtro Día
        const matchDia = !busquedaDia || h.diaSemana === busquedaDia;

        // C. Filtro Hora (CORREGIDO)
        let matchHora = true;
        if (busquedaHora) {
          // Quitamos el cero inicial para comparar (ej: convierte "09:00" a "9:00")
          const horaEnBD = h.hora ? h.hora.toString().replace(/^0+/, "") : "";
          const horaBuscada = busquedaHora.toString().replace(/^0+/, "");

          // Verificamos si empieza igual (para que "9" encuentre "9:00" y "9:30")
          matchHora = horaEnBD.startsWith(horaBuscada);
        }

        // D. Filtro Camión
        const matchCamion =
          !busquedaCamion ||
          (h.camionUnidad &&
            h.camionUnidad.toString().toLowerCase().includes(busquedaCamion));

        // E. Filtro Conductor
        const matchConductor =
          !busquedaConductor ||
          (h.conductorNombre &&
            h.conductorNombre.toLowerCase().includes(busquedaConductor));

        return (
          matchRuta && matchDia && matchHora && matchCamion && matchConductor
        );
      });

      renderTablaHorarios(filtrados);
      document
        .getElementById("search-horario-modal")
        .classList.remove("modal-visible");
    });
  }

  // --- EVENTO PARA ABRIR Y LLENAR EL MODAL DE BÚSQUEDA ---
  // Esto asegura que los selects se llenen ANTES de mostrar el modal
  const btnOpenSearchHorario =
    document.querySelector("#btn-open-search-horario") ||
    document.querySelector(".btn-open-search[data-target='horario']");

  if (btnOpenSearchHorario) {
    btnOpenSearchHorario.addEventListener("click", () => {
      popularDropdownsHorarios("buscar"); // <--- Esto llena los selects con NOMBRES
      document
        .getElementById("search-horario-modal")
        .classList.add("modal-visible");
    });
  }

  document
    .getElementById("tabla-horarios-body")
    ?.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-horario");
      const btnDelete = e.target.closest(".btn-delete-horario");
      if (btnEdit) {
        const { id, salidaId } = btnEdit.dataset;
        abrirEditarHorario(id, salidaId);
      }
      if (btnDelete) {
        const { id, salidaId } = btnDelete.dataset;
        if (confirm("¿Eliminar horario?")) eliminarHorario(id, salidaId);
      }
    });

  // --- FUNCIÓN MEJORADA PARA LLENAR LISTAS (CREAR, EDITAR Y BUSCAR) ---
  async function popularDropdownsHorarios(modo = "crear") {
    // Definir prefijos según el modo
    // modo 'crear' -> id="horario-ruta"
    // modo 'editar' -> id="edit-horario-ruta"
    // modo 'buscar' -> id="search-horario-ruta"

    let prefix = "horario";
    if (modo === "editar") prefix = "edit-horario";
    if (modo === "buscar") prefix = "search-horario";

    const selRuta = document.getElementById(`${prefix}-ruta`);
    const selCamion = document.getElementById(`${prefix}-camion`);
    const selConductor = document.getElementById(`${prefix}-conductor`);

    // Evitar recargar si ya tiene datos (Solo para búsqueda, para no perder la selección)
    if (modo === "buscar" && selRuta && selRuta.options.length > 1) return;

    // Limpieza inicial
    if (selRuta)
      selRuta.innerHTML = '<option value="">-- C a r g a n d o --</option>';
    if (selCamion)
      selCamion.innerHTML = '<option value="">-- C a r g a n d o --</option>';
    if (selConductor)
      selConductor.innerHTML =
        '<option value="">-- C a r g a n d o --</option>';

    try {
      const [resRutas, resCamiones, resConductores] = await Promise.all([
        fetch(BACKEND_URL + "/api/rutas", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/camiones", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/users", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const rutas = await resRutas.json();
      const camiones = await resCamiones.json();
      const usuarios = await resConductores.json();
      const conductores = usuarios.filter((u) => u.tipo === "conductor");

      // 1. LLENAR RUTAS
      if (selRuta) {
        selRuta.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        rutas.forEach((r) => {
          if (r.activa) {
            // TRUCO: Si es búsqueda, usamos el NOMBRE como valor. Si es crear/editar, usamos el ID.
            const valor = modo === "buscar" ? r.nombre : r._id;
            selRuta.innerHTML += `<option value="${valor}">${r.nombre}</option>`;
          }
        });
      }

      // 2. LLENAR CAMIONES
      if (selCamion) {
        selCamion.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        camiones.forEach((c) => {
          if (c.estado === "activo" || modo === "buscar") {
            // En búsqueda mostramos todos
            const valor = modo === "buscar" ? c.numeroUnidad : c._id;
            selCamion.innerHTML += `<option value="${valor}">${c.numeroUnidad} (${c.placa})</option>`;
          }
        });
      }

      // 3. LLENAR CONDUCTORES
      if (selConductor) {
        selConductor.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        conductores.forEach((c) => {
          const valor = modo === "buscar" ? c.nombre : c._id;
          selConductor.innerHTML += `<option value="${valor}">${c.nombre}</option>`;
        });
      }
    } catch (e) {
      console.error(e);
      if (selRuta)
        selRuta.innerHTML = '<option value="">Error al cargar</option>';
    }
  }

  async function abrirEditarHorario(horarioId, salidaId) {
    await popularDropdownsHorarios("editar");
    try {
      const res = await fetch(`${BACKEND_URL}/api/horarios/${horarioId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const horarioDoc = await res.json();
      const salida = horarioDoc.salidas.find((s) => s._id === salidaId);

      document.getElementById("edit-horario-id").value = horarioId;
      document.getElementById("edit-salida-id").value = salidaId;
      editingSalidaId = salidaId;
      editingHorarioId = horarioId;

      document.getElementById("edit-horario-ruta").value =
        horarioDoc.ruta._id || horarioDoc.ruta;
      document.getElementById("edit-horario-dia").value = horarioDoc.diaSemana;
      document.getElementById("edit-horario-salida").value = salida.hora;
      document.getElementById("edit-horario-camion").value =
        salida.camionAsignado || "";
      document.getElementById("edit-horario-conductor").value =
        salida.conductorAsignado || "";

      modalEditarHorario.classList.add("modal-visible");
    } catch (e) {
      alert(e.message);
    }
  }

  async function eliminarHorario(horarioId, salidaId) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/horarios/${horarioId}/salidas/${salidaId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        alert("¡Eliminado!");
        cargarHorarios();
      }
    } catch (e) {
      alert(e.message);
    }
  }

  if (formEditarHorario) {
    formEditarHorario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {
        ruta: document.getElementById("edit-horario-ruta").value,
        diaSemana: document.getElementById("edit-horario-dia").value,
        hora: document.getElementById("edit-horario-salida").value,
        camionAsignado: document.getElementById("edit-horario-camion").value,
        conductorAsignado: document.getElementById("edit-horario-conductor")
          .value,
      };
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/horarios/${editingHorarioId}/salidas/${editingSalidaId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
          }
        );
        if (res.ok) {
          alert("✅ Actualizado");
          modalEditarHorario.classList.remove("modal-visible");
          cargarHorarios();
        }
      } catch (e) {
        alert("Error conexión");
      }
    });
  }

  if (closeBtnHorario)
    closeBtnHorario.onclick = () =>
      modalEditarHorario.classList.remove("modal-visible");
  window.cerrarModalEditarHorario = () =>
    modalEditarHorario.classList.remove("modal-visible");

  // 1. Icono de Estudiante
  const studentIconAdmin = L.divIcon({
    className: "student-marker-admin",
    html: `<div style="background-color: #0dcaf0; color: white; width: 25px; height: 25px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.5);"><i class="fas fa-user"></i></div>`,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });

  // 2. Escuchar evento
  socket.on("studentWaiting", (data) => {
    console.log("Admin: Estudiante esperando", data);

    const marker = L.marker([data.location.lat, data.location.lng], {
      icon: studentIconAdmin,
    })
      .addTo(map) // Asegúrate que tu variable de mapa se llame 'map'
      .bindPopup(
        `<strong>Estudiante esperando</strong><br>Ruta: ${data.rutaId}`
      );

    // Limpiar después de 5 min
    setTimeout(() => {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }, 300000);
  });

  // ============================================================
  //  8. EDITOR DE RUTAS (MAPA)
  // ============================================================
  const modalRutaMapa = document.getElementById("edit-ruta-mapa-modal");
  const modalFormRutaMapa = document.getElementById("form-edit-ruta-mapa");
  const closeModalBtnRutaMapa = modalRutaMapa?.querySelector(".close-button");
  const listaParadasUI = document.getElementById("lista-paradas");
  const inputRefOrigin = document.getElementById("ref-origin");
  const inputRefDest = document.getElementById("ref-destination");
  const btnClearRefs = document.getElementById("btn-clear-refs");
  const btnModeTracing = document.getElementById("btn-mode-tracing");
  const btnModeStops = document.getElementById("btn-mode-stops");

  let editorMode = "tracing";
  let editorMap = null;
  let arrayPuntosTrazado = [];
  let arrayPuntosParada = [];
  let traceLayerGroup = L.layerGroup();
  let stopsLayerGroup = L.layerGroup();
  let marcadoresGuia = [];

  if (btnModeTracing && btnModeStops) {
    btnModeTracing.addEventListener("click", () => setEditorMode("tracing"));
    btnModeStops.addEventListener("click", () => setEditorMode("stops"));
  }

  function setEditorMode(mode) {
    editorMode = mode;
    if (mode === "tracing") {
      btnModeTracing.classList.add("active");
      btnModeStops.classList.remove("active");
      if (editorMap) editorMap.getContainer().style.cursor = "crosshair";
    } else {
      btnModeStops.classList.add("active");
      btnModeTracing.classList.remove("active");
      if (editorMap) editorMap.getContainer().style.cursor = "default";
    }
  }

  function inicializarEditorMapa() {
    if (editorMap) return;
    editorMap = L.map("ruta-map-editor").setView(
      [initialLat, initialLng],
      initialZoom
    );
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }
    ).addTo(editorMap);

    traceLayerGroup.addTo(editorMap);
    stopsLayerGroup.addTo(editorMap);

    editorMap.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (editorMode === "tracing") {
        arrayPuntosTrazado.push([lat, lng]);
        dibujarTrazado();
      } else {
        const nuevaParada = {
          nombre: `Parada ${arrayPuntosParada.length + 1}`,
          tipo: "parada_oficial",
          ubicacion: { type: "Point", coordinates: [lng, lat] },
        };
        arrayPuntosParada.push(nuevaParada);
        dibujarParadas();
      }
      actualizarListaUI();
    });
  }

  function dibujarTrazado() {
    traceLayerGroup.clearLayers();
    if (arrayPuntosTrazado.length === 0) return;
    L.polyline(arrayPuntosTrazado, {
      color: "#007bff",
      weight: 5,
      opacity: 0.7,
    }).addTo(traceLayerGroup);

    const dotIcon = L.divIcon({
      className: "dot-marker",
      html: "",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    arrayPuntosTrazado.forEach((coords, index) => {
      const marker = L.marker(coords, { icon: dotIcon, draggable: true });
      marker.bindPopup(
        `<div style="text-align:center;"><small>Punto #${
          index + 1
        }</small><br><button onclick="borrarPuntoTrazo(${index})" class="btn btn-danger btn-sm">Eliminar</button></div>`
      );
      marker.on("dragend", (e) => {
        const newPos = e.target.getLatLng();
        arrayPuntosTrazado[index] = [newPos.lat, newPos.lng];
        dibujarTrazado();
      });
      marker.addTo(traceLayerGroup);
    });
  }

  function dibujarParadas() {
    stopsLayerGroup.clearLayers();
    const stopIcon = L.divIcon({
      className: "parada-marker",
      html: '<i class="fas fa-bus"></i>',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30],
    });
    arrayPuntosParada.forEach((parada, index) => {
      const [lng, lat] = parada.ubicacion.coordinates;
      const marker = L.marker([lat, lng], { icon: stopIcon, draggable: true });
      marker.bindPopup(
        `<div style="text-align:center;"><strong>${parada.nombre}</strong><br><button onclick="borrarParada(${index})" class="btn btn-danger btn-sm">Borrar</button></div>`
      );
      marker.on("dragend", (e) => {
        const newPos = e.target.getLatLng();
        arrayPuntosParada[index].ubicacion.coordinates = [
          newPos.lng,
          newPos.lat,
        ];
      });
      marker.addTo(stopsLayerGroup);
    });
  }

  function actualizarListaUI() {
    if (!listaParadasUI) return;
    listaParadasUI.innerHTML = "";
    const spanCountParadas = document.getElementById("count-paradas");
    const spanCountTrazado = document.getElementById("count-trazado");
    if (spanCountParadas)
      spanCountParadas.textContent = arrayPuntosParada.length;
    if (spanCountTrazado)
      spanCountTrazado.textContent = arrayPuntosTrazado.length;
    // (Aquí va tu lógica de renderizado de lista de paradas que ya tenías, resumida por espacio)
  }

  window.borrarPuntoTrazo = (index) => {
    arrayPuntosTrazado.splice(index, 1);
    dibujarTrazado();
    actualizarListaUI();
  };
  window.borrarParada = (index) => {
    arrayPuntosParada.splice(index, 1);
    dibujarParadas();
    actualizarListaUI();
  };

  function limpiarGuias() {
    marcadoresGuia.forEach((m) => editorMap.removeLayer(m));
    marcadoresGuia = [];
    if (inputRefOrigin) inputRefOrigin.value = "";
    if (inputRefDest) inputRefDest.value = "";
    // cerrarListas(); // Asegúrate de tener esta función si la usas
  }
  if (btnClearRefs) btnClearRefs.addEventListener("click", limpiarGuias);

  window.openEditRutaMapaModal = (ruta) => {
    modalRutaMapa.classList.add("modal-visible");
    document.getElementById("edit-ruta-mapa-id").value = ruta._id;
    const tituloSpan = document.getElementById("nombre-ruta-editor");
    if (tituloSpan) tituloSpan.textContent = ruta.nombre;

    const allPoints = ruta.paradas || [];
    arrayPuntosTrazado = [];
    arrayPuntosParada = [];
    allPoints.forEach((p) => {
      const [lng, lat] = p.ubicacion.coordinates;
      if (
        p.tipo === "parada_oficial" ||
        (p.nombre && p.nombre.toLowerCase().includes("parada"))
      ) {
        arrayPuntosParada.push(p);
      } else {
        arrayPuntosTrazado.push([lat, lng]);
      }
    });
    limpiarGuias();
    setTimeout(() => {
      inicializarEditorMapa();
      editorMap.invalidateSize();
      dibujarTrazado();
      dibujarParadas();
      actualizarListaUI();
      setEditorMode("tracing");
    }, 100);
  };

  if (modalFormRutaMapa) {
    modalFormRutaMapa.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-mapa-id").value;
      const trazoParaGuardar = arrayPuntosTrazado.map((coords, i) => ({
        nombre: `Punto ${i}`,
        tipo: "trazo",
        ubicacion: { type: "Point", coordinates: [coords[1], coords[0]] },
      }));
      const paradasParaGuardar = arrayPuntosParada.map((p) => ({
        ...p,
        tipo: "parada_oficial",
      }));
      const payload = { paradas: [...trazoParaGuardar, ...paradasParaGuardar] };

      try {
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}/paradas`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Error guardando");
        alert("¡Ruta guardada!");
        modalRutaMapa.classList.remove("modal-visible");
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  BUSCADOR INTELIGENTE TIPO GOOGLE MAPS (Nominatim API)
  // ============================================================

  const listOrigin = document.getElementById("list-origin");

  const listDest = document.getElementById("list-destination");

  // Función para limpiar pines
  function limpiarGuias() {
    marcadoresGuia.forEach((m) => editorMap.removeLayer(m));
    marcadoresGuia = [];
    if (inputRefOrigin) inputRefOrigin.value = "";
    if (inputRefDest) inputRefDest.value = "";
    cerrarListas();
  }

  if (btnClearRefs) btnClearRefs.addEventListener("click", limpiarGuias);

  // Función "Debounce" (para no buscar en cada letra, espera 300ms)
  function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, timeout);
    };
  }

  // Configurar Inputs
  setupAutocomplete(inputRefOrigin, listOrigin, "origen");
  setupAutocomplete(inputRefDest, listDest, "destino");

  function setupAutocomplete(input, listElement, tipo) {
    if (!input || !listElement) return;

    input.addEventListener(
      "input",
      debounce(async (e) => {
        const query = e.target.value.trim().toLowerCase();
        listElement.innerHTML = ""; // Limpiar lista

        if (query.length < 2) {
          listElement.classList.remove("active");
          return;
        }

        // 1. BUSCAR EN LUGARES PREDEFINIDOS (Tus Favoritos)
        const resultadosLocales = LUGARES_CLAVE.filter((lugar) =>
          lugar.nombre.toLowerCase().includes(query)
        );

        // Renderizar locales primero (con icono de estrella)
        resultadosLocales.forEach((lugar) => {
          const li = document.createElement("li");
          li.style.backgroundColor = "#1a2e1a"; // Un fondo verdecito para resaltar
          li.innerHTML = `
                <i class="fas fa-star" style="color:gold;"></i>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:bold; color:#fff;">${lugar.nombre}</span>
                    <span style="font-size:0.75rem; color:#aaa;">Ubicación Guardada</span>
                </div>
              `;
          li.addEventListener("click", () => {
            input.value = lugar.nombre;
            listElement.classList.remove("active");
            colocarMarcadorGuia(lugar.lat, lugar.lon, tipo, lugar.nombre);
          });
          listElement.appendChild(li);
        });

        // 2. BUSCAR EN INTERNET (NOMINATIM API) - Opcional si no encuentras lo local
        try {
          // Búsqueda restringida a la zona
          const viewbox = "-108.60,25.30,-107.90,25.80";
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            query
          )}&countrycodes=mx&limit=3&viewbox=${viewbox}&bounded=1`;

          const res = await fetch(url);
          const data = await res.json();

          data.forEach((lugar) => {
            const li = document.createElement("li");
            const parts = lugar.display_name.split(",");
            const mainName = parts[0];

            li.innerHTML = `
                    <i class="fas fa-map-marker-alt"></i>
                    <div style="display:flex; flex-direction:column; line-height:1.2;">
                        <span style="font-weight:bold;">${mainName}</span>
                        <span style="font-size:0.75rem; color:#aaa;">Resultado de Internet</span>
                    </div>
                  `;

            li.addEventListener("click", () => {
              input.value = mainName;
              listElement.classList.remove("active");
              colocarMarcadorGuia(
                lugar.lat,
                lugar.lon,
                tipo,
                lugar.display_name
              );
            });

            listElement.appendChild(li);
          });
        } catch (error) {
          console.log("Sin internet o error en API, mostrando solo locales.");
        }

        // Mostrar lista si hay algún resultado (local o de internet)
        if (listElement.children.length > 0) {
          listElement.classList.add("active");
        } else {
          listElement.classList.remove("active");
        }
      }, 300)
    );

    // Cerrar al hacer clic fuera
    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !listElement.contains(e.target)) {
        listElement.classList.remove("active");
      }
    });
  }

  function renderResultados(resultados, listElement, inputElement, tipo) {
    listElement.innerHTML = "";

    if (resultados.length === 0) {
      listElement.classList.remove("active");
      return;
    }

    resultados.forEach((lugar) => {
      const li = document.createElement("li");
      // Mostramos el nombre principal (display_name suele ser muy largo)
      // Intentamos formatearlo un poco
      const parts = lugar.display_name.split(",");
      const mainName = parts[0];
      const secondary = parts.slice(1, 3).join(",");

      li.innerHTML = `
            <i class="fas fa-map-pin"></i>
            <div style="display:flex; flex-direction:column; line-height:1.2;">
                <span style="font-weight:bold;">${mainName}</span>
                <span style="font-size:0.75rem; color:#aaa;">${secondary}</span>
            </div>
          `;

      li.addEventListener("click", () => {
        // 1. Poner texto en input
        inputElement.value = mainName;

        // 2. Cerrar lista
        listElement.classList.remove("active");

        // 3. Crear Marcador Visual en el Mapa
        colocarMarcadorGuia(lugar.lat, lugar.lon, tipo, lugar.display_name);
      });

      listElement.appendChild(li);
    });

    listElement.classList.add("active");
  }

  function cerrarListas() {
    if (listOrigin) listOrigin.classList.remove("active");
    if (listDest) listDest.classList.remove("active");
  }

  function colocarMarcadorGuia(lat, lng, tipo, titulo) {
    if (!editorMap) return;

    const color = tipo === "origen" ? "#2ecc71" : "#e74c3c"; // Verde o Rojo

    // Icono Personalizado
    const guideIcon = L.divIcon({
      className: "guide-marker",
      html: `<div style="
              background-color: ${color};
              width: 32px; height: 32px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 3px 10px rgba(0,0,0,0.4);
              display: flex; justify-content: center; align-items: center;
              color: white; font-size: 16px;">
              <i class="fas ${
                tipo === "origen" ? "fa-play" : "fa-flag-checkered"
              }"></i>
          </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([lat, lng], { icon: guideIcon })
      .addTo(editorMap)
      .bindPopup(
        `<strong style="color:${color}">${tipo.toUpperCase()}</strong><br>${titulo}`
      )
      .openPopup();

    marcadoresGuia.push(marker);

    // Centrar el mapa en el lugar seleccionado
    editorMap.setView([lat, lng], 15);
  }
  // ----------------------------------------------------

  // --- 9. ¡NUEVO! CRUD - HISTORIAL DE ALERTAS ---
  function renderTablaAlertas(listaAlertas) {
    const tablaBody = document.getElementById("tabla-alertas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (listaAlertas.length === 0) {
      tablaBody.innerHTML = '<tr><td colspan="4">No hay alertas.</td></tr>';
      return;
    }
    listaAlertas.forEach((alerta) => {
      const row = document.createElement("tr");
      const fecha = new Date(alerta.createdAt).toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short",
      });
      row.innerHTML = `<td class="alert-row-danger">${
        alerta.camionUnidad || "N/A"
      }</td><td>${alerta.titulo}</td><td>${
        alerta.mensaje
      }</td><td>${fecha}</td>`;
      tablaBody.appendChild(row);
    });
  }

  async function cargarAlertas() {
    try {
      const response = await fetch(BACKEND_URL + "/api/notificaciones", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // ✅ CORRECCIÓN: Guardamos en la variable global para que el buscador funcione
      alertasCargadas = await response.json();

      renderTablaAlertas(alertasCargadas);
    } catch (e) {
      console.error("Error cargando alertas:", e);
    }
  }

  // --- BÚSQUEDA DE ALERTAS (CORREGIDO) ---
  // --- LÓGICA DE BÚSQUEDA DE ALERTAS (CORREGIDA) ---
  const formSearchAlerta = document.getElementById("form-search-alerta");

  if (formSearchAlerta) {
    formSearchAlerta.addEventListener("submit", (e) => {
      // 1. ESTA LÍNEA ES LA QUE EVITA LA RECARGA DE PÁGINA
      e.preventDefault();

      // 2. Obtener valores
      const unidad = document
        .getElementById("search-alerta-unidad")
        .value.toLowerCase();
      const tipo = document
        .getElementById("search-alerta-tipo")
        .value.toLowerCase();
      const fechaInput = document.getElementById("search-alerta-fecha").value; // YYYY-MM-DD

      // 3. Filtrar
      const filtrados = alertasCargadas.filter((a) => {
        // Filtro Unidad
        const matchUnidad =
          !unidad ||
          (a.camionUnidad && a.camionUnidad.toLowerCase().includes(unidad));

        // Filtro Tipo (Select)
        const matchTipo =
          !tipo || (a.titulo && a.titulo.toLowerCase().includes(tipo));

        // Filtro Fecha (Compara solo la parte de la fecha, ignorando la hora)
        let matchFecha = true;
        if (fechaInput) {
          // Convertimos la fecha de la alerta (ISO) a formato local YYYY-MM-DD para comparar
          // Nota: Usamos split('T')[0] para tomar solo la fecha de la base de datos
          const fechaAlerta = new Date(a.createdAt).toISOString().split("T")[0];
          matchFecha = fechaAlerta === fechaInput;
        }

        return matchUnidad && matchTipo && matchFecha;
      });

      // 4. Renderizar y cerrar
      renderTablaAlertas(filtrados);
      document
        .getElementById("search-alerta-modal")
        .classList.remove("modal-visible");
    });
  } else {
    console.error(
      "No se encontró el formulario 'form-search-alerta'. Revisa el HTML."
    );
  }
  // --- FUNCIÓN GENÉRICA PARA ABRIR/CERRAR MODALES DE BÚSQUEDA ---
  window.abrirModalBusqueda = function (tipo) {
    if (tipo === "horario") popularDropdownsHorarios("buscar");
    const modal = document.getElementById(`search-${tipo}-modal`);
    if (modal) modal.classList.add("modal-visible");
  };

  // --- CIERRE MODALES GENERAL ---
  // window.onclick = (e) => {
  //     if(e.target.classList.contains("modal") || e.target.classList.contains("fullscreen-overlay")) {
  //         e.target.classList.remove("modal-visible");
  //     }
  // };
  // document.querySelectorAll(".close-button").forEach(btn => {
  //     btn.addEventListener("click", (e) => {
  //         e.target.closest(".modal")?.classList.remove("modal-visible");
  //         e.target.closest(".fullscreen-overlay")?.classList.remove("modal-visible");
  //     });
  // });

  // Botones Limpiar Búsqueda
  document.querySelectorAll(".btn-reset-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const form = e.target.closest("form");
      form.reset();
      e.target.closest(".modal").classList.remove("modal-visible");
      if (form.id === "form-search-usuario")
        renderTablaUsuarios(usuariosCargados);
      if (form.id === "form-search-camion")
        renderTablaCamiones(camionesCargados);
      if (form.id === "form-search-ruta") renderTablaRutas(rutasCargadas);
      if (form.id === "form-search-horario")
        renderTablaHorarios(horariosCargados);
      if (form.id === "form-search-alerta") renderTablaAlertas(alertasCargadas);
    });
  });

  cargarDashboardStats();

  // Actualizar cada 30 segundos automáticamente
  setInterval(cargarDashboardStats, 30000);
});

async function cargarDashboardStats() {
  try {
    const token = localStorage.getItem("tecbus_token");
    const res = await fetch(`${BACKEND_URL}/api/camiones/estadisticas/hoy`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();

      // 1. Actualizar Tarjetas (KPIs)
      document.getElementById(
        "kpi-total-km"
      ).textContent = `${data.resumen.totalKm} km`;
      document.getElementById("kpi-max-speed").textContent =
        data.resumen.topVelocidad;
      const kpiActiveUnits = document.getElementById("kpi-active-units");
      if (kpiActiveUnits) {
        kpiActiveUnits.textContent = data.resumen.totalUnidadesActivas;
      }
      // 2. Actualizar Tabla
      const tbody = document.getElementById("stats-table-body");
      tbody.innerHTML = ""; // Limpiar tabla

      data.detalles.forEach((d) => {
        const row = `
                    <tr>
                        <td><strong>${d.unidad}</strong></td>
                        <td>${d.km} km</td>
                        <td style="${d.velMax > 90 ? "color:red" : ""}">${
          d.velMax
        } km/h</td>
                        <td>${d.actualizado}</td>
                    </tr>
                `;
        tbody.innerHTML += row;
      });
    }
  } catch (error) {
    console.error("Error cargando stats:", error);
  }
}
// Función manual asignada directamente al botón
window.filtrarAlertasManual = function () {
  console.log("🚀 Iniciando filtrado manual...");

  // Validamos que existan los datos
  if (typeof alertasCargadas === "undefined") {
    console.error("Error: alertasCargadas no está definido");
    return;
  }

  const unidadEl = document.getElementById("search-alerta-unidad");
  const tipoEl = document.getElementById("search-alerta-tipo");
  const fechaEl = document.getElementById("search-alerta-fecha");

  // Evitamos errores si algún input no existe
  const unidad = unidadEl ? unidadEl.value.toLowerCase() : "";
  const tipo = tipoEl ? tipoEl.value.toLowerCase() : "";
  const fechaInput = fechaEl ? fechaEl.value : "";

  const filtrados = alertasCargadas.filter((a) => {
    const matchUnidad =
      !unidad ||
      (a.camionUnidad && a.camionUnidad.toLowerCase().includes(unidad));
    const matchTipo =
      !tipo || (a.titulo && a.titulo.toLowerCase().includes(tipo));

    let matchFecha = true;
    if (fechaInput && a.createdAt) {
      const fechaAlerta = new Date(a.createdAt).toISOString().split("T")[0];
      matchFecha = fechaAlerta === fechaInput;
    }
    return matchUnidad && matchTipo && matchFecha;
  });

  renderTablaAlertas(filtrados);

  // Cerrar modal
  const modal = document.getElementById("search-alerta-modal");
  if (modal) modal.classList.remove("modal-visible");
};
