// backend/routes/camiones.js

const express = require("express");
const router = express.Router();
const Camion = require("../models/Camion"); // Importamos el modelo
const { protect, adminOnly } = require("../middleware/authMiddleware"); // Importamos el guardaespaldas

// --- RUTA 1: Obtener TODOS los camiones (para la tabla del admin) ---
// GET /api/camiones
// Protegida: Sí. Solo usuarios logueados (para empezar).
router.get("/", protect, async (req, res) => {
  try {
    // Busca todos los camiones en la DB
    const camiones = await Camion.find().populate("rutaAsignada", "nombre");
    // Esto le dice a Mongoose: "Trae los camiones Y de su campo 'rutaAsignada',
    // trae solo el campo 'nombre' del documento de la ruta"
    res.json(camiones);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Crear un NUEVO camión (para el formulario del admin) ---
// POST /api/camiones
// Protegida: Sí. ¡Y solo para administradores!
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { numeroUnidad, placa, modelo, año, capacidad } = req.body;

    // 1. Verificamos si la placa ya existe
    const camionExists = await Camion.findOne({ placa });
    if (camionExists) {
      return res.status(400).json({ message: "La placa ya está registrada" });
    }

    // 2. Creamos el nuevo camión
    const camion = new Camion({
      numeroUnidad,
      placa,
      modelo,
      año,
      capacidad,
      estado: "activo",
    });

    // 3. Guardamos en la DB
    const nuevoCamion = await camion.save();
    res.status(201).json(nuevoCamion); // 201 = "Creado"
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 3: Actualizar un camión ---
// PUT /api/camiones/:id
// Protegida: Sí. Solo Admins.
// ... (dentro de backend/routes/camiones.js)

// --- RUTA 3: Actualizar un camión ---
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);

    if (camion) {
      // Actualiza los campos que vengan en el body
      camion.numeroUnidad = req.body.numeroUnidad || camion.numeroUnidad;
      camion.placa = req.body.placa || camion.placa;
      camion.modelo = req.body.modelo || camion.modelo;
      camion.estado = req.body.estado || camion.estado;

      // --- ¡LÍNEA NUEVA! ---
      // Acepta el ID de la ruta. Si viene vacío, lo pone como null.
      camion.rutaAsignada = req.body.rutaAsignada || null;

      const camionActualizado = await camion.save();
      res.json(camionActualizado);
    } else {
      res.status(404).json({ message: "Camión no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 4: Borrar un camión ---
// DELETE /api/camiones/:id
// Protegida: Sí. Solo Admins.
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);

    if (camion) {
      await camion.deleteOne(); // Mongoose 6+ usa deleteOne()
      res.json({ message: "Camión eliminado" });
    } else {
      res.status(404).json({ message: "Camión no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

module.exports = router;
