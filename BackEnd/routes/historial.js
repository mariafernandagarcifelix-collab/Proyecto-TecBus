const express = require("express");
const router = express.Router();
const HistorialBusqueda = require("../models/HistorialBusqueda");
const { protect } = require("../middleware/authMiddleware");

// GUARDAR BÚSQUEDA (Se llama automáticamente desde el mapa)
router.post("/", protect, async (req, res) => {
  try {
    const { rutaId, location } = req.body;
    const fecha = new Date();
    // Formato HH:MM
    const horaActual = fecha.getHours().toString().padStart(2, '0') + ":" + fecha.getMinutes().toString().padStart(2, '0');

    await HistorialBusqueda.create({
      usuario: req.user._id,
      ruta: rutaId,
      ubicacionOrigen: location, // { lat, lng }
      horaBusqueda: horaActual
    });
    res.status(201).json({ message: "Búsqueda registrada para análisis" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error registrando historial" });
  }
});

// OBTENER HISTORIAL (Para el Modal)
router.get("/", protect, async (req, res) => {
  try {
    const historial = await HistorialBusqueda.find({ usuario: req.user._id })
      .populate("ruta", "nombre descripcion")
      .sort({ createdAt: -1 })
      .limit(20); // Traer los últimos 20
    res.json(historial);
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo historial" });
  }
});

module.exports = router;