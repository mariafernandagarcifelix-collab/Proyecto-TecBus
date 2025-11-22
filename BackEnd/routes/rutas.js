// backend/routes/rutas.js

const express = require("express");
const router = express.Router();
const Ruta = require("../models/Ruta"); // Importamos el modelo de Ruta
const { protect, adminOnly } = require("../middleware/authMiddleware"); // Reusamos el guardaespaldas

// --- RUTA 1: Obtener TODAS las rutas ---
// GET /api/rutas
router.get("/", protect, async (req, res) => {
  try {
    const rutas = await Ruta.find(); // Busca todas las rutas
    res.json(rutas);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Crear una NUEVA ruta ---
// POST /api/rutas
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    // Por ahora, solo creamos la ruta con nombre y descripción.
    // Las paradas se añadirán después con una UI más compleja.
    const { nombre, descripcion } = req.body;

    const rutaExists = await Ruta.findOne({ nombre });
    if (rutaExists) {
      return res
        .status(400)
        .json({ message: "El nombre de esta ruta ya existe" });
    }

    const ruta = new Ruta({
      nombre,
      descripcion,
      paradas: [], // Dejamos las paradas vacías por ahora
      activa: true,
    });

    const nuevaRuta = await ruta.save();
    res.status(201).json(nuevaRuta);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 3: Actualizar una ruta ---
// PUT /api/rutas/:id
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const ruta = await Ruta.findById(req.params.id);

    if (ruta) {
      ruta.nombre = req.body.nombre || ruta.nombre;
      ruta.descripcion = req.body.descripcion || ruta.descripcion;
      ruta.activa =
        req.body.activa !== undefined ? req.body.activa : ruta.activa;

      const rutaActualizada = await ruta.save();
      res.json(rutaActualizada);
    } else {
      res.status(404).json({ message: "Ruta no encontrada" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 4: Borrar una ruta ---
// DELETE /api/rutas/:id
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const ruta = await Ruta.findById(req.params.id);

    if (ruta) {
      await ruta.deleteOne();
      res.json({ message: "Ruta eliminada" });
    } else {
      res.status(404).json({ message: "Ruta no encontrada" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});
// --- RUTA 5: OBTENER las paradas de UNA ruta (para el estudiante) ---
// GET /api/rutas/:id
router.get("/:id", protect, async (req, res) => {
  try {
    // Busca la ruta por su ID y solo selecciona el campo 'paradas'
    const ruta = await Ruta.findById(req.params.id).select("paradas nombre");

    if (!ruta) {
      return res.status(404).json({ message: "Ruta no encontrada" });
    }
    res.json(ruta);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 6: ACTUALIZAR las paradas de UNA ruta (para el admin) ---
// PUT /api/rutas/:id/paradas
router.put("/:id/paradas", protect, adminOnly, async (req, res) => {
  try {
    const { paradas } = req.body; // Recibimos el array de paradas

    const ruta = await Ruta.findById(req.params.id);
    if (!ruta) {
      return res.status(404).json({ message: "Ruta no encontrada" });
    }

    // Actualizamos el campo 'paradas' como lo diseñaste en tu PDF
    ruta.paradas = paradas;

    const rutaActualizada = await ruta.save();
    res.json(rutaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});
module.exports = router;
