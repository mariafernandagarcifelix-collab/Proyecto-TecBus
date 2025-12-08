// frontend/assets/js/admin_dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICACIÓN DE SEGURIDAD ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");
  if (!token || !userString) {
    window.location.href = "index.html";
    return;
  }
  const user = JSON.parse(userString);
  if (user.tipo !== "administrador") {
    alert("Acceso denegado.");
    window.location.href = "index.html";
    return;
  }

  // --- Variables Globales ---
  let camionesCargados = [];
  let rutasCargadas = [];
  let usuariosCargados = [];
  let horariosCargados = []; // NUEVA
  let alertasCargadas = []; // NUEVA
  let busMarkers = {};
  let alertCount = 0;

  // --- LUGARES PREDEFINIDOS (COMO FAVORITOS) ---
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
    {
      nombre: "Rochin",
      lat: 25.579152,
      lon: -108.462641,
      tipo: "tienda",
    },
  ];

  // CAMBIO: Usamos SOCKET_URL en lugar de la dirección fija
  const socket = io(SOCKET_URL);
  socket.on("connect", () =>
    console.log("🔌 Admin conectado al servidor de sockets:", socket.id)
  );

  // --- 2. LÓGICA DE NAVEGACIÓN Y MENÚ ---
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menu-toggle");
  const backdrop = document.getElementById("backdrop");
  const navLinks = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".dashboard-section");
  const pageTitle = document.getElementById("page-title");
  const currentDateEl = document.getElementById("current-date");
  try {
    currentDateEl.textContent = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (e) {
    console.error("Error formatting date.");
  }
  const toggleSidebar = () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("open");
  };
  menuToggle.addEventListener("click", toggleSidebar);
  backdrop.addEventListener("click", toggleSidebar);
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("href");
      if (!targetId || !targetId.startsWith("#")) {
        if (link.textContent.includes("Cerrar Sesión")) {
          localStorage.removeItem("tecbus_token");
          localStorage.removeItem("tecbus_user");
          window.location.href = "index.html";
        }
        return;
      }
      navLinks.forEach((nav) => nav.classList.remove("active"));
      sections.forEach((sec) => sec.classList.remove("active"));
      link.classList.add("active");
      document.querySelector(targetId).classList.add("active");
      pageTitle.textContent = link.textContent.trim();
      if (window.innerWidth <= 992 && sidebar.classList.contains("open")) {
        toggleSidebar();
      }

      // --- Cargar datos dinámicamente ---
      if (targetId === "#mapa") {
        inicializarDashboard();
      }
      if (targetId === "#usuarios") {
        cargarUsuarios();
      }
      if (targetId === "#camiones") {
        cargarCamiones();
      }
      if (targetId === "#rutas") {
        cargarRutas();
      }
      if (targetId === "#horarios") {
        cargarHorarios();
        popularDropdownsHorarios();
      }
      if (targetId === "#alertas") {
        cargarAlertas();
      }
    });
  });

  // --- 3. LÓGICA DEL MAPA Y SOCKETS ---
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

  //KPIS
  // --- NUEVA FUNCIÓN PRINCIPAL PARA EL DASHBOARD ---
  // Esta función carga camiones (mapa), conductores (KPI) y alertas (KPI)
  // En tu archivo admin_dashboard.js, busca la función inicializarDashboard y usa esta:

  async function inicializarDashboard() {
    // 1. Camiones
    try {
      const res = await fetch(BACKEND_URL_API + "/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const camiones = await res.json();
        camionesCargados = camiones;

        Object.values(busMarkers).forEach((m) => map.removeLayer(m));
        busMarkers = {};
        document.getElementById("kpi-total-buses").textContent =
          camiones.length;

        camiones.forEach((c) => {
          if (c.ubicacionActual) {
            const [lng, lat] = c.ubicacionActual.coordinates;
            const m = L.marker([lat, lng], { icon: busIcon })
              .addTo(map)
              .bindPopup(`🚍 ${c.numeroUnidad}`);
            busMarkers[c._id] = m;
          }
        });
      }
    } catch (e) {
      console.error(e);
    }

    // 2. Conductores Activos (Lógica Estricta)
    try {
      const res = await fetch(BACKEND_URL_API + "/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const users = await res.json();
        usuariosCargados = users;

        // FILTRO EXACTO: Solo cuenta si el backend dice "En Servicio"
        const activos = users.filter(
          (u) => u.tipo === "conductor" && u.estado === "En Servicio"
        ).length;
        document.getElementById("kpi-drivers-active").textContent = activos;
      }
    } catch (e) {
      console.error(e);
    }

    // 3. Alertas
    try {
      const responseAlerts = await fetch(BACKEND_URL + "/api/notificaciones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (responseAlerts.ok) {
        const alerts = await responseAlerts.json();
        alertCount = alerts.length; // Sincronizar variable global
        document.getElementById("kpi-active-alerts").textContent = alertCount;
      }
    } catch (error) {
      console.error("Error cargando KPI alertas:", error);
    }
  }

  // Ejecutar al inicio
  inicializarDashboard();

  const kpiStudents = document.getElementById("kpi-students-waiting");
  const kpiAlerts = document.getElementById("kpi-active-alerts");
  let studentCount = 0;

  // Eventos de Socket
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
      inicializarDashboard();
      const newMarker = L.marker([data.location.lat, data.location.lng], {
        icon: busIcon,
      })
        .addTo(map)
        .bindPopup(`🚍 **${data.numeroUnidad}**`);
      busMarkers[data.camionId] = newMarker;
    }
  });

  socket.on("newIncidentAlert", (data) => {
    alert(`🚨 ¡NUEVO INCIDENTE!\nCamión: ${data.camionId}\nTipo: ${data.tipo}`);
    // Incrementamos el contador global que ya sincronizamos en inicializarDashboard
    alertCount++;
    kpiAlerts.textContent = alertCount;

    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setIcon(alertIcon);
      marker
        .bindPopup(
          `🚨 **ALERTA: ${data.tipo}**<br>🚍 ${data.camionId}<br>${
            data.detalles || ""
          }`
        )
        .openPopup();
    }
  });

  socket.on("studentWaiting", (data) => {
    studentCount++;
    kpiStudents.textContent = studentCount;
    L.circle([data.location.lat, data.location.lng], {
      color: "var(--color-exito)",
      radius: 50,
    })
      .addTo(map)
      .bindPopup(`Estudiante esperando (ID: ${data.userId})`);
  });

  // async function fetchAndDrawBuses() {
  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const response = await fetch(BACKEND_URL + "/api/camiones", {
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     if (!response.ok) throw new Error("No se pudieron cargar los camiones");
  //     const camiones = await response.json();
  //     Object.values(busMarkers).forEach((marker) => map.removeLayer(marker));
  //     busMarkers = {};
  //     document.getElementById("kpi-total-buses").textContent = camiones.length;
  //     const activos = camiones.filter((c) => c.estado === "activo").length;
  //     document.getElementById("kpi-drivers-active").textContent = activos;
  //     camiones.forEach((camion) => {
  //       if (camion.ubicacionActual) {
  //         const [lng, lat] = camion.ubicacionActual.coordinates;
  //         const marker = L.marker([lat, lng], { icon: busIcon })
  //           .addTo(map)
  //           .bindPopup(`🚍 **${camion.numeroUnidad}** (${camion.placa})`);
  //         busMarkers[camion._id] = marker;
  //       }
  //     });
  //   } catch (error) {
  //     console.error(error);
  //   }
  // }
  // fetchAndDrawBuses();
  // const kpiStudents = document.getElementById("kpi-students-waiting");
  // const kpiAlerts = document.getElementById("kpi-active-alerts");
  // let studentCount = 0;
  // socket.on("locationUpdate", (data) => {
  //   const marker = busMarkers[data.camionId];
  //   if (marker) {
  //     marker.setLatLng([data.location.lat, data.location.lng]);
  //   } else {
  //     const newMarker = L.marker([data.location.lat, data.location.lng], {
  //       icon: busIcon,
  //     })
  //       .addTo(map)
  //       .bindPopup(`🚍 **${data.numeroUnidad}**`);
  //     busMarkers[data.camionId] = newMarker;
  //   }
  // });
  // socket.on("newIncidentAlert", (data) => {
  //   alert(`🚨 ¡NUEVO INCIDENTE!\nCamión: ${data.camionId}\nTipo: ${data.tipo}`);
  //   alertCount++;
  //   kpiAlerts.textContent = alertCount;
  //   const marker = busMarkers[data.camionId];
  //   if (marker) {
  //     marker.setIcon(alertIcon);
  //     marker
  //       .bindPopup(
  //         `🚨 **ALERTA: ${data.tipo}**<br>🚍 ${data.camionId}<br>${
  //           data.detalles || ""
  //         }`
  //       )
  //       .openPopup();
  //   }
  // });
  // socket.on("studentWaiting", (data) => {
  //   studentCount++;
  //   kpiStudents.textContent = studentCount;
  //   L.circle([data.location.lat, data.location.lng], {
  //     color: "var(--color-exito)",
  //     radius: 50,
  //   })
  //     .addTo(map)
  //     .bindPopup(`Estudiante esperando (ID: ${data.userId})`);
  // });

  // --- 4. CRUD USUARIOS ---
  const modalUser = document.getElementById("edit-user-modal");
  const modalFormUser = document.getElementById("form-edit-user");
  const closeModalBtnUser = modalUser.querySelector(".close-button");
  const camposConductorEdit = document.getElementById("campos-conductor"); // En modal editar
  const formRegistrarUsuario = document.getElementById(
    "form-registrar-usuario"
  );
  const userTipoSelect = document.getElementById("user-tipo"); // Select de registro
  const camposConductorNew = document.getElementById(
    "new-user-conductor-fields"
  ); // Campos dinámicos registro

  // Lógica para mostrar campos dinámicos en el REGISTRO
  if (userTipoSelect) {
    userTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor") {
        camposConductorNew.style.display = "block";
      } else {
        camposConductorNew.style.display = "none";
        // Limpiamos el valor si no es conductor
        document.getElementById("user-licencia").value = "Si";
      }
    });
  }

  // Lógica para mostrar campos dinámicos en la EDICIÓN
  const editUserTipoSelect = document.getElementById("edit-user-tipo");
  if (editUserTipoSelect) {
    editUserTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor") {
        camposConductorEdit.style.display = "block";
      } else {
        camposConductorEdit.style.display = "none";
      }
    });
  }

  // FUNCIÓN PURA PARA RENDERIZAR (Reutilizable por el buscador)
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

      // Lógica de colores de Badge
      let badgeClass = "estudiante"; // Default
      let estado = u.estado || "Inactivo"; // Default

      if (u.tipo === "administrador") {
        badgeClass = "admin"; // Verde
        estado = "Admin";
      } else if (u.tipo === "conductor") {
        // Colores específicos para estados del conductor
        if (u.estado === "En Servicio")
          badgeClass = "admin"; // Verde (reutilizado)
        else if (u.estado === "Inicio de Recorridos")
          badgeClass = "conductor"; // Naranja
        else badgeClass = "secondary"; // Gris (para "Fin..." o "Sin recorridos")
      }

      // Ajuste visual en CSS para .badge-secondary si no existe
      const badgeHtml = `<span class="badge badge-${badgeClass}" style="${
        badgeClass === "secondary" ? "background:#666; color:white;" : ""
      }">${estado}</span>`;

      row.innerHTML = `
        <td>${u.nombre}</td>
        <td>${u.email}</td>
        <td>${u.tipo}</td>
        <td>${badgeHtml}</td>
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
      if (!response.ok) throw new Error("Error al cargar usuarios.");
      usuariosCargados = await response.json(); // Guardamos en global
      renderTablaUsuarios(usuariosCargados); // Renderizamos todo
    } catch (error) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }

  // --- LÓGICA DE BÚSQUEDA DE USUARIOS ---
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

      // Filtrado en cliente
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

  // async function cargarUsuarios() {
  //   const tablaBody = document.getElementById("tabla-usuarios-body");
  //   if (!tablaBody) return;
  //   tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
  //   try {
  //     const response = await fetch(BACKEND_URL + "/api/users", {
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     if (!response.ok) throw new Error("Error al cargar usuarios.");
  //     usuariosCargados = await response.json();
  //     tablaBody.innerHTML = "";
  //     if (usuariosCargados.length === 0) {
  //       tablaBody.innerHTML =
  //         '<tr><td colspan="5">No hay usuarios registrados.</td></tr>';
  //       return;
  //     }
  //     usuariosCargados.forEach((user) => {
  //       const row = document.createElement("tr");

  //       // Determinamos la clase CSS según el tipo de usuario exacto
  //       let badgeClass = "estudiante";
  //       if (user.tipo === "administrador") {
  //         badgeClass = "admin";
  //       } else if (user.tipo === "conductor") {
  //         badgeClass = "conductor";
  //       }

  //       row.innerHTML = `
  //           <td>${user.nombre}</td>
  //           <td>${user.email}</td>
  //           <td><span class="badge badge-${badgeClass}">${user.tipo}</span></td>
  //           <td>${user.estado || "activo"}</td>
  //           <td>
  //               <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${
  //                 user._id
  //               }" title="Editar">
  //                   <i class="fas fa-edit"></i>
  //               </button>
  //               <button class="btn btn-danger btn-sm btn-delete-user" data-id="${
  //                 user._id
  //               }" title="Eliminar">
  //                   <i class="fas fa-trash"></i>
  //               </button>
  //           </td>
  //       `;
  //       tablaBody.appendChild(row);
  //     });
  //   } catch (error) {
  //     tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
  //   }
  // }

  // Registrar Usuario (Actualizado con licencia combo y sin camión)
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
        // Ya no enviamos vehiculoAsignado
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
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message);
        }
        alert("¡Usuario registrado!");
        formRegistrarUsuario.reset();
        // Resetear visibilidad de campos extra
        camposConductorNew.style.display = "none";
        cargarUsuarios();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const tablaBodyUsuarios = document.getElementById("tabla-usuarios-body");
  if (tablaBodyUsuarios) {
    tablaBodyUsuarios.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-user");
      const btnDelete = e.target.closest(".btn-delete-user");

      if (btnEdit) {
        const user = usuariosCargados.find((u) => u._id === btnEdit.dataset.id);
        if (user) openEditUserModal(user);
      }

      if (btnDelete) {
        handleDeleteUser(btnDelete.dataset.id);
      }
    });
  }

  // Abrir Modal Editar (Actualizado)
  async function openEditUserModal(user) {
    document.getElementById("edit-user-id").value = user._id;
    document.getElementById("edit-user-nombre").value = user.nombre;
    document.getElementById("edit-user-email").value = user.email;
    document.getElementById("edit-user-tipo").value = user.tipo;
    document.getElementById("edit-user-estado").value = user.estado;

    if (user.tipo === "conductor") {
      camposConductorEdit.style.display = "block";
      // Mapeamos el valor de licencia al combo Si/No si ya existe, o defecto Si
      const licenciaVal = user.conductor?.licencia ? "Si" : "No";
      // Nota: Si guardabas un string como "12345" antes, esto lo pondrá como "Si".
      // Si guardabas "Si"/"No", funcionará directo.
      // Ajusta si tu backend guarda el número de licencia real.
      // Como pediste que sea Si/No, asumimos que ahora guardas eso.
      document.getElementById("edit-user-licencia").value =
        user.conductor?.licencia || "No";

      // Ya no cargamos camiones aquí.
    } else {
      camposConductorEdit.style.display = "none";
    }
    modalUser.classList.add("modal-visible");
  }

  function closeEditUserModal() {
    modalUser.classList.remove("modal-visible");
  }
  if (closeModalBtnUser) closeModalBtnUser.onclick = closeEditUserModal;

  // Enviar Edición (Actualizado)
  if (modalFormUser) {
    modalFormUser.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-user-id").value;
      const tipo = document.getElementById("edit-user-tipo").value;

      const datos = {
        nombre: document.getElementById("edit-user-nombre").value,
        email: document.getElementById("edit-user-email").value,
        tipo: tipo,
        estado: document.getElementById("edit-user-estado").value,
      };

      if (tipo === "conductor") {
        datos.licencia = document.getElementById("edit-user-licencia").value;
        // Eliminado vehiculoAsignado
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
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message);
        }
        alert("¡Usuario actualizado!");
        closeEditUserModal();
        cargarUsuarios();
        inicializarDashboard(); // Actualizar KPIs
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // Función para eliminar usuario
  async function handleDeleteUser(id) {
    if (
      !confirm(
        "¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer."
      )
    )
      return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.message || "No se pudo eliminar");

      alert("✅ Usuario eliminado correctamente");
      cargarUsuarios();
      inicializarDashboard(); // Actualizar KPIs
    } catch (error) {
      console.error(error);
      alert("Error: " + error.message);
    }
  }
  // --- 5. CRUD - CAMIONES ---
  const modalCamion = document.getElementById("edit-camion-modal");
  const modalFormCamion = document.getElementById("form-edit-camion");
  const closeModalBtnCamion = modalCamion.querySelector(".close-button");

  function renderTablaCamiones(listaCamiones) {
    const tablaBody = document.getElementById("tabla-camiones-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (listaCamiones.length === 0) {
      tablaBody.innerHTML =
        '<tr><td colspan="5">No se encontraron camiones.</td></tr>';
      return;
    }
    listaCamiones.forEach((camion) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${camion.placa}</td><td>${
        camion.numeroUnidad
      }</td><td>${
        camion.modelo || "N/A"
      }</td><td><span class="badge badge-admin">${camion.estado}</span></td>
              <td><button class="btn btn-secondary btn-sm btn-edit-camion" data-id="${
                camion._id
              }"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm btn-delete-camion" data-id="${
        camion._id
      }"><i class="fas fa-trash"></i></button></td>`;
      tablaBody.appendChild(row);
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
    } catch (error) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }

  const formSearchCamion = document.getElementById("form-search-camion");
  if (formSearchCamion) {
    formSearchCamion.addEventListener("submit", (e) => {
      e.preventDefault();
      const unidad = document
        .getElementById("search-camion-unidad")
        .value.toLowerCase();
      const placa = document
        .getElementById("search-camion-placa")
        .value.toLowerCase();
      const estado = document.getElementById("search-camion-estado").value;

      const filtrados = camionesCargados.filter((c) => {
        const matchUnidad =
          !unidad || c.numeroUnidad.toLowerCase().includes(unidad);
        const matchPlaca = !placa || c.placa.toLowerCase().includes(placa);
        const matchEstado = !estado || c.estado === estado;
        return matchUnidad && matchPlaca && matchEstado;
      });
      renderTablaCamiones(filtrados);
      document
        .getElementById("search-camion-modal")
        .classList.remove("modal-visible");
    });
  }

  // async function cargarCamiones() {
  //   const tablaBody = document.getElementById("tabla-camiones-body");
  //   if (!tablaBody) return;
  //   tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const response = await fetch(BACKEND_URL + "/api/camiones", {
  //       method: "GET",
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     if (!response.ok) throw new Error("Error al cargar camiones.");
  //     camionesCargados = await response.json();
  //     tablaBody.innerHTML = "";
  //     if (camionesCargados.length === 0) {
  //       tablaBody.innerHTML =
  //         '<tr><td colspan="5">No hay camiones registrados.</td></tr>';
  //       return;
  //     }
  //     camionesCargados.forEach((camion) => {
  //       const row = document.createElement("tr");
  //       row.innerHTML = `<td>${camion.placa}</td><td>${
  //         camion.numeroUnidad
  //       }</td><td>${
  //         camion.modelo || "N/A"
  //       }</td><td><span class="badge badge-admin">${camion.estado}</span></td>
  //                   <td><button class="btn btn-secondary btn-sm btn-edit-camion" data-id="${
  //                     camion._id
  //                   }"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm btn-delete-camion" data-id="${
  //         camion._id
  //       }"><i class="fas fa-trash"></i></button></td>`;
  //       tablaBody.appendChild(row);
  //     });
  //   } catch (error) {
  //     tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
  //   }
  // }

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
        // CAMBIO: BACKEND_URL
        const response = await fetch(BACKEND_URL + "/api/camiones", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error al registrar");
        alert("¡Camión registrado!");
        formRegistrarCamion.reset();
        cargarCamiones();
        inicializarDashboard(); // Actualizar KPIs
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
        const camion = camionesCargados.find(
          (c) => c._id === btnEdit.dataset.id
        );
        if (camion) openEditCamionModal(camion);
      }
      if (btnDelete) {
        handleDeleteCamion(btnDelete.dataset.id);
      }
    });
  }
  async function handleDeleteCamion(id) {
    if (!confirm("¿Eliminar camión?")) return;
    try {
      // CAMBIO: BACKEND_URL
      const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Camión eliminado!");
      cargarCamiones();
      inicializarDashboard(); // Actualizar KPIs
    } catch (error) {
      alert(error.message);
    }
  }
  function openEditCamionModal(camion) {
    document.getElementById("edit-camion-id").value = camion._id;
    document.getElementById("edit-camion-placa").value = camion.placa;
    document.getElementById("edit-camion-unidad").value = camion.numeroUnidad;
    document.getElementById("edit-camion-modelo").value = camion.modelo || "";
    document.getElementById("edit-camion-estado").value = camion.estado;
    const selRuta = document.getElementById("edit-camion-ruta");
    selRuta.innerHTML = '<option value="">-- Sin Ruta --</option>';
    rutasCargadas.forEach((r) => {
      selRuta.innerHTML += `<option value="${r._id}">${r.nombre}</option>`;
    });
    selRuta.value = camion.rutaAsignada || "";
    modalCamion.classList.add("modal-visible");
  }
  function closeEditCamionModal() {
    modalCamion.classList.remove("modal-visible");
  }
  if (closeModalBtnCamion) closeModalBtnCamion.onclick = closeEditCamionModal;
  if (modalFormCamion) {
    modalFormCamion.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-camion-id").value;
      const datos = {
        placa: document.getElementById("edit-camion-placa").value,
        numeroUnidad: document.getElementById("edit-camion-unidad").value,
        modelo: document.getElementById("edit-camion-modelo").value,
        estado: document.getElementById("edit-camion-estado").value,
        rutaAsignada: document.getElementById("edit-camion-ruta").value,
      };
      try {
        // CAMBIO: BACKEND_URL
        const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("No se pudo actualizar");
        alert("¡Camión actualizado!");
        closeEditCamionModal();
        cargarCamiones();
        fetchAndDrawBuses();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // --- 6. CRUD - RUTAS ---
  const modalRuta = document.getElementById("edit-ruta-modal");
  const modalFormRuta = document.getElementById("form-edit-ruta");
  const closeModalBtnRuta = modalRuta.querySelector(".close-button");

  function renderTablaRutas(listaRutas) {
    const tablaBody = document.getElementById("tabla-rutas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (listaRutas.length === 0) {
      tablaBody.innerHTML =
        '<tr><td colspan="5">No se encontraron rutas.</td></tr>';
      return;
    }
    listaRutas.forEach((ruta) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${ruta.nombre}</td><td>${
        ruta.descripcion || "N/A"
      }</td><td><span class="badge ${
        ruta.activa ? "badge-admin" : "badge-conductor"
      }">${ruta.activa ? "Activa" : "Inactiva"}</span></td>
                    <td><button class="btn btn-secondary btn-sm btn-edit-ruta" data-id="${
                      ruta._id
                    }"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm btn-delete-ruta" data-id="${
        ruta._id
      }"><i class="fas fa-trash"></i></button></td>
                    <td><button class="btn btn-primary btn-sm btn-edit-mapa-ruta" data-id="${
                      ruta._id
                    }"><i class="fas fa-map-marked-alt"></i> Editar Trazado</button></td>`;
      tablaBody.appendChild(row);
    });
  }

  async function cargarRutas() {
    const tablaBody = document.getElementById("tabla-rutas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
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
        // Conversión de string 'true'/'false' a booleano para comparación
        let matchActive = true;
        if (activaVal !== "") {
          const boolVal = activaVal === "true";
          matchActive = r.activa === boolVal;
        }
        return matchName && matchActive;
      });
      renderTablaRutas(filtrados);
      document
        .getElementById("search-ruta-modal")
        .classList.remove("modal-visible");
    });
  }

  // async function cargarRutas() {
  //   const tablaBody = document.getElementById("tabla-rutas-body");
  //   if (!tablaBody) return;
  //   tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const response = await fetch(BACKEND_URL + "/api/rutas", {
  //       method: "GET",
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     if (!response.ok) throw new Error("Error al cargar rutas.");
  //     rutasCargadas = await response.json();
  //     tablaBody.innerHTML = "";
  //     if (rutasCargadas.length === 0) {
  //       tablaBody.innerHTML =
  //         '<tr><td colspan="5">No hay rutas registradas.</td></tr>';
  //       return;
  //     }
  //     rutasCargadas.forEach((ruta) => {
  //       const row = document.createElement("tr");
  //       row.innerHTML = `<td>${ruta.nombre}</td><td>${
  //         ruta.descripcion || "N/A"
  //       }</td><td><span class="badge ${
  //         ruta.activa ? "badge-admin" : "badge-conductor"
  //       }">${ruta.activa ? "Activa" : "Inactiva"}</span></td>
  //                   <td><button class="btn btn-secondary btn-sm btn-edit-ruta" data-id="${
  //                     ruta._id
  //                   }"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm btn-delete-ruta" data-id="${
  //         ruta._id
  //       }"><i class="fas fa-trash"></i></button></td>
  //                   <td><button class="btn btn-primary btn-sm btn-edit-mapa-ruta" data-id="${
  //                     ruta._id
  //                   }"><i class="fas fa-map-marked-alt"></i> Editar Trazado</button></td>`;
  //       tablaBody.appendChild(row);
  //     });
  //   } catch (error) {
  //     tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
  //   }
  // }

  const formRegistrarRuta = document.getElementById("form-registrar-ruta");
  if (formRegistrarRuta) {
    formRegistrarRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById("ruta-nombre").value,
        descripcion: document.getElementById("ruta-descripcion").value,
        tiempoEstimadoTotal: document.getElementById("ruta-tiempo").value
      };
      try {
        // CAMBIO: BACKEND_URL
        const response = await fetch(BACKEND_URL + "/api/rutas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error al registrar la ruta");
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
        const ruta = rutasCargadas.find((r) => r._id === btnEdit.dataset.id);
        if (ruta) openEditRutaModal(ruta);
      }
      if (btnDelete) {
        handleDeleteRuta(btnDelete.dataset.id);
      }
      if (btnEditMapa) {
        const ruta = rutasCargadas.find(
          (r) => r._id === btnEditMapa.dataset.id
        );
        if (ruta) openEditRutaMapaModal(ruta);
      }
    });
  }
  async function handleDeleteRuta(id) {
    if (!confirm("¿Eliminar ruta?")) return;
    try {
      // CAMBIO: BACKEND_URL
      const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo eliminar");
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
    document.getElementById("edit-ruta-tiempo").value = ruta.tiempoEstimadoTotal || "";
    document.getElementById("edit-ruta-activa").value = ruta.activa;
    modalRuta.classList.add("modal-visible");
  }
  function closeEditRutaModal() {
    modalRuta.classList.remove("modal-visible");
  }
  if (closeModalBtnRuta) closeModalBtnRuta.onclick = closeEditRutaModal;
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
        // CAMBIO: BACKEND_URL
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("No se pudo actualizar");
        alert("¡Ruta actualizada!");
        closeEditRutaModal();
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // --- 7. CRUD - HORARIOS ---
  const formRegistrarHorario = document.getElementById(
    "form-registrar-horario"
  );
  const modalEditarHorario = document.getElementById("modal-editar-horario");
  const formEditarHorario = document.getElementById("form-editar-horario");
  const closeBtnHorario = modalEditarHorario?.querySelector(".close-button");

  // Variables para edición
  let editingSalidaId = null;
  let editingHorarioId = null;

  if (formRegistrarHorario) {
    formRegistrarHorario.addEventListener("submit", async (e) => {
      // 1. Lo más importante: Detener la recarga de la página
      e.preventDefault();
      console.log("🛑 Submit interceptado, procesando registro...");

      // Validación básica de campos visuales
      const ruta = document.getElementById("horario-ruta").value;
      const dia = document.getElementById("horario-dia").value;
      const hora = document.getElementById("horario-hora").value;
      const camion = document.getElementById("horario-camion").value;
      const conductor = document.getElementById("horario-conductor").value;

      if (!ruta || !dia || !hora || !camion || !conductor) {
        alert("Por favor completa todos los campos");
        return;
      }

      const datos = {
        ruta: ruta,
        diaSemana: dia,
        hora: hora,
        camionAsignado: camion,
        conductorAsignado: conductor,
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

        const dataRes = await res.json();

        if (res.ok) {
          alert("✅ ¡Horario registrado correctamente!");
          formRegistrarHorario.reset();
          // Volver a cargar las tablas
          cargarHorarios();
        } else {
          console.error("Error backend:", dataRes);
          alert(
            "Error al registrar: " + (dataRes.message || "Error desconocido")
          );
        }
      } catch (error) {
        console.error("Error de red:", error);
        alert("Error de conexión con el servidor.");
      }
    });
  }

  //HORARIOS
  function renderTablaHorarios(listaHorarios) {
    const tablaBody = document.getElementById("tabla-horarios-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (listaHorarios.length === 0) {
      tablaBody.innerHTML =
        '<tr><td colspan="6">No se encontraron horarios.</td></tr>';
      return;
    }
    listaHorarios.forEach((h) => {
      const row = document.createElement("tr");
      row.innerHTML = `
            <td>${h.diaSemana}</td>
            <td><strong>${h.hora}</strong></td>
            <td>${h.rutaNombre || "N/A"}</td>
            <td>${h.camionUnidad || '<span class="text-muted">--</span>'}</td>
            <td>${
              h.conductorNombre || '<span class="text-muted">--</span>'
            }</td>
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
            </td>
        `;
      tablaBody.appendChild(row);
    });
  }

  async function cargarHorarios() {
    try {
      const response = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      horariosCargados = await response.json(); // Global
      renderTablaHorarios(horariosCargados);
    } catch (e) {}
  }

  const formSearchHorario = document.getElementById("form-search-horario");
  if (formSearchHorario) {
    formSearchHorario.addEventListener("submit", (e) => {
      e.preventDefault();
      const ruta = document
        .getElementById("search-horario-ruta")
        .value.toLowerCase();
      const dia = document.getElementById("search-horario-dia").value;
      const conductor = document
        .getElementById("search-horario-conductor")
        .value.toLowerCase();

      const filtrados = horariosCargados.filter((h) => {
        const matchRuta =
          !ruta || (h.rutaNombre && h.rutaNombre.toLowerCase().includes(ruta));
        const matchDia = !dia || h.diaSemana === dia;
        const matchCond =
          !conductor ||
          (h.conductorNombre &&
            h.conductorNombre.toLowerCase().includes(conductor));
        return matchRuta && matchDia && matchCond;
      });
      renderTablaHorarios(filtrados);
      document
        .getElementById("search-horario-modal")
        .classList.remove("modal-visible");
    });
  }

  // async function cargarHorarios() {
  //   const tablaBody = document.getElementById("tabla-horarios-body");
  //   if (!tablaBody) return;

  //   tablaBody.innerHTML = '<tr><td colspan="6">Cargando...</td></tr>';

  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const response = await fetch(BACKEND_URL + "/api/horarios", {
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     const horarios = await response.json();

  //     tablaBody.innerHTML = "";
  //     if (horarios.length === 0) {
  //       tablaBody.innerHTML =
  //         '<tr><td colspan="6">No hay horarios registrados.</td></tr>';
  //       return;
  //     }

  //     horarios.forEach((h) => {
  //       const row = document.createElement("tr");
  //       row.innerHTML = `
  //           <td>${h.diaSemana}</td>
  //           <td><strong>${h.hora}</strong></td>
  //           <td>${h.rutaNombre || "N/A"}</td>
  //           <td>${h.camionUnidad || '<span class="text-muted">--</span>'}</td>
  //           <td>${
  //             h.conductorNombre || '<span class="text-muted">--</span>'
  //           }</td>
  //           <td>
  //               <button class="btn btn-secondary btn-sm btn-edit-horario"
  //                   data-id="${h._id}"
  //                   data-salida-id="${h.salidaId}" title="Editar">
  //                   <i class="fas fa-edit"></i>
  //               </button>
  //               <button class="btn btn-danger btn-sm btn-delete-horario"
  //                   data-id="${h._id}"
  //                   data-salida-id="${h.salidaId}" title="Eliminar">
  //                   <i class="fas fa-trash"></i>
  //               </button>
  //           </td>
  //       `;
  //       tablaBody.appendChild(row);
  //     });
  //   } catch (error) {
  //     console.error(error);
  //     tablaBody.innerHTML = `<tr><td colspan="6" class="text-danger">Error al cargar</td></tr>`;
  //   }
  // }

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
        if (btnDelete) {
          const { id, salidaId } = btnDelete.dataset;
          if (
            confirm("⚠️ ¿Estás seguro de eliminar esta salida del horario?")
          ) {
            eliminarHorario(id, salidaId);
          }
        }
      }
    });

  async function popularDropdownsHorarios(esEdicion = false) {
    const suffix = esEdicion ? "edit-horario" : "horario";
    const selRuta = document.getElementById(`${suffix}-ruta`);
    const selCamion = document.getElementById(`${suffix}-camion`);
    const selConductor = document.getElementById(`${suffix}-conductor`);

    // Limpiar opciones previas
    if (selRuta) selRuta.innerHTML = '<option value="">Cargando...</option>';
    if (selCamion)
      selCamion.innerHTML = '<option value="">Cargando...</option>';
    if (selConductor)
      selConductor.innerHTML = '<option value="">Cargando...</option>';

    try {
      // Hacemos fetch de todo siempre para asegurar que los selects tengan datos
      const [resRutas, resCamiones, resConductores] = await Promise.all([
        fetch(BACKEND_URL + "/api/rutas", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/camiones", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/users", {
          headers: { Authorization: `Bearer ${token}` },
        }), // Endpoint general de usuarios, filtraremos en JS
      ]);

      const rutas = await resRutas.json();
      const camiones = await resCamiones.json();
      const usuarios = await resConductores.json();

      // Filtrar solo conductores
      const conductores = usuarios.filter((u) => u.tipo === "conductor");

      // Llenar Ruta
      if (selRuta) {
        selRuta.innerHTML = '<option value="">-- Elige una Ruta --</option>';
        rutas.forEach((r) => {
          if (r.activa)
            selRuta.innerHTML += `<option value="${r._id}">${r.nombre}</option>`;
        });
      }

      // Llenar Camión (Ahora también funciona para el modal de edición)
      if (selCamion) {
        selCamion.innerHTML = '<option value="">-- Elige un Camión --</option>';
        camiones.forEach((c) => {
          // En edición mostramos todos, o solo activos. Aquí mostramos activos.
          if (c.estado === "activo")
            selCamion.innerHTML += `<option value="${c._id}">${c.numeroUnidad} (${c.placa})</option>`;
        });
      }

      // Llenar Conductor (Ahora también funciona para el modal de edición)
      if (selConductor) {
        selConductor.innerHTML =
          '<option value="">-- Elige un Conductor --</option>';
        conductores.forEach((c) => {
          selConductor.innerHTML += `<option value="${c._id}">${c.nombre}</option>`;
        });
      }
    } catch (error) {
      console.error("Error populando dropdowns:", error);
    }
  }

  async function abrirEditarHorario(horarioId, salidaId) {
    // 1. Cargar listas desplegables
    await popularDropdownsHorarios(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/horarios/${horarioId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("No se pudo obtener el horario");

      const horarioDoc = await res.json();
      const salida = horarioDoc.salidas.find((s) => s._id === salidaId);

      if (!salida) throw new Error("Salida no encontrada en la base de datos");

      // 2. Llenar el formulario del modal
      document.getElementById("edit-horario-id").value = horarioId;
      document.getElementById("edit-salida-id").value = salidaId;

      // Variables globales para el submit
      editingSalidaId = salidaId;
      editingHorarioId = horarioId;

      // Seteamos valores seleccionados
      document.getElementById("edit-horario-ruta").value =
        horarioDoc.ruta._id || horarioDoc.ruta;
      document.getElementById("edit-horario-dia").value = horarioDoc.diaSemana;
      document.getElementById("edit-horario-salida").value = salida.hora;
      document.getElementById("edit-horario-camion").value =
        salida.camionAsignado || "";
      document.getElementById("edit-horario-conductor").value =
        salida.conductorAsignado || "";

      // 3. CONFIGURAR BOTÓN ELIMINAR DEL MODAL (CON CONFIRMACIÓN)
      const btnDeleteModal = document.getElementById("btn-delete-from-modal");
      if (btnDeleteModal) {
        // Clonamos el botón para limpiar eventos anteriores (evita clicks múltiples)
        const newBtn = btnDeleteModal.cloneNode(true);
        btnDeleteModal.parentNode.replaceChild(newBtn, btnDeleteModal);

        newBtn.addEventListener("click", async () => {
          // ---> AQUÍ ESTÁ LA PREGUNTA DE SEGURIDAD <---
          const confirmar = confirm(
            "⚠️ ¿Estás SEGURO de que deseas eliminar este horario permanentemente?\nEsta acción no se puede deshacer."
          );

          if (confirmar) {
            await eliminarHorario(horarioId, salidaId);
            modalEditarHorario.classList.remove("modal-visible");
          }
        });
      }

      // Mostrar el modal
      modalEditarHorario.classList.add("modal-visible");
    } catch (error) {
      console.error(error);
      alert("Error al cargar datos: " + error.message);
    }
  }

  // Función auxiliar para eliminar (para reutilizar lógica)
  async function eliminarHorario(horarioId, salidaId) {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/horarios/${horarioId}/salidas/${salidaId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Salida eliminada!");
      cargarHorarios();
    } catch (error) {
      alert(error.message);
    }
  }

  if (formEditarHorario) {
    formEditarHorario.addEventListener("submit", async (e) => {
      e.preventDefault();

      const data = {
        ruta: document.getElementById("edit-horario-ruta").value,
        diaSemana: document.getElementById("edit-horario-dia").value,
        hora: document.getElementById("edit-horario-salida").value,
        // Enviamos los nuevos campos
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
          alert("✅ Horario actualizado correctamente");
          modalEditarHorario.classList.remove("modal-visible");
          cargarHorarios();
        } else {
          const err = await res.json();
          alert("Error: " + err.message);
        }
      } catch (error) {
        console.error(error);
        alert("Error de conexión");
      }
    });
  }
  async function handleDeleteHorario(id, salidaId) {
    if (!confirm("¿Eliminar esta salida del horario?")) return;
    try {
      // CAMBIO: BACKEND_URL
      const response = await fetch(
        `${BACKEND_URL}/api/horarios/${id}/salidas/${salidaId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Salida eliminada!");
      cargarHorarios();
    } catch (error) {
      alert(error.message);
    }
  }

  // async function abrirEditarHorario(horarioId, salidaId) {
  //   await popularDropdownsHorarios(true);

  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const res = await fetch(`${BACKEND_URL}/api/horarios/${horarioId}`, {
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     const horarioDoc = await res.json();
  //     const salida = horarioDoc.salidas.find((s) => s._id === salidaId);

  //     if (!salida) throw new Error("Salida no encontrada");

  //     document.getElementById("edit-horario-id").value = horarioId;
  //     editingSalidaId = salidaId;
  //     editingHorarioId = horarioId;

  //     const selRuta = document.getElementById("edit-horario-ruta");
  //     selRuta.value = horarioDoc.ruta._id || horarioDoc.ruta;

  //     const selDia = document.getElementById("edit-horario-dia");
  //     selDia.value = horarioDoc.diaSemana;

  //     document.getElementById("edit-horario-salida").value = salida.hora;
  //     document.getElementById("edit-horario-llegada").value = "";

  //     modalEditarHorario.classList.add("modal-visible");
  //   } catch (error) {
  //     console.error(error);
  //     alert("Error al cargar datos");
  //   }
  // }

  // if (formEditarHorario) {
  //   formEditarHorario.addEventListener("submit", async (e) => {
  //       e.preventDefault();

  //       const data = {
  //           ruta: document.getElementById("edit-horario-ruta").value,
  //           diaSemana: document.getElementById("edit-horario-dia").value,
  //           hora: document.getElementById("edit-horario-salida").value
  //       };

  //       try {
  //           // CAMBIO: BACKEND_URL
  //           const res = await fetch(`${BACKEND_URL}/api/horarios/${editingHorarioId}/salidas/${editingSalidaId}`, {
  //               method: 'PUT',
  //               headers: {
  //                   'Content-Type': 'application/json',
  //                   'Authorization': `Bearer ${token}`
  //               },
  //               body: JSON.stringify(data)
  //           });

  //           if (res.ok) {
  //               alert('✅ Horario actualizado correctamente');
  //               modalEditarHorario.classList.remove("modal-visible");
  //               cargarHorarios();
  //           } else {
  //               const err = await res.json();
  //               alert('Error: ' + err.message);
  //           }
  //       } catch (error) {
  //           console.error(error);
  //           alert("Error de conexión");
  //       }
  //   });
  // }

  if (closeBtnHorario) {
    closeBtnHorario.onclick = () => {
      modalEditarHorario.classList.remove("modal-visible");
    };
  }
  window.cerrarModalEditarHorario = () => {
    modalEditarHorario.classList.remove("modal-visible");
  };

  // --- 8. EDITOR DE RUTAS (MAPA Y BUSCADOR DE GUÍAS) ---
  const modalRutaMapa = document.getElementById("edit-ruta-mapa-modal");
  const modalFormRutaMapa = document.getElementById("form-edit-ruta-mapa");
  const closeModalBtnRutaMapa = modalRutaMapa.querySelector(".close-button");
  const listaParadasUI = document.getElementById("lista-paradas");
  
  const inputRefOrigin = document.getElementById("ref-origin");
  const inputRefDest = document.getElementById("ref-destination");
  const btnClearRefs = document.getElementById("btn-clear-refs");

  // Botones de Modo
  const btnModeTracing = document.getElementById("btn-mode-tracing");
  const btnModeStops = document.getElementById("btn-mode-stops");
  
  let editorMode = 'tracing'; 
  let editorMap = null;
  
  // ARREGLOS SEPARADOS
  let arrayPuntosTrazado = []; // [[lat, lng], [lat, lng]]
  let arrayPuntosParada = [];  // [{nombre, ubicacion...}]
  
  let traceLayerGroup = L.layerGroup(); 
  let stopsLayerGroup = L.layerGroup(); 
  let marcadoresGuia = [];

  // Configurar Botones de Modo
  if(btnModeTracing && btnModeStops) {
      btnModeTracing.addEventListener("click", () => setEditorMode('tracing'));
      btnModeStops.addEventListener("click", () => setEditorMode('stops'));
  }

  function setEditorMode(mode) {
      editorMode = mode;
      if(mode === 'tracing') {
          btnModeTracing.classList.add("active");
          btnModeStops.classList.remove("active");
          if(editorMap) editorMap.getContainer().style.cursor = "crosshair"; 
      } else {
          btnModeStops.classList.add("active");
          btnModeTracing.classList.remove("active");
          if(editorMap) editorMap.getContainer().style.cursor = "default";
      }
  }

  function inicializarEditorMapa() {
    if (editorMap) return;
    
    editorMap = L.map("ruta-map-editor").setView([initialLat, initialLng], initialZoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
    }).addTo(editorMap);

    traceLayerGroup.addTo(editorMap);
    stopsLayerGroup.addTo(editorMap);

    // EVENTO CLIC EN EL MAPA
    editorMap.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (editorMode === 'tracing') {
          // Agregar punto al camino
          arrayPuntosTrazado.push([lat, lng]);
          dibujarTrazado(); 
      } else {
          // Agregar parada
          const nuevaParada = {
              nombre: `Parada ${arrayPuntosParada.length + 1}`,
              tipo: 'parada_oficial', 
              ubicacion: { type: "Point", coordinates: [lng, lat] }
          };
          arrayPuntosParada.push(nuevaParada);
          dibujarParadas();
      }
      actualizarListaUI();
    });
  }

  // --- DIBUJAR TRAZADO (LÍNEA + PUNTOS) ---
  function dibujarTrazado() {
      traceLayerGroup.clearLayers(); 
      
      if (arrayPuntosTrazado.length === 0) return;

      // 1. Línea
      L.polyline(arrayPuntosTrazado, {
          color: '#007bff', weight: 5, opacity: 0.7, lineJoin: 'round'
      }).addTo(traceLayerGroup);

      // 2. Puntos (Corrección: Clase correcta 'dot-marker')
      const dotIcon = L.divIcon({
          className: 'dot-marker', // Esta clase ya está en tu CSS
          html: '', 
          iconSize: [12, 12], 
          iconAnchor: [6, 6]
      });

      arrayPuntosTrazado.forEach((coords, index) => {
          const marker = L.marker(coords, { icon: dotIcon, draggable: true });
          
          marker.bindPopup(`
              <div style="text-align:center;">
                  <small>Punto Trazado #${index + 1}</small><br>
                  <button onclick="borrarPuntoTrazo(${index})" class="btn btn-danger btn-sm" style="margin-top:5px; font-size:0.8rem;">Eliminar</button>
              </div>
          `);

          marker.on('dragend', (e) => {
              const newPos = e.target.getLatLng();
              arrayPuntosTrazado[index] = [newPos.lat, newPos.lng];
              dibujarTrazado(); // Redibujar al soltar
          });
          marker.addTo(traceLayerGroup);
      });
  }

  // --- DIBUJAR PARADAS ---
  function dibujarParadas() {
      stopsLayerGroup.clearLayers(); 
      
      const stopIcon = L.divIcon({
          className: 'parada-marker',
          html: '<i class="fas fa-bus"></i>', 
          iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
      });

      arrayPuntosParada.forEach((parada, index) => {
          const [lng, lat] = parada.ubicacion.coordinates;
          const marker = L.marker([lat, lng], { icon: stopIcon, draggable: true });

          marker.bindPopup(`
              <div style="text-align:center;">
                  <strong>${parada.nombre}</strong><br>
                  <button onclick="borrarParada(${index})" class="btn btn-danger btn-sm" style="margin-top:5px;">Borrar</button>
              </div>
          `);

          marker.on('dragend', (e) => {
              const newPos = e.target.getLatLng();
              arrayPuntosParada[index].ubicacion.coordinates = [newPos.lng, newPos.lat];
          });
          marker.addTo(stopsLayerGroup);
      });
  }

  function actualizarListaUI() {
      if(!listaParadasUI) return;
      listaParadasUI.innerHTML = "";

      // 1. Resumen de contadores (Lo que ya tenías)
      listaParadasUI.innerHTML += `
          <li style="border-bottom:1px solid #444; padding:5px; margin-bottom:5px; font-size:0.85rem; color:#aaa;">
             <span style="color:#007bff">● Puntos Trazado: <strong>${arrayPuntosTrazado.length}</strong></span> | 
             <span style="color:#ffc107">● Paradas: <strong>${arrayPuntosParada.length}</strong></span>
          </li>
      `;

      // 2. LISTAR PARADAS (Amarillas)
      if (arrayPuntosParada.length > 0) {
          listaParadasUI.innerHTML += `<li style="background:#2a2a2a; color:#ffc107; padding:5px 10px; font-weight:bold; font-size:0.8rem; border-bottom:1px solid #444;">▼ PARADAS</li>`;
          
          arrayPuntosParada.forEach((p, i) => {
              listaParadasUI.innerHTML += `
                <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #333; font-size:0.9rem;">
                    <span style="color:#ddd;"><i class="fas fa-map-pin" style="color:#ffc107; margin-right:8px;"></i> ${p.nombre}</span>
                    <i class="fas fa-trash" style="color:#ff6b6b; cursor:pointer;" title="Eliminar Parada" onclick="borrarParada(${i})"></i>
                </li>`;
          });
      }

      // 3. LISTAR PUNTOS DE TRAZADO (Azules) - ¡ESTO ES LO QUE FALTABA!
      if (arrayPuntosTrazado.length > 0) {
          listaParadasUI.innerHTML += `<li style="background:#2a2a2a; color:#007bff; padding:5px 10px; font-weight:bold; font-size:0.8rem; border-bottom:1px solid #444; margin-top:10px;">▼ CAMINO (TRAZADO)</li>`;
          
          arrayPuntosTrazado.forEach((coords, i) => {
              // Acortamos las coordenadas para que quepan visualmente
              // coords es un array [lat, lng]
              const latStr = coords[0].toFixed(5);
              const lngStr = coords[1].toFixed(5);
              
              listaParadasUI.innerHTML += `
                <li style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border-bottom:1px solid #333; font-size:0.85rem; color:#aaa;">
                    <span>
                        <i class="fas fa-circle" style="font-size:0.5rem; color:#007bff; margin-right:8px;"></i> 
                        Punto ${i + 1} <small style="color:#666;">[${latStr}, ${lngStr}]</small>
                    </span>
                    <i class="fas fa-times" style="color:#666; cursor:pointer;" onmouseover="this.style.color='red'" onmouseout="this.style.color='#666'" onclick="borrarPuntoTrazo(${i})"></i>
                </li>`;
          });
      }

      if(arrayPuntosTrazado.length === 0 && arrayPuntosParada.length === 0) {
          listaParadasUI.innerHTML += "<li style='padding:15px; text-align:center; color:#666;'>Mapa vacío.<br>Selecciona un modo y haz clic en el mapa.</li>";
      }
  }

  // Funciones Globales para los popups
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
      marcadoresGuia.forEach(m => editorMap.removeLayer(m));
      marcadoresGuia = [];
      if(inputRefOrigin) inputRefOrigin.value = "";
      if(inputRefDest) inputRefDest.value = "";
      // cerrarListas() si la tienes
  }
  if(btnClearRefs) btnClearRefs.addEventListener("click", limpiarGuias);

  // --- ABRIR EDITOR ---
  window.openEditRutaMapaModal = (ruta) => {
    modalRutaMapa.classList.add("modal-visible");
    document.getElementById("edit-ruta-mapa-id").value = ruta._id;

    // --- NUEVO: Poner el nombre de la ruta en el título ---
    const tituloSpan = document.getElementById("nombre-ruta-editor");
    if (tituloSpan) {
        tituloSpan.textContent = ruta.nombre;
    }
    
    const allPoints = ruta.paradas || [];
    arrayPuntosTrazado = [];
    arrayPuntosParada = [];

    // Separar datos existentes
    allPoints.forEach(p => {
        const [lng, lat] = p.ubicacion.coordinates;
        if (p.tipo === 'parada_oficial' || (p.nombre && p.nombre.toLowerCase().includes("parada"))) {
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
      setEditorMode('tracing');
    }, 100);
  };

  // --- GUARDAR ---
  if (modalFormRutaMapa) {
    modalFormRutaMapa.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-mapa-id").value;
      
      const trazoParaGuardar = arrayPuntosTrazado.map((coords, i) => ({
          nombre: `Punto ${i}`,
          tipo: 'trazo', 
          ubicacion: { type: "Point", coordinates: [coords[1], coords[0]] } 
      }));

      const paradasParaGuardar = arrayPuntosParada.map(p => ({
          ...p,
          tipo: 'parada_oficial'
      }));

      const payload = { paradas: [...trazoParaGuardar, ...paradasParaGuardar] };

      try {
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}/paradas`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Error guardando");
        alert("¡Ruta guardada!");
        modalRutaMapa.classList.remove("modal-visible");
        cargarRutas();
      } catch (error) { alert(error.message); }
    });
  }

  // --- CIERRE MODALES ---
  window.onclick = (e) => {
      if(e.target.classList.contains("modal") || e.target.classList.contains("fullscreen-overlay")) {
          e.target.classList.remove("modal-visible");
      }
  };
  document.querySelectorAll(".close-button").forEach(btn => {
      btn.addEventListener("click", (e) => {
          e.target.closest(".modal")?.classList.remove("modal-visible");
          e.target.closest(".fullscreen-overlay")?.classList.remove("modal-visible");
      });
  });

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
      alertasCargadas = await response.json();
      renderTablaAlertas(alertasCargadas);
    } catch (e) {}
  }

  const formSearchAlerta = document.getElementById("form-search-alerta");
  if (formSearchAlerta) {
    formSearchAlerta.addEventListener("submit", (e) => {
      e.preventDefault();
      const unidad = document
        .getElementById("search-alerta-unidad")
        .value.toLowerCase();
      const tipo = document
        .getElementById("search-alerta-tipo")
        .value.toLowerCase();

      const filtrados = alertasCargadas.filter((a) => {
        const matchUnidad =
          !unidad ||
          (a.camionUnidad && a.camionUnidad.toLowerCase().includes(unidad));
        const matchTipo =
          !tipo || (a.titulo && a.titulo.toLowerCase().includes(tipo));
        return matchUnidad && matchTipo;
      });
      renderTablaAlertas(filtrados);
      document
        .getElementById("search-alerta-modal")
        .classList.remove("modal-visible");
    });
  }

  // async function cargarAlertas() {
  //   const tablaBody = document.getElementById("tabla-alertas-body");
  //   if (!tablaBody) return;
  //   tablaBody.innerHTML = '<tr><td colspan="4">Cargando historial...</td></tr>';

  //   try {
  //     // CAMBIO: BACKEND_URL
  //     const response = await fetch(BACKEND_URL + "/api/notificaciones", {
  //       method: "GET",
  //       headers: { Authorization: `Bearer ${token}` },
  //     });

  //     if (!response.ok) {
  //       const err = await response.json();
  //       throw new Error(err.message || "Error al cargar alertas.");
  //     }

  //     const alertas = await response.json();

  //     tablaBody.innerHTML = "";
  //     if (alertas.length === 0) {
  //       tablaBody.innerHTML =
  //         '<tr><td colspan="4">No hay alertas registradas.</td></tr>';
  //       return;
  //     }

  //     alertas.forEach((alerta) => {
  //       const row = document.createElement("tr");
  //       const fecha = new Date(alerta.createdAt).toLocaleString("es-MX", {
  //         dateStyle: "short",
  //         timeStyle: "short",
  //       });

  //       row.innerHTML = `
  //                   <td class="alert-row-danger">${
  //                     alerta.camionUnidad || "N/A"
  //                   }</td>
  //                   <td>${alerta.titulo}</td>
  //                   <td>${alerta.mensaje}</td>
  //                   <td>${fecha}</td>
  //               `;
  //       tablaBody.appendChild(row);
  //     });
  //   } catch (error) {
  //     console.error(error);
  //     tablaBody.innerHTML = `<tr><td colspan="4" class="text-danger">${error.message}</td></tr>`;
  //   }
  // }

  // --- FUNCIÓN GENÉRICA PARA ABRIR/CERRAR MODALES DE BÚSQUEDA ---
  window.abrirModalBusqueda = function (tipo) {
    const modal = document.getElementById(`search-${tipo}-modal`);
    if (modal) modal.classList.add("modal-visible");
  };

  // Botones "Limpiar" dentro de los modales
  document.querySelectorAll(".btn-reset-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // 1. Resetear formulario
      const form = e.target.closest("form");
      form.reset();
      // 2. Cerrar modal
      const modal = e.target.closest(".modal");
      modal.classList.remove("modal-visible");
      // 3. Restaurar tabla completa (según el ID del form)
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

  // --- Cierre de Modales (General) ---
  window.onclick = function (event) {
    if (event.target == modalCamion) closeEditCamionModal();
    if (event.target == modalRuta) closeEditRutaModal();
    if (event.target == modalUser) closeEditUserModal();
    if (event.target == modalRutaMapa) closeEditRutaMapaModal();
    if (event.target == modalEditarHorario) cerrarModalEditarHorario();
    if (event.target.classList.contains("modal")) {
      event.target.classList.remove("modal-visible");
    }
  };

  // Cerrar con la X
  document.querySelectorAll(".close-button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.target.closest(".modal")?.classList.remove("modal-visible");
      e.target
        .closest(".fullscreen-overlay")
        ?.classList.remove("modal-visible");
    });
  });
});
