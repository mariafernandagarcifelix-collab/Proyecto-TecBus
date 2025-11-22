// backend/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  // 1. Revisa si el token está en el 'header' de la petición
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // 2. Obtiene el token (ej. "Bearer eyJhbGci...")
      token = req.headers.authorization.split(" ")[1];

      // 3. Verifica el token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "secreto_de_respaldo"
      );

      // 4. Obtiene el usuario del token y lo "adjunta" a la petición
      //    (sin la contraseña)
      req.user = await User.findById(decoded.id).select("-password");

      next(); // ¡Luz verde! Pasa a la siguiente función (la ruta)
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: "No autorizado, token falló" });
    }
  }

  if (!token) {
    res.status(401).json({ message: "No autorizado, no hay token" });
  }
};

// ¡NUEVO! Creamos un guardaespaldas específico para Admins
const adminOnly = (req, res, next) => {
  if (req.user && req.user.tipo === "administrador") {
    next(); // ¡Luz verde para el admin!
  } else {
    res
      .status(401)
      .json({ message: "Acceso denegado. Solo para administradores." });
  }
};

module.exports = { protect, adminOnly };
