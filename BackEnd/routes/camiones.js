// backend/routes/camiones.js

const express = require("express");
const router = express.Router();
const Camion = require("../models/Camion"); // Importamos el modelo
const { protect, adminOnly } = require("../middleware/authMiddleware"); // Importamos el guardaespaldas
const HistorialBusqueda = require("../models/HistorialBusqueda");
const Notificacion = require("../models/Notificacion");

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

// Función auxiliar para calcular distancia en metros (Haversine)
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radio de la tierra en km
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distancia en km
  return d * 1000; // Distancia en metros
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// --- RUTA ESPECIAL PARA ESP32 (MODIFICADA) ---
router.put("/update-location", async (req, res) => {
  try {
    const { busId, lat, lng, speed } = req.body;

    // 1. Actualizar Camión (Código original)
    const camion = await Camion.findOneAndUpdate(
      { numeroUnidad: busId },
      {
        ubicacionActual: { type: "Point", coordinates: [lng, lat] },
        velocidad: speed,
        ultimaActualizacion: new Date(),
      },
      { new: true }
    ).populate("rutaAsignada");

    if (!camion) return res.status(404).json({ message: "Camión no encontrado" });

    // 2. Emitir Socket (Código original)
    const io = req.app.get("io");
    if (io) {
      io.emit("locationUpdate", {
        camionId: camion._id,
        numeroUnidad: camion.numeroUnidad,
        location: { lat, lng },
        velocidad: speed
      });
    }

    // ============================================================
    // 3. ANÁLISIS PREDICTIVO E INTELIGENTE (LO NUEVO)
    // ============================================================
    
    if (camion.rutaAsignada) {
        const fecha = new Date();
        // Hora actual del servidor (aproximada a la del usuario)
        const horaActual = fecha.getHours(); 
        
        // A. Buscar patrones: Usuarios que han buscado esta ruta a esta hora > 4 veces
        // Buscamos en el historial coincidencias de ruta
        const historialRelevante = await HistorialBusqueda.aggregate([
            { $match: { ruta: camion.rutaAsignada._id } },
            // Filtrar por hora (lógica simple: misma hora del día)
            // Nota: Para producción se recomienda comparar rangos de tiempo más precisos
            { $addFields: { 
                horaNum: { $toInt: { $substr: ["$horaBusqueda", 0, 2] } } 
            }},
            { $match: { horaNum: horaActual } }, // Solo búsquedas hechas en esta hora (ej: las 14:00)
            { $group: {
                _id: "$usuario",
                totalBusquedas: { $sum: 1 },
                ultimoOrigen: { $last: "$ubicacionOrigen" } // Tomamos la última ubicación conocida
            }},
            { $match: { totalBusquedas: { $gte: 4 } } } // REGLA: Más de 4 veces
        ]);

        // B. Verificar Distancia y Notificar
        for (const patron of historialRelevante) {
            const userOrigen = patron.ultimoOrigen;
            
            if (userOrigen && userOrigen.lat && userOrigen.lng) {
                const distancia = getDistanceFromLatLonInM(lat, lng, userOrigen.lat, userOrigen.lng);
                
                // REGLA: Si está a menos de 200 metros
                if (distancia <= 200) {
                    console.log(`✨ PREDICCIÓN: Camión cerca de usuario ${patron._id} (${Math.round(distancia)}m)`);
                    
                    // Aquí disparas la notificación PUSH real
                    // sendNotificationToUser(patron._id, "¡Tu ruta habitual está llegando!");
                    
                    // Guardamos notificación en DB para historial
                    await Notificacion.create({
                        usuario: patron._id,
                        mensaje: `El camión de la ruta ${camion.rutaAsignada.nombre} está a ${Math.round(distancia)}m.`,
                        leida: false
                    });
                    
                    // Emitir alerta socket personal (si está conectado)
                    if(io) io.to(patron._id.toString()).emit("smartAlert", {
                        mensaje: `🚍 Tu ruta habitual (${camion.rutaAsignada.nombre}) está llegando.`
                    });
                }
            }
        }
    }

    res.status(200).send("Ubicacion actualizada y analisis completado");

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ message: "Error interno" });
  }
});

module.exports = router;
