// backend/routes/users.js

const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const estudianteSchema = new mongoose.Schema({
    matricula: { type: String },
    carrera: { type: String },
    rutaPreferida: { type: String },
    // ¡NUEVO! Guardamos la "dirección" para las notificaciones push
    pushSubscription: { type: Object } 
});

// --- RUTA 1: Obtener TODOS los usuarios (para la tabla del admin) ---
// GET /api/users
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}).select("-password"); // Trae todos menos el password
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Registrar un NUEVO usuario (desde el panel de admin) ---
// POST /api/users
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { nombre, email, password, tipo, licencia, matricula, carrera } =
      req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      nombre,
      email,
      password: hashedPassword,
      tipo,
    });

    // Añade el sub-documento correcto basado en el tipo
    if (tipo === "estudiante") {
      newUser.estudiante = { matricula, carrera };
    } else if (tipo === "conductor") {
      newUser.conductor = { licencia }; // El camión se asigna después
    }

    const savedUser = await newUser.save();
    res.status(201).json(savedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 3: Actualizar un USUARIO (¡La más importante!) ---
// PUT /api/users/:id
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const {
      nombre,
      email,
      tipo,
      estado,
      licencia,
      matricula,
      vehiculoAsignado,
    } = req.body;

    // Actualiza campos comunes
    user.nombre = nombre || user.nombre;
    user.email = email || user.email;
    user.tipo = tipo || user.tipo;
    user.estado = estado || user.estado;

    // Lógica de roles (esto borra los datos viejos si cambia de rol)
    if (tipo === "conductor") {
      user.estudiante = undefined; // Borra datos de estudiante
      user.conductor = {
        licencia: licencia || user.conductor?.licencia,
        // ¡AQUÍ ESTÁ LA MAGIA! Asigna el camión
        vehiculoAsignado: vehiculoAsignado || user.conductor?.vehiculoAsignado,
      };
    } else if (tipo === "estudiante") {
      user.conductor = undefined; // Borra datos de conductor
      user.estudiante = {
        matricula: matricula || user.estudiante?.matricula,
        carrera: req.body.carrera || user.estudiante?.carrera,
      };
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 4: Obtener TODOS los conductores (La que ya teníamos) ---
router.get("/conductores", protect, adminOnly, async (req, res) => {
  try {
    const conductores = await User.find({ tipo: "conductor" }).select("nombre");
    res.json(conductores);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 5: Obtener el camión del conductor logueado (La que ya teníamos) ---
router.get("/mi-camion", protect, async (req, res) => {
  try {
    if (req.user.tipo !== "conductor") {
      return res.status(403).json({ message: "No eres un conductor" });
    }

    // ¡Importante! Revisamos que 'conductor' exista antes de leerlo
    if (!req.user.conductor) {
      return res
        .status(404)
        .json({ message: "Tu perfil de conductor no está completo." });
    }

    const camionId = req.user.conductor.vehiculoAsignado;
    if (!camionId) {
      return res.status(404).json({ message: "No tienes un camión asignado." });
    }

    res.json({ camionId: camionId });
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA: Eliminar Usuario ---
// DELETE /api/users/:id
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Evitar que el admin se borre a sí mismo por error
    if (req.user._id.equals(user._id)) {
        return res.status(400).json({ message: "No puedes eliminar tu propia cuenta de administrador" });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Usuario eliminado correctamente" });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar el usuario" });
  }
});

module.exports = router;
