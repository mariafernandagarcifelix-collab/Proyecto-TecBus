// backend/routes/camiones.js

const express = require("express");
const router = express.Router();
const Camion = require("../models/Camion");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const HistorialBusqueda = require("../models/HistorialBusqueda");
const Notificacion = require("../models/Notificacion");

// ==================================================================
//  RUTA ESPECIAL ESP32 — DEBE IR PRIMERO
// ==================================================================
router.put("/update-location", async (req, res) => {
  try {
    const { busId, lat, lng, speed } = req.body;

    // 1. GUARDAR EN BD PRIMERO
    const camion = await Camion.findOneAndUpdate(
      { numeroUnidad: busId },
      {
        ubicacionActual: { type: "Point", coordinates: [lng, lat] }, // Mongo usa [Longitud, Latitud]
        velocidad: speed,
        ultimaActualizacion: new Date(),
        estado: "activo",
      },
      { new: true } // Esto es vital: nos devuelve el dato YA GUARDADO
    ).populate("rutaAsignada");

    if (!camion) {
      return res.status(404).json({ message: "Camión no encontrado" });
    }

    // 2. EXTRAER DATOS REALES DE LA BD
    // Si la BD guardó algo diferente o redondeó, esto es lo que veremos.
    const coordenadasReales = camion.ubicacionActual.coordinates;
    const latitudBD = coordenadasReales[1]; // En GeoJSON el índice 1 es latitud
    const longitudBD = coordenadasReales[0]; // En GeoJSON el índice 0 es longitud

    // 3. ENVIAR AL MAPA (Usando datos de BD)
    const io = req.app.get("io");
    if (io) {
      io.emit("locationUpdate", {
        camionId: camion._id,
        numeroUnidad: camion.numeroUnidad,
        location: { 
            lat: latitudBD, 
            lng: longitudBD 
        },
        velocidad: camion.velocidad, // Usamos la velocidad guardada
      });
    }

    // ============================================================
    // 3. ANÁLISIS PREDICTIVO — TODA LA FUNCIÓN ORIGINAL CONSERVADA
    // ============================================================
    if (camion.rutaAsignada) {
      const fecha = new Date();
      const horaActual = fecha.getHours();

      const historialRelevante = await HistorialBusqueda.aggregate([
        { $match: { ruta: camion.rutaAsignada._id } },
        {
          $addFields: {
            horaNum: { $toInt: { $substr: ["$horaBusqueda", 0, 2] } },
          },
        },
        { $match: { horaNum: horaActual } },
        {
          $group: {
            _id: "$usuario",
            totalBusquedas: { $sum: 1 },
            ultimoOrigen: { $last: "$ubicacionOrigen" },
          },
        },
        { $match: { totalBusquedas: { $gte: 4 } } },
      ]);

      for (const patron of historialRelevante) {
        const userOrigen = patron.ultimoOrigen;

        if (userOrigen && userOrigen.lat && userOrigen.lng) {
          const distancia = getDistanceFromLatLonInM(
            lat,
            lng,
            userOrigen.lat,
            userOrigen.lng
          );

          if (distancia <= 200) {
            console.log(
              `✨ PREDICCIÓN: Camión cerca de usuario ${
                patron._id
              } (${Math.round(distancia)}m)`
            );

            await Notificacion.create({
              usuario: patron._id,
              mensaje: `El camión de la ruta ${
                camion.rutaAsignada.nombre
              } está a ${Math.round(distancia)}m.`,
              leida: false,
            });

            if (io)
              io.to(patron._id.toString()).emit("smartAlert", {
                mensaje: `🚍 Tu ruta habitual (${camion.rutaAsignada.nombre}) está llegando.`,
              });
          }
        }
      }
    }

    res.status(200).send("Ubicacion actualizada y analisis completado");
  } catch (error) {
    console.error("❌ Error actualizando ubicación:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// ==================================================================
//  RUTAS GENERALES (CRUD)
// ==================================================================

// --- Obtener todos los camiones ---
router.get("/", protect, async (req, res) => {
  try {
    const camiones = await Camion.find().populate("rutaAsignada", "nombre");
    res.json(camiones);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Crear nuevo camión ---
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { numeroUnidad, placa, modelo, año, capacidad } = req.body;

    const camionExists = await Camion.findOne({ placa });
    if (camionExists)
      return res.status(400).json({ message: "La placa ya está registrada" });

    const camion = new Camion({
      numeroUnidad,
      placa,
      modelo,
      año,
      capacidad,
      estado: "activo",
    });

    const nuevoCamion = await camion.save();
    res.status(201).json(nuevoCamion);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Actualizar camión ---
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);

    if (camion) {
      camion.numeroUnidad = req.body.numeroUnidad || camion.numeroUnidad;
      camion.placa = req.body.placa || camion.placa;
      camion.modelo = req.body.modelo || camion.modelo;
      camion.estado = req.body.estado || camion.estado;
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

// --- Eliminar camión ---
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);

    if (camion) {
      await camion.deleteOne();
      res.json({ message: "Camión eliminado" });
    } else {
      res.status(404).json({ message: "Camión no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// ==================================================================
//  Funciones auxiliares
// ==================================================================
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = router;
