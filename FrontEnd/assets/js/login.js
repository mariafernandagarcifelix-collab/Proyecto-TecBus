// frontend/assets/js/login.js

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const messageEl = document.getElementById("auth-message");
  const submitButton = loginForm.querySelector('button[type="submit"]');

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // Evita que la página se recargue

    const correo = document.getElementById("correo").value;
    const contrasena = document.getElementById("contrasena").value;

    if (messageEl) {
      messageEl.textContent = ""; // Limpia errores anteriores
    }

    // 2. Llamada al Backend
    submitButton.disabled = true;
    submitButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Ingresando...';

    try {
      const response = await fetch(BACKEND_URL + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: correo,
          password: contrasena,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Si la respuesta no es 200, muestra el error del backend
        throw new Error(data.message);
      }

      // 3. ¡ÉXITO! Guarda el token y los datos del usuario
      localStorage.setItem("tecbus_token", data.token);
      // Guardamos el usuario como texto JSON para usarlo después
      localStorage.setItem("tecbus_user", JSON.stringify(data.user));

      if (messageEl) {
        messageEl.textContent = "¡Éxito! Redirigiendo...";
        messageEl.className = "text-success mb-3"; // Color verde
      }

      // 4. Redirección por Rol (¡La parte más importante!)
      // Leemos el 'tipo' de usuario que nos devolvió el backend
      // (Esto se basa en tu diseño de DB: "estudiante", "conductor", "administrador")

      setTimeout(() => {
        switch (data.user.tipo) {
          case "estudiante":
            window.location.href = "estudiante.html";
            break;
          case "conductor":
            window.location.href = "conductor.html";
            break;
          case "administrador":
            window.location.href = "admin.html";
            break;
          default:
            window.location.href = "login.html"; // Fallback
        }
      }, 1000); // Pequeña espera para que el usuario vea el mensaje
    } catch (error) {
      // 4. Error (ej. "Credenciales incorrectas")
      if (messageEl) {
        messageEl.textContent = error.message;
      }
      submitButton.disabled = false;
      submitButton.innerHTML =
        '<i class="fas fa-sign-in-alt me-2"></i> Ingresar';
    }
  });
});
