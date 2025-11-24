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

// --- RUTA ESPECIAL PARA ESP32 (HARDWARE) ---
// PUT /api/camiones/update-location
// Protegida: NO (para que el ESP32 pueda entrar sin login)
router.put("/update-location", async (req, res) => {
  try {
    // 1. Obtenemos los datos que manda el ESP32
    // Nota: El ESP32 manda "busId", "lat", "lng", "speed"
    const { busId, lat, lng, speed } = req.body;

    console.log(`📡 Datos recibidos del ESP32 -> ID: ${busId}, Lat: ${lat}, Lng: ${lng}`);

    // 2. Buscamos el camión por su 'numeroUnidad' (ej: 'TEC-01')
    // Usamos findOneAndUpdate para actualizarlo atómicamente
    const camion = await Camion.findOneAndUpdate(
      { numeroUnidad: busId }, // Buscamos por el nombre "TEC-01"
      {
        ubicacionActual: {
          type: "Point",
          coordinates: [lng, lat], // GeoJSON pide [longitud, latitud]
        },
        velocidad: speed,
        ultimaActualizacion: new Date(),
      },
      { new: true } // Para que nos devuelva el camión ya actualizado
    );

    if (!camion) {
      console.log("⚠️ Camión no encontrado en la DB");
      return res.status(404).json({ message: "Camión no encontrado con ese ID" });
    }

    // 3. ¡MAGIA DE REAL-TIME! Emitimos el evento a los mapas web
    // Recuperamos el objeto 'io' que guardamos en server.js
    const io = req.app.get("io");
    
    if (io) {
      io.emit("locationUpdate", {
        camionId: camion._id,       // ID de Mongo
        numeroUnidad: camion.numeroUnidad, // ID Humano (TEC-01)
        location: { lat, lng },      // Coordenadas para Leaflet
        velocidad: speed
      });
      console.log("✅ Ubicación emitida vía Socket.IO");
    }

    res.status(200).send("Ubicacion actualizada");

  } catch (error) {
    console.error("❌ Error actualizando ubicación:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

module.exports = router;
