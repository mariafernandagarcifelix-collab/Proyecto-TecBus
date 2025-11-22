// backend/routes/horarios.js

const express = require("express");
const router = express.Router();
const Horario = require("../models/Horario"); // Importamos el modelo
const { protect, adminOnly } = require("../middleware/authMiddleware");
const mongoose = require("mongoose"); // Necesario para $lookup

// --- RUTA 1: Obtener TODOS los horarios (¡La consulta inteligente!) ---
// GET /api/horarios
// (Basado en tu "Consulta 1: Reporte Administrativo")
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const horarios = await Horario.aggregate([
      {
        // Paso 1: "Desenrollar" el arreglo de salidas
        $unwind: "$salidas",
      },
      {
        // Paso 2: Conectar con Rutas
        $lookup: {
          from: "rutas", // Nombre de la colección en MongoDB
          localField: "ruta",
          foreignField: "_id",
          as: "infoRuta",
        },
      },
      {
        // Paso 3: Conectar con Camiones
        $lookup: {
          from: "camions", // (Mongoose pluraliza 'Camion' a 'camions')
          localField: "salidas.camionAsignado",
          foreignField: "_id",
          as: "infoCamion",
        },
      },
      {
        // Paso 4: Conectar con Usuarios (Conductores)
        $lookup: {
          from: "users", // (Mongoose pluraliza 'User' a 'users')
          localField: "salidas.conductorAsignado",
          foreignField: "_id",
          as: "infoConductor",
        },
      },
      {
        // Paso 5: Formatear el resultado
        $project: {
          _id: "$_id", // ID del *horario*
          salidaId: "$salidas._id", // ID de la *salida específica*
          diaSemana: "$diaSemana",
          hora: "$salidas.hora",
          // Usamos $arrayElemAt para tomar el primer (y único) resultado del lookup
          rutaNombre: { $arrayElemAt: ["$infoRuta.nombre", 0] },
          camionUnidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
          conductorNombre: { $arrayElemAt: ["$infoConductor.nombre", 0] },
        },
      },
    ]);

    res.json(horarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Crear un NUEVO horario ---
// POST /api/horarios
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    // Recibimos los IDs del formulario
    const { ruta, diaSemana, hora, camionAsignado, conductorAsignado } =
      req.body;

    // Buscamos un horario que YA exista para esa ruta y día
    let horario = await Horario.findOne({ ruta, diaSemana });

    const nuevaSalida = { hora, camionAsignado, conductorAsignado };

    if (horario) {
      // Si ya existe, solo añadimos la nueva salida al arreglo
      horario.salidas.push(nuevaSalida);
    } else {
      // Si no existe, creamos el documento completo
      horario = new Horario({
        ruta,
        diaSemana,
        salidas: [nuevaSalida], // Creamos el arreglo con la primera salida
      });
    }

    const horarioGuardado = await horario.save();
    res.status(201).json(horarioGuardado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 3: Borrar una SALIDA específica de un horario ---
// DELETE /api/horarios/:id/salidas/:salidaId
router.delete(
  "/:id/salidas/:salidaId",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id, salidaId } = req.params;

      // Usamos $pull para quitar un elemento de un arreglo
      const horario = await Horario.findByIdAndUpdate(
        id,
        { $pull: { salidas: { _id: salidaId } } },
        { new: true } // Devuelve el documento actualizado
      );

      if (!horario) {
        return res.status(404).json({ message: "Horario no encontrado" });
      }

      res.json({ message: "Salida eliminada", horario });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error del servidor" });
    }
  }
);

module.exports = router;
