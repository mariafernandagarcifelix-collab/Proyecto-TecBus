// backend/routes/horarios.js

const express = require("express");
const router = express.Router();
const Horario = require("../models/Horario");
const { protect, adminOnly } = require("../middleware/authMiddleware");


// --- RUTA 1: Obtener TODOS los horarios ---
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const horarios = await Horario.aggregate([
      { $unwind: "$salidas" },
      {
        $lookup: {
          from: "rutas",
          localField: "ruta",
          foreignField: "_id",
          as: "infoRuta",
        },
      },
      {
        $lookup: {
          from: "camions",
          localField: "salidas.camionAsignado",
          foreignField: "_id",
          as: "infoCamion",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "salidas.conductorAsignado",
          foreignField: "_id",
          as: "infoConductor",
        },
      },
      // Asignar valor numérico al día para ordenar
      {
        $addFields: {
          ordenDia: {
            $switch: {
              branches: [
                { case: { $eq: ["$diaSemana", "lunes"] }, then: 1 },
                { case: { $eq: ["$diaSemana", "martes"] }, then: 2 },
                { case: { $eq: ["$diaSemana", "miercoles"] }, then: 3 },
                { case: { $eq: ["$diaSemana", "jueves"] }, then: 4 },
                { case: { $eq: ["$diaSemana", "viernes"] }, then: 5 },
                { case: { $eq: ["$diaSemana", "sabado"] }, then: 6 },
                { case: { $eq: ["$diaSemana", "domingo"] }, then: 7 }
              ],
              default: 8
            }
          }
        }
      },
      {
        $project: {
          _id: "$_id",
          salidaId: "$salidas._id",
          diaSemana: "$diaSemana",
          ordenDia: 1,
          hora: "$salidas.hora",
          rutaNombre: { $arrayElemAt: ["$infoRuta.nombre", 0] },
          rutaId: { $arrayElemAt: ["$infoRuta._id", 0] },
          camionUnidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
          conductorNombre: { $arrayElemAt: ["$infoConductor.nombre", 0] },
        },
      },
      {
        $sort: { ordenDia: 1, hora: 1 }
      }
    ]);

    // 🔥 CORRECCIÓN: Mapa para mostrar acentos en la tabla
    const mapaDiasDisplay = {
      "lunes": "Lunes",
      "martes": "Martes",
      "miercoles": "Miércoles",
      "jueves": "Jueves",
      "viernes": "Viernes",
      "sabado": "Sábado",
      "domingo": "Domingo"
    };

    const horariosFormateados = horarios.map(h => ({
        ...h,
        // Traducimos el día crudo (ej: 'sabado') al bonito (ej: 'Sábado')
        diaSemana: mapaDiasDisplay[h.diaSemana] || h.diaSemana
    }));

    res.json(horariosFormateados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Crear/Agregar Horarios (CORREGIDA Y BLINDADA) ---
router.post("/", protect, adminOnly, async (req, res) => {
  const { ruta, diaSemana, hora, camionAsignado, conductorAsignado } = req.body;

  try {
    let diasAGuardar = [];

    // 1. TRADUCCIÓN EXACTA: Convertimos opciones de usuario a valores del Modelo
    // El modelo pide: "lunes", "martes", "miercoles" (sin tilde), etc.
    
    if (diaSemana === "Lunes-Viernes") {
      diasAGuardar = ["lunes", "martes", "miercoles", "jueves", "viernes"];
    } else if (diaSemana === "Diario") {
      diasAGuardar = [
        "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"
      ];
    } else {
      // Si viene un día individual (Ej: "Miércoles" o "Sabado")
      // Usamos un mapa para asegurar que coincida con el enum del modelo
      const mapaDias = {
        "Lunes": "lunes",
        "Martes": "martes",
        "Miércoles": "miercoles", "Miercoles": "miercoles",
        "Jueves": "jueves",
        "Viernes": "viernes",
        "Sábado": "sabado", "Sabado": "sabado",
        "Domingo": "domingo"
      };
      
      // Si está en el mapa lo usamos, si no, pasamos a minúscula por seguridad
      const diaLimpio = mapaDias[diaSemana] || diaSemana.toLowerCase();
      diasAGuardar = [diaLimpio];
    }

    // 2. Procesamos cada día
    const promesas = diasAGuardar.map(async (diaIndividual) => {
      // Buscamos si ya existe el documento base (Ruta + Día)
      let horarioBase = await Horario.findOne({
        ruta: ruta,
        diaSemana: diaIndividual,
      });

      // Si no existe, lo creamos primero
      if (!horarioBase) {
        horarioBase = new Horario({
          ruta: ruta,
          diaSemana: diaIndividual,
          salidas: [],
        });
      }

      // Verificamos si esa HORA exacta ya existe para no duplicarla
      const salidaExiste = horarioBase.salidas.some(
        (s) => s.hora === hora
      );

      if (!salidaExiste) {
        // Agregamos la nueva salida al array
        horarioBase.salidas.push({
          hora: hora,
          camionAsignado: camionAsignado || null,
          conductorAsignado: conductorAsignado || null,
        });
        return horarioBase.save();
      }
      return null;
    });

    await Promise.all(promesas);

    res.status(201).json({ message: "Horarios procesados correctamente" });

  } catch (error) {
    console.error("Error al guardar horario:", error);
    // Devolvemos el error exacto para debug
    res.status(400).json({ message: "Error de validación: " + error.message });
  }
});

// --- RUTA 3: Borrar una SALIDA específica ---
router.delete("/:id/salidas/:salidaId", protect, adminOnly, async (req, res) => {
  try {
    const { id, salidaId } = req.params;
    await Horario.updateOne(
      { _id: id },
      { $pull: { salidas: { _id: salidaId } } }
    );
    res.json({ message: "Salida eliminada" });
  } catch (error) {
    res.status(500).json({ message: "Error eliminando salida" });
  }
});

// --- RUTA 4: Obtener un Horario por ID (Para editar) ---
router.get("/:id", protect, async (req, res) => {
  try {
      const horario = await Horario.findById(req.params.id).populate("ruta");
      res.json(horario);
  } catch (error) {
      res.status(500).json({ message: "Error obteniendo horario" });
  }
});

// --- RUTA 5: Editar una salida (CON MIGRACIÓN INTELIGENTE) ---
router.put("/:id/salidas/:salidaId", protect, adminOnly, async (req, res) => {
    const { id, salidaId } = req.params; // ID del documento horario actual y de la salida
    const { hora, ruta, diaSemana } = req.body; // Datos nuevos que envía el formulario

    try {
        // 1. Buscamos el documento ORIGINAL completo para ver qué tenía
        const horarioOriginal = await Horario.findById(id);
        if (!horarioOriginal) return res.status(404).json({ message: "Horario original no encontrado" });

        // 2. Buscamos la salida específica dentro de ese horario para rescatar sus datos
        // (Necesitamos rescatar el camión y conductor asignados para no perderlos al mover)
        const salidaOriginal = horarioOriginal.salidas.find(s => s._id.toString() === salidaId);
        if (!salidaOriginal) return res.status(404).json({ message: "Salida no encontrada" });

        // 3. VERIFICACIÓN CLAVE: ¿Cambió la ruta o el día?
        // Convertimos a string para comparar ObjectId y Texto seguramente
        const rutaCambio = horarioOriginal.ruta.toString() !== ruta;
        const diaCambio = horarioOriginal.diaSemana !== diaSemana;

        if (!rutaCambio && !diaCambio) {
            // CASO A: Solo cambió la hora (FÁCIL)
            // Actualizamos ahí mismo sin mover nada
            await Horario.updateOne(
                { "_id": id, "salidas._id": salidaId },
                { $set: { "salidas.$.hora": hora } }
            );
            return res.json({ message: "Hora actualizada correctamente" });

        } else {
            // CASO B: MIGRACIÓN COMPLEJA (Cambió ruta o día)
            // Estrategia: Borrar del viejo -> Buscar/Crear el nuevo -> Insertar en el nuevo

            // B1. Borramos la salida del documento viejo
            await Horario.updateOne(
                { _id: id },
                { $pull: { salidas: { _id: salidaId } } }
            );

            // B2. Buscamos si ya existe el documento destino (Nueva Ruta + Nuevo Día)
            let horarioDestino = await Horario.findOne({ ruta: ruta, diaSemana: diaSemana });

            // Si no existe el destino, lo creamos
            if (!horarioDestino) {
                horarioDestino = new Horario({
                    ruta: ruta,
                    diaSemana: diaSemana,
                    salidas: []
                });
            }

            // B3. Insertamos la salida en el destino
            // Usamos los datos nuevos (hora) y RESCATAMOS los viejos (camión/conductor)
            horarioDestino.salidas.push({
                hora: hora,
                camionAsignado: salidaOriginal.camionAsignado,
                conductorAsignado: salidaOriginal.conductorAsignado
            });

            await horarioDestino.save();

            return res.json({ message: "Horario movido y actualizado correctamente" });
        }

    } catch (error) {
        console.error("Error en migración:", error);
        res.status(500).json({ message: "Error crítico al actualizar horario" });
    }
});

module.exports = router;
