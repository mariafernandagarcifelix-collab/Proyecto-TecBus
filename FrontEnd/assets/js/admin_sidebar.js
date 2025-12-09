// frontend/assets/js/admin_sidebar.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("🎨 Inicializando interfaz del Administrador...");

  // --- 1. REFERENCIAS DOM ---
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menu-toggle");
  const backdrop = document.getElementById("backdrop");
  const navLinks = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".dashboard-section");
  const pageTitle = document.getElementById("page-title");
  const currentDateEl = document.getElementById("current-date");

  // --- 2. FECHA ACTUAL ---
  try {
    if (currentDateEl) {
      currentDateEl.textContent = new Date().toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  } catch (e) {
    console.error("Error formateando fecha.");
  }

  // --- 3. TOGGLE SIDEBAR (ABRIR/CERRAR) ---
  const toggleSidebar = () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("open");
  };

  if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);
  if (backdrop) backdrop.addEventListener("click", toggleSidebar);

  // --- 4. NAVEGACIÓN ENTRE PESTAÑAS (VISUAL) ---
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      // Si es el botón de cerrar sesión, manejamos la lógica básica aquí o dejamos que pase
      if (link.textContent.includes("Cerrar Sesión") || link.getAttribute("href") === "#logout") {
         return; // Dejamos que el evento específico de logout lo maneje si es necesario, o lo hacemos aquí.
      }

      e.preventDefault();
      const targetId = link.getAttribute("href");

      // Validar si es un enlace de navegación interna (#)
      if (!targetId || !targetId.startsWith("#")) return;

      // A. Actualizar clases 'active' en el menú
      navLinks.forEach((nav) => nav.classList.remove("active"));
      link.classList.add("active");

      // B. Mostrar la sección correspondiente y ocultar las demás
      sections.forEach((sec) => sec.classList.remove("active"));
      const targetSection = document.querySelector(targetId);
      if (targetSection) {
        targetSection.classList.add("active");
      }

      // C. Actualizar el título de la página
      if (pageTitle) pageTitle.textContent = link.textContent.trim();

      // D. Cerrar menú automáticamente en móviles
      if (window.innerWidth <= 992 && sidebar.classList.contains("open")) {
        toggleSidebar();
      }
    });
  });

  // --- 5. LOGOUT (ESTÁTICO) ---
  // Esto permite cerrar sesión incluso si el backend falla
  const btnLogout = Array.from(navLinks).find(l => l.textContent.includes("Cerrar Sesión"));
  if(btnLogout) {
      btnLogout.addEventListener("click", (e) => {
          e.preventDefault();
          if (confirm("¿Estás seguro de que quieres cerrar sesión?")) {
            localStorage.removeItem("tecbus_token");
            localStorage.removeItem("tecbus_user");
            window.location.href = "index.html";
          }
      });
  }
});