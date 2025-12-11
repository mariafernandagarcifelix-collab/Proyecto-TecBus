// backend/routes/camiones.js

const express = require("express");
const router = express.Router();
const Camion = require("../models/Camion");
const Horario = require('../models/Horario');
const User = require('../models/User');
const { protect, adminOnly } = require("../middleware/authMiddleware");
const HistorialBusqueda = require("../models/HistorialBusqueda");
const Notificacion = require("../models/Notificacion");
const UbicacionEnVivo = require("../models/UbicacionEnVivo");
const HistorialUbicacion = require("../models/HistorialUbicacion");
const EstadisticaDiaria = require("../models/EstadisticaDiaria");

// ==================================================================
//  RUTA ESPECIAL ESP32 — DEBE IR PRIMERO
// ==================================================================
router.put("/update-location", async (req, res) => {
  try {
    const { busId, lat, lng, speed } = req.body;
    const ahora = new Date();

    // 1. Validación básica
    if (!busId || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: "Datos GPS incompletos" });
    }

    // 2. OBTENER UBICACIÓN ANTERIOR (Para calcular distancia recorrida)
    // Antes de sobrescribir, necesitamos saber dónde estaba hace 10 segundos.
    const ubicacionAnterior = await UbicacionEnVivo.findOne({ numeroUnidad: busId });
    
    let distanciaRecorrida = 0;
    
    if (ubicacionAnterior && ubicacionAnterior.ubicacion) {
        const coordsAnt = ubicacionAnterior.ubicacion.coordinates; // [lng, lat]
        // OJO: Mongo guarda [lng, lat], mi función usa (lat1, lon1, lat2, lon2)
        distanciaRecorrida = getDistanceFromLatLonInM(
            coordsAnt[1], coordsAnt[0], // Lat, Lng anteriores
            lat, lng                    // Lat, Lng actuales
        );

        // Filtro anti-ruido GPS: Si se movió más de 500m en segundos (teletransportación), ignorar distancia
        // O si se movió menos de 3 metros (ruido estático), ignorar.
        if (distanciaRecorrida > 1000 || distanciaRecorrida < 3) {
            distanciaRecorrida = 0;
        }
    }

    // 3. ACTUALIZAR "DATOS CALIENTES" (Live)
    // Esto es lo que ve el mapa en tiempo real
    const liveUpdate = await UbicacionEnVivo.findOneAndUpdate(
      { numeroUnidad: busId },
      {
        $set: {
            ubicacion: { type: "Point", coordinates: [lng, lat] },
            velocidad: speed,
            ultimaActualizacion: ahora,
            numeroUnidad: busId,
            // Podrías agregar aquí el estado si lo tuvieras (ej. "En Ruta")
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 4. GUARDAR HISTORIAL (Datos Fríos)
    // Esto se guarda para siempre (o hasta que el TTL lo borre)
    HistorialUbicacion.create({
        camionId: liveUpdate.camionId, // ID autogenerado si era nuevo
        numeroUnidad: busId,
        ubicacion: { type: "Point", coordinates: [lng, lat] },
        velocidad: speed,
        timestamp: ahora
    }).catch(err => console.error("⚠️ Error guardando historial:", err.message));

    // 5. ACTUALIZAR ESTADÍSTICAS DIARIAS (Optimizado)
    // Generamos la clave del día: "102_2023-10-27" (Zona Horaria Local aprox)
    // Ajusta el offset de horas si tu servidor está en UTC y tú en México (-6h o -7h)
    const fechaLocal = new Date(ahora.getTime() - (7 * 60 * 60 * 1000)); 
    const fechaString = fechaLocal.toISOString().split('T')[0]; // "YYYY-MM-DD"
    const claveStats = `${busId}_${fechaString}`;

    await EstadisticaDiaria.updateOne(
        { claveDiaria: claveStats },
        {
            $setOnInsert: { 
                numeroUnidad: busId,
                fecha: new Date(fechaString) 
            },
            $inc: { 
                distanciaTotal: distanciaRecorrida, // Sumamos lo que recorrió desde el último punto
                totalPuntosReportados: 1 
            },
            $max: { 
                velocidadMaxima: speed // Solo actualiza si la nueva velocidad es mayor a la guardada
            },
            $set: { ultimaActualizacion: ahora }
        },
        { upsert: true }
    ).catch(err => console.error("⚠️ Error guardando stats:", err.message));

    // 6. ENVIAR SOCKET (Para el Frontend)
    const io = req.app.get("io");
    if (io) {
      io.emit("locationUpdate", {
        camionId: liveUpdate.camionId, // Útil para tu frontend
        numeroUnidad: busId,
        location: { lat, lng },
        velocidad: speed,
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
//  RUTA INTELIGENTE: ASIGNACIÓN DINÁMICA POR HORARIO
// ==================================================================
router.get('/mi-unidad', protect, async (req, res) => {
    try {
        const idConductor = req.user._id; // Obtenemos ID del token (middleware protect)

        // 1. Obtener Día y Hora Actual
        const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const fechaActual = new Date();
        // Ajuste horario manual si tu servidor no está en la zona horaria correcta (opcional)
        // fechaActual.setHours(fechaActual.getHours() - 7); 
        
        const diaActual = dias[fechaActual.getDay()];
        const minutosActuales = fechaActual.getHours() * 60 + fechaActual.getMinutes();

        console.log(`🔎 Buscando unidad para conductor ${idConductor} en día ${diaActual} a las ${fechaActual.getHours()}:${fechaActual.getMinutes()}`);

        // 2. Buscar Horarios que coincidan con el día y contengan al conductor
        // Nota: Buscamos en 'diaSemana' (puede ser "Lunes" o "lunes") y dentro del array 'salidas'
        const horarios = await Horario.find({
            $or: [{ diaSemana: diaActual }, { diaSemana: diaActual.toLowerCase() }],
            "salidas.conductorAsignado": idConductor
        }).populate({
            path: 'salidas.camionAsignado',
            model: 'Camion'
        });

        if (!horarios || horarios.length === 0) {
            return res.status(404).json({ mensaje: "No tienes recorridos programados para hoy." });
        }

        // 3. Filtrar la salida más relevante (La que está ocurriendo o va a ocurrir pronto)
        let camionEncontrado = null;
        let rutaEncontrada = null;

        // Aplanamos todas las salidas del conductor para hoy
        let misSalidasHoy = [];
        horarios.forEach(h => {
            h.salidas.forEach(salida => {
                if (salida.conductorAsignado.toString() === idConductor.toString()) {
                    misSalidasHoy.push({
                        ...salida.toObject(),
                        rutaId: h.ruta
                    });
                }
            });
        });

        // Buscamos la salida activa (Margen: desde 1 hora antes hasta 3 horas despues de la hora de salida)
        for (const salida of misSalidasHoy) {
            const [h, m] = salida.hora.split(':');
            const minutosSalida = parseInt(h) * 60 + parseInt(m);

            // RANGO: Si es desde 60 min antes hasta 180 min (3 horas) después del inicio
            // Ejemplo: Salida 7:00am (420 min). Válido desde 6:00am (360) hasta 10:00am (600)
            if (minutosActuales >= (minutosSalida - 60) && minutosActuales <= (minutosSalida + 180)) {
                if (salida.camionAsignado) {
                    camionEncontrado = salida.camionAsignado;
                    // Rompemos el ciclo al encontrar la primera coincidencia válida actual
                    break;
                }
            }
        }

        // 4. Si encontramos camión, devolvemos formato esperado por el frontend
        if (camionEncontrado) {
            return res.json({
                camionId: camionEncontrado._id,
                numeroUnidad: camionEncontrado.numeroUnidad,
                placa: camionEncontrado.placa,
                ubicacionActual: camionEncontrado.ubicacionActual,
                velocidad: camionEncontrado.velocidad,
                estado: "Asignado por Horario"
            });
        } else {
            // Si tiene horarios hoy pero no es la hora todavía
            return res.status(404).json({ mensaje: "Tienes viajes hoy, pero no en este horario." });
        }

    } catch (error) {
        console.error("❌ Error buscando unidad dinámica:", error);
        res.status(500).json({ mensaje: "Error al buscar la unidad del conductor" });
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

// --- RUTA NUEVA: Obtener un camión por su ID ---
// GET /api/camiones/:id
router.get("/:id", protect, async (req, res) => {
  try {
    // 1. Buscamos el camión en MongoDB por su ID único
    const camion = await Camion.findById(req.params.id);

    if (!camion) {
      return res.status(404).json({ message: "Camión no encontrado en la BD" });
    }

    // 2. Devolvemos el objeto completo (incluyendo coordenadas guardadas)
    res.json(camion);
    
  } catch (error) {
    console.error("Error al obtener camión individual:", error);
    res.status(500).json({ message: "Error en el servidor al consultar camión" });
  }
});

router.get("/estadisticas/hoy", protect, adminOnly, async (req, res) => {
    try {
        // 1. Calcular la fecha de hoy (sin hora) para buscar en la BD
        const hoy = new Date();
        // Ajuste manual de zona horaria si es necesario (ej. -7 horas para México)
        const fechaLocal = new Date(hoy.getTime() - (7 * 60 * 60 * 1000));
        const fechaString = fechaLocal.toISOString().split('T')[0]; // "2023-10-27"
        const inicioDia = new Date(fechaString);

        // 2. Buscar las estadísticas de HOY
        const stats = await EstadisticaDiaria.find({ 
            fecha: inicioDia 
        }).sort({ distanciaTotal: -1 }); // Ordenar: el que más recorrió primero

        // 3. Calcular Totales Generales (KPIs)
        let totalKmFlota = 0;
        let maxVelocidadFlota = 0;
        let unidadMasVeloz = "N/A";

        stats.forEach(s => {
            totalKmFlota += s.distanciaTotal;
            if (s.velocidadMaxima > maxVelocidadFlota) {
                maxVelocidadFlota = s.velocidadMaxima;
                unidadMasVeloz = s.numeroUnidad;
            }
        });

        // 4. Enviar respuesta preparada para el Frontend
        res.json({
            resumen: {
                totalKm: (totalKmFlota / 1000).toFixed(2), // Convertir a KM
                topVelocidad: `${maxVelocidadFlota} km/h (Unidad ${unidadMasVeloz})`,
                totalUnidadesActivas: stats.length
            },
            detalles: stats.map(s => ({
                unidad: s.numeroUnidad,
                km: (s.distanciaTotal / 1000).toFixed(2),
                velMax: s.velocidadMaxima,
                actualizado: s.ultimaActualizacion.toLocaleTimeString()
            }))
        });

    } catch (error) {
        console.error("Error obteniendo estadísticas:", error);
        res.status(500).json({ message: "Error al cargar reporte" });
    }
});

module.exports = router;
