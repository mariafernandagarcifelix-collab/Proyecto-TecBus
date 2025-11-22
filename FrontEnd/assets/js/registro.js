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
      messageEl.className = "text-danger mb-2"; // Resetea a color rojo
    }

    // 1. Validaciones del cliente (rápidas)
    if (!nombre || !correo || !contrasena) {
      if (messageEl)
        messageEl.textContent = "Todos los campos son obligatorios.";
      return;
    }
    if (!correo.endsWith("@guasave.tecnm.mx") && !correo.endsWith("@tec.com")) {
      // (Añadí @tec.com para tus pruebas)
      if (messageEl)
        messageEl.textContent =
          "Por favor, usa un correo institucional válido.";
      return;
    }

    // 2. Llamada al Backend (¡YA NO ES SIMULACIÓN!)
    submitButton.disabled = true;
    submitButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Registrando...';

    try {
      // Esta es la llamada a tu API real que corre en el puerto 5000
      const response = await fetch("http://localhost:5000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre,
          email: correo,
          password: contrasena,
        }),
      });

      const data = await response.json(); // Lee la respuesta del servidor

      if (!response.ok) {
        // Si el servidor nos dio un error (ej. "Correo ya existe"), lo mostramos
        throw new Error(data.message);
      }

      // 3. Éxito
      if (messageEl) {
        messageEl.textContent = `¡Registro exitoso! Serás redirigido...`;
        messageEl.className = "text-success mb-2"; // Cambia a color verde
      }

      // Redirige al login
      setTimeout(() => {
        window.location.href = "index.html";
      }, 2000);
    } catch (error) {
      // 4. Error (mostramos el mensaje del backend)
      if (messageEl) messageEl.textContent = error.message;
      submitButton.disabled = false;
      submitButton.innerHTML =
        '<i class="fas fa-check-circle me-2"></i> Continuar Registro';
    }
  });
});
