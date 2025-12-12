// frontend/assets/js/registro.js

document.addEventListener("DOMContentLoaded", () => {
  const registroForm = document.getElementById("registro-form");
  const messageEl = document.getElementById("auth-message");
  const submitButton = registroForm.querySelector('button[type="submit"]');

  registroForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nombre = document.getElementById("nombre").value;
    const correo = document.getElementById("correo").value;
    const contrasena = document.getElementById("contrasena").value;

    if (messageEl) {
      messageEl.textContent = "";
      messageEl.className = "text-danger mb-2";
    }

    if (!nombre || !correo || !contrasena) {
      if (messageEl)
        messageEl.textContent = "Todos los campos son obligatorios.";
      return;
    }
    if (!correo.endsWith("@guasave.tecnm.mx") && !correo.endsWith("@tec.com")) {
      if (messageEl)
        messageEl.textContent =
          "Por favor, usa un correo institucional válido.";
      return;
    }

    submitButton.disabled = true;
    submitButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Registrando...';

    try {
      // CAMBIO: Usamos BACKEND_URL dinámico
      const response = await fetch(BACKEND_URL + "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre,
          email: correo,
          password: contrasena,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message);
      }

      if (messageEl) {
        messageEl.textContent = `¡Registro exitoso! Serás redirigido...`;
        messageEl.className = "text-success mb-2";
      }

      setTimeout(() => {
        window.location.href = "login.html";
      }, 2000);
    } catch (error) {
      if (messageEl) messageEl.textContent = error.message;
      submitButton.disabled = false;
      submitButton.innerHTML =
        '<i class="fas fa-check-circle me-2"></i> Continuar Registro';
    }
  });
});