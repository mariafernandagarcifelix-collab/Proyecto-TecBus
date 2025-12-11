// backend/routes/users.js

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Camion = require("../models/Camion");
const Horario = require("../models/Horario");
const bcrypt = require("bcryptjs");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const estudianteSchema = new mongoose.Schema({
  matricula: { type: String },
  carrera: { type: String },
  rutaPreferida: { type: String },
  // ¡NUEVO! Guardamos la "dirección" para las notificaciones push
  pushSubscription: { type: Object },
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

router.get("/mi-camion", protect, async (req, res) => {
  try {
    // 1. Primero buscamos si tiene asignación fija en su perfil
    const user = await User.findById(req.user._id).populate("conductor.vehiculoAsignado");

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    let camion = user.conductor ? user.conductor.vehiculoAsignado : null;

    // 2. Si NO tiene camión fijo, buscamos en los horarios de HOY
    if (!camion) {
        console.log(`[DEBUG] Conductor ${user.nombre} sin vehículo fijo. Buscando en horarios...`);
        
        // Calcular día de la semana en español
        const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
        const hoy = dias[new Date().getDay()];

        // Buscar un horario donde este usuario sea el conductor hoy
        const horarioHoy = await Horario.findOne({
            conductorAsignado: user._id,
            $or: [
                { diaSemana: hoy }, 
                { diaSemana: "Diario" },
                { diaSemana: "Lunes-Viernes" } // (Simplificado, idealmente validar si es L-V)
            ]
        }).populate("camionAsignado");

        if (horarioHoy && horarioHoy.camionAsignado) {
            camion = horarioHoy.camionAsignado;
            console.log(`[DEBUG] ¡Camión encontrado por horario! Unidad: ${camion.numeroUnidad}`);
        }
    }

    // 3. Respuesta Final
    if (!camion || !camion.numeroUnidad) {
       // Si de plano no tiene ni fijo ni horario
       return res.json({
         camionId: null,
         placa: "",
         numeroUnidad: ""
       });
    }

    // ¡ÉXITO! Devolvemos los datos del camión encontrado
    res.json({
      camionId: camion._id,
      placa: camion.placa,
      numeroUnidad: camion.numeroUnidad,
      ubicacionActual: camion.ubicacionActual
    });

  } catch (error) {
    console.error("Error al buscar camión:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// --- RUTA 3: Actualizar un USUARIO (¡La más importante!) ---
// PUT /api/users/:id
router.put("/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (req.user.tipo !== 'administrador' && req.user._id.toString() !== req.params.id) {
        return res.status(401).json({ message: "No autorizado para editar este usuario" });
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
      return res
        .status(400)
        .json({
          message: "No puedes eliminar tu propia cuenta de administrador",
        });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar el usuario" });
  }
});

module.exports = router;
