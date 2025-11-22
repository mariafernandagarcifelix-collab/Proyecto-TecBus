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
  let busMarkers = {};

  const socket = io("http://localhost:5000");
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
        fetchAndDrawBuses();
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
      } // <-- ¡LÍNEA NUEVA!
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
  async function fetchAndDrawBuses() {
    try {
      const response = await fetch("http://localhost:5000/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudieron cargar los camiones");
      const camiones = await response.json();
      Object.values(busMarkers).forEach((marker) => map.removeLayer(marker));
      busMarkers = {};
      document.getElementById("kpi-total-buses").textContent = camiones.length;
      const activos = camiones.filter((c) => c.estado === "activo").length;
      document.getElementById("kpi-drivers-active").textContent = activos;
      camiones.forEach((camion) => {
        if (camion.ubicacionActual) {
          const [lng, lat] = camion.ubicacionActual.coordinates;
          const marker = L.marker([lat, lng], { icon: busIcon })
            .addTo(map)
            .bindPopup(`🚍 **${camion.numeroUnidad}** (${camion.placa})`);
          busMarkers[camion._id] = marker;
        }
      });
    } catch (error) {
      console.error(error);
    }
  }
  fetchAndDrawBuses();
  const kpiStudents = document.getElementById("kpi-students-waiting");
  const kpiAlerts = document.getElementById("kpi-active-alerts");
  let studentCount = 0,
    alertCount = 0;
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLatLng([data.location.lat, data.location.lng]);
    } else {
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

  // --- 4. CRUD USUARIOS ---
  const modalUser = document.getElementById("edit-user-modal");
  const modalFormUser = document.getElementById("form-edit-user");
  const closeModalBtnUser = modalUser.querySelector(".close-button");
  const camposConductor = document.getElementById("campos-conductor");
  async function cargarUsuarios() {
    const tablaBody = document.getElementById("tabla-usuarios-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch("http://localhost:5000/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error al cargar usuarios.");
      usuariosCargados = await response.json();
      tablaBody.innerHTML = "";
      if (usuariosCargados.length === 0) {
        tablaBody.innerHTML =
          '<tr><td colspan="5">No hay usuarios registrados.</td></tr>';
        return;
      }
      usuariosCargados.forEach((user) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${user.nombre}</td><td>${
          user.email
        }</td><td><span class="badge ${
          user.tipo === "administrador"
            ? "badge-admin"
            : user.tipo === "conductor"
            ? "badge-conductor"
            : ""
        }">${user.tipo}</span></td>
                    <td>${
                      user.estado
                    }</td><td><button class="btn btn-secondary btn-sm btn-edit-user" data-id="${
          user._id
        }"><i class="fas fa-edit"></i></button></td>`;
        tablaBody.appendChild(row);
      });
    } catch (error) {
      tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }
  const formRegistrarUsuario = document.getElementById(
    "form-registrar-usuario"
  );
  if (formRegistrarUsuario) {
    formRegistrarUsuario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById("user-nombre").value,
        email: document.getElementById("user-email").value,
        password: document.getElementById("user-password").value,
        tipo: document.getElementById("user-tipo").value,
      };
      try {
        const response = await fetch("http://localhost:5000/api/users", {
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
      if (btnEdit) {
        const user = usuariosCargados.find((u) => u._id === btnEdit.dataset.id);
        if (user) openEditUserModal(user);
      }
    });
  }
  async function openEditUserModal(user) {
    document.getElementById("edit-user-id").value = user._id;
    document.getElementById("edit-user-nombre").value = user.nombre;
    document.getElementById("edit-user-email").value = user.email;
    document.getElementById("edit-user-tipo").value = user.tipo;
    document.getElementById("edit-user-estado").value = user.estado;
    if (user.tipo === "conductor") {
      camposConductor.style.display = "block";
      document.getElementById("edit-user-licencia").value =
        user.conductor?.licencia || "";
      const selCamion = document.getElementById("edit-user-camion");
      selCamion.innerHTML = '<option value="">-- Ninguno --</option>';
      if (camionesCargados.length === 0) await cargarCamiones();
      camionesCargados.forEach((c) => {
        selCamion.innerHTML += `<option value="${c._id}">${c.numeroUnidad} (${c.placa})</option>`;
      });
      selCamion.value = user.conductor?.vehiculoAsignado || "";
    } else {
      camposConductor.style.display = "none";
    }
    modalUser.classList.add("modal-visible");
  }
  function closeEditUserModal() {
    modalUser.classList.remove("modal-visible");
  }
  if (closeModalBtnUser) closeModalBtnUser.onclick = closeEditUserModal;
  if (modalFormUser) {
    modalFormUser.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-user-id").value;
      const datos = {
        nombre: document.getElementById("edit-user-nombre").value,
        email: document.getElementById("edit-user-email").value,
        tipo: document.getElementById("edit-user-tipo").value,
        estado: document.getElementById("edit-user-estado").value,
        licencia: document.getElementById("edit-user-licencia").value,
        vehiculoAsignado: document.getElementById("edit-user-camion").value,
      };
      try {
        const response = await fetch(`http://localhost:5000/api/users/${id}`, {
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
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // --- 5. CRUD - CAMIONES ---
  const modalCamion = document.getElementById("edit-camion-modal");
  const modalFormCamion = document.getElementById("form-edit-camion");
  const closeModalBtnCamion = modalCamion.querySelector(".close-button");
  async function cargarCamiones() {
    const tablaBody = document.getElementById("tabla-camiones-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch("http://localhost:5000/api/camiones", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error al cargar camiones.");
      camionesCargados = await response.json();
      tablaBody.innerHTML = "";
      if (camionesCargados.length === 0) {
        tablaBody.innerHTML =
          '<tr><td colspan="5">No hay camiones registrados.</td></tr>';
        return;
      }
      camionesCargados.forEach((camion) => {
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
    } catch (error) {
      tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
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
        const response = await fetch("http://localhost:5000/api/camiones", {
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
        fetchAndDrawBuses();
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
      const response = await fetch(`http://localhost:5000/api/camiones/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Camión eliminado!");
      cargarCamiones();
      fetchAndDrawBuses();
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
        const response = await fetch(
          `http://localhost:5000/api/camiones/${id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(datos),
          }
        );
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
  async function cargarRutas() {
    const tablaBody = document.getElementById("tabla-rutas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch("http://localhost:5000/api/rutas", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error al cargar rutas.");
      rutasCargadas = await response.json();
      tablaBody.innerHTML = "";
      if (rutasCargadas.length === 0) {
        tablaBody.innerHTML =
          '<tr><td colspan="5">No hay rutas registradas.</td></tr>';
        return;
      }
      rutasCargadas.forEach((ruta) => {
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
    } catch (error) {
      tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }
  const formRegistrarRuta = document.getElementById("form-registrar-ruta");
  if (formRegistrarRuta) {
    formRegistrarRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById("ruta-nombre").value,
        descripcion: document.getElementById("ruta-descripcion").value,
      };
      try {
        const response = await fetch("http://localhost:5000/api/rutas", {
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
      const response = await fetch(`http://localhost:5000/api/rutas/${id}`, {
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
        activa: document.getElementById("edit-ruta-activa").value === "true",
      };
      try {
        const response = await fetch(`http://localhost:5000/api/rutas/${id}`, {
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
  async function cargarHorarios() {
    const tablaBody = document.getElementById("tabla-horarios-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="6">Cargando...</td></tr>';
    try {
      const response = await fetch("http://localhost:5000/api/horarios", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error al cargar horarios.");
      const horarios = await response.json();
      tablaBody.innerHTML = "";
      if (horarios.length === 0) {
        tablaBody.innerHTML =
          '<tr><td colspan="6">No hay horarios registrados.</td></tr>';
        return;
      }
      horarios.forEach((h) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${h.diaSemana}</td><td>${h.hora}</td><td>${
          h.rutaNombre || "Ruta eliminada"
        }</td><td>${h.camionUnidad || "Camión eliminado"}</td><td>${
          h.conductorNombre || "Conductor eliminado"
        }</td>
                    <td><button class="btn btn-danger btn-sm btn-delete-horario" data-id="${
                      h._id
                    }" data-salida-id="${
          h.salidaId
        }"><i class="fas fa-trash"></i></button></td>`;
        tablaBody.appendChild(row);
      });
    } catch (error) {
      tablaBody.innerHTML = `<tr><td colspan="6" class="text-danger">${error.message}</td></tr>`;
    }
  }
  async function popularDropdownsHorarios() {
    const selRuta = document.getElementById("horario-ruta");
    const selCamion = document.getElementById("horario-camion");
    const selConductor = document.getElementById("horario-conductor");
    try {
      const [resRutas, resCamiones, resConductores] = await Promise.all([
        fetch("http://localhost:5000/api/rutas", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("http://localhost:5000/api/camiones", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("http://localhost:5000/api/users/conductores", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const rutas = await resRutas.json();
      const camiones = await resCamiones.json();
      const conductores = await resConductores.json();
      selRuta.innerHTML = '<option value="">-- Elige una Ruta --</option>';
      rutas.forEach((r) => {
        if (r.activa)
          selRuta.innerHTML += `<option value="${r._id}">${r.nombre}</option>`;
      });
      selCamion.innerHTML = '<option value="">-- Elige un Camión --</option>';
      camiones.forEach((c) => {
        if (c.estado === "activo")
          selCamion.innerHTML += `<option value="${c._id}">${c.numeroUnidad} (${c.placa})</option>`;
      });
      selConductor.innerHTML =
        '<option value="">-- Elige un Conductor --</option>';
      conductores.forEach((c) => {
        selConductor.innerHTML += `<option value="${c._id}">${c.nombre}</option>`;
      });
    } catch (error) {
      console.error("Error populando dropdowns:", error);
    }
  }
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
        const response = await fetch("http://localhost:5000/api/horarios", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error al registrar la salida");
        alert("¡Salida registrada!");
        formRegistrarHorario.reset();
        cargarHorarios();
      } catch (error) {
        alert(error.message);
      }
    });
  }
  const tablaBodyHorarios = document.getElementById("tabla-horarios-body");
  if (tablaBodyHorarios) {
    tablaBodyHorarios.addEventListener("click", (e) => {
      const btnDelete = e.target.closest(".btn-delete-horario");
      if (btnDelete) {
        handleDeleteHorario(btnDelete.dataset.id, btnDelete.dataset.salidaId);
      }
    });
  }
  async function handleDeleteHorario(id, salidaId) {
    if (!confirm("¿Eliminar esta salida del horario?")) return;
    try {
      const response = await fetch(
        `http://localhost:5000/api/horarios/${id}/salidas/${salidaId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Salida eliminada!");
      cargarHorarios();
    } catch (error) {
      alert(error.message);
    }
  }

  // --- 8. CRUD - EDITOR DE RUTAS (MAPA) ---
  const modalRutaMapa = document.getElementById("edit-ruta-mapa-modal");
  const modalFormRutaMapa = document.getElementById("form-edit-ruta-mapa");
  const closeModalBtnRutaMapa = modalRutaMapa.querySelector(".close-button");
  const listaParadasUI = document.getElementById("lista-paradas");
  let editorMap = null;
  let paradasTemporales = [];
  let marcadoresParadas = [];
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
    editorMap.on("click", (e) => {
      const { lat, lng } = e.latlng;
      const nuevaParada = {
        nombre: `Parada ${paradasTemporales.length + 1}`,
        orden: paradasTemporales.length + 1,
        ubicacion: { type: "Point", coordinates: [lng, lat] },
      };
      paradasTemporales.push(nuevaParada);
      actualizarUIParadas();
    });
  }
  function openEditRutaMapaModal(ruta) {
    modalRutaMapa.classList.add("modal-visible");
    document.getElementById("edit-ruta-mapa-id").value = ruta._id;
    setTimeout(() => {
      inicializarEditorMapa();
      editorMap.invalidateSize();
      paradasTemporales = ruta.paradas || [];
      actualizarUIParadas();
    }, 100);
  }
  function actualizarUIParadas() {
    marcadoresParadas.forEach((m) => editorMap.removeLayer(m));
    marcadoresParadas = [];
    listaParadasUI.innerHTML = "";
    if (paradasTemporales.length === 0) {
      listaParadasUI.innerHTML = "<li>No hay paradas definidas.</li>";
      return;
    }
    const latLngs = [];
    paradasTemporales.forEach((parada, index) => {
      const [lng, lat] = parada.ubicacion.coordinates;
      latLngs.push([lat, lng]);
      const marker = L.marker([lat, lng])
        .addTo(editorMap)
        .bindPopup(`Parada ${index + 1}`);
      marker.on("click", () => {
        paradasTemporales.splice(index, 1);
        actualizarUIParadas();
      });
      marcadoresParadas.push(marker);
      listaParadasUI.innerHTML += `<li>Parada ${
        index + 1
      } (Clic en el marcador para eliminar)</li>`;
    });
  }
  function closeEditRutaMapaModal() {
    modalRutaMapa.classList.remove("modal-visible");
  }
  if (closeModalBtnRutaMapa)
    closeModalBtnRutaMapa.onclick = closeEditRutaMapaModal;
  if (modalFormRutaMapa) {
    modalFormRutaMapa.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-mapa-id").value;
      try {
        const response = await fetch(
          `http://localhost:5000/api/rutas/${id}/paradas`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ paradas: paradasTemporales }),
          }
        );
        if (!response.ok) throw new Error("No se pudo guardar el trazado");
        alert("¡Trazado de ruta guardado!");
        closeEditRutaMapaModal();
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // --- 9. ¡NUEVO! CRUD - HISTORIAL DE ALERTAS ---

  /**
   * Carga el historial de alertas desde la API
   */
  async function cargarAlertas() {
    const tablaBody = document.getElementById("tabla-alertas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="4">Cargando historial...</td></tr>';

    try {
      const response = await fetch("http://localhost:5000/api/notificaciones", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Error al cargar alertas.");
      }

      const alertas = await response.json();

      tablaBody.innerHTML = ""; // Limpiamos la tabla
      if (alertas.length === 0) {
        tablaBody.innerHTML =
          '<tr><td colspan="4">No hay alertas registradas.</td></tr>';
        return;
      }

      alertas.forEach((alerta) => {
        const row = document.createElement("tr");
        // Formateamos la fecha para que sea legible
        const fecha = new Date(alerta.createdAt).toLocaleString("es-MX", {
          dateStyle: "short",
          timeStyle: "short",
        });

        row.innerHTML = `
                    <td class="alert-row-danger">${
                      alerta.camionUnidad || "N/A"
                    }</td>
                    <td>${alerta.titulo}</td>
                    <td>${alerta.mensaje}</td>
                    <td>${fecha}</td>
                `;
        tablaBody.appendChild(row);
      });
    } catch (error) {
      console.error(error);
      tablaBody.innerHTML = `<tr><td colspan="4" class="text-danger">${error.message}</td></tr>`;
    }
  }

  // --- Cierre de Modales (General) ---
  window.onclick = function (event) {
    if (event.target == modalCamion) closeEditCamionModal();
    if (event.target == modalRuta) closeEditRutaModal();
    if (event.target == modalUser) closeEditUserModal();
    if (event.target == modalRutaMapa) closeEditRutaMapaModal();
  };
});
