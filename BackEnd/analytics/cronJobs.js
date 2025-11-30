// backend/analytics/cronJobs.js

const cron = require("node-cron");
const mongoose = require("mongoose");

// Importamos los modelos
const HistorialUbicacion = require("../models/HistorialUbicacion");
const HistorialViaje = require("../models/HistorialBusqueda");

// --- ¡NUEVO! Lógica de la Consulta 3 extraída a su propia función ---
const ejecutarAnalisisVelocidad = async () => {
  console.log("--- 🏃‍♂️ Ejecutando Job: Análisis de Velocidad ---");
  try {
    const treintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await HistorialUbicacion.aggregate([
      { $match: { timestamp: { $gte: treintaDiasAtras } } },
      {
        $group: {
          _id: "$camionId",
          velocidadPromedio: { $avg: "$velocidad" },
          totalPings: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "camions",
          localField: "_id",
          foreignField: "_id",
          as: "infoCamion",
        },
      },
      {
        $project: {
          _id: "$_id",
          unidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
          velocidadPromedio: { $round: ["$velocidadPromedio", 2] },
          totalPings: "$totalPings",
        },
      },
      {
        $merge: {
          into: "analiticapromedios",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      },
    ]);
    console.log("--- ✅ Job: Análisis de Velocidad Completado ---");
  } catch (error) {
    console.error("--- ❌ Error en Job de Análisis de Velocidad:", error);
  }
};

// --- ¡NUEVO! Lógica de la Consulta 4 extraída a su propia función ---
const ejecutarAnalisisHabitos = async () => {
  console.log("--- 🏃‍♂️ Ejecutando Job: Análisis de Hábitos ---");
  try {
    await HistorialViaje.aggregate([
      {
        $group: {
          _id: {
            estudiante: "$estudianteId",
            ruta: "$ruta",
            hora: "$horaProgramada",
          },
          conteo: { $sum: 1 },
        },
      },
      { $sort: { conteo: -1 } },
      {
        $group: {
          _id: "$_id.estudiante",
          rutaPreferida: { $first: "$_id.ruta" },
          horaPreferida: { $first: "$_id.hora" },
          viajesContados: { $first: "$conteo" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "infoEstudiante",
        },
      },
      {
        $project: {
          _id: "$_id",
          nombreEstudiante: { $arrayElemAt: ["$infoEstudiante.nombre", 0] },
          prediccion: {
            ruta: "$rutaPreferida",
            hora: "$horaPreferida",
          },
          viajesAnalizados: "$viajesContados",
        },
      },
      {
        $merge: {
          into: "analiticaprediccions",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      },
    ]);
    console.log("--- ✅ Job: Análisis de Hábitos Completado ---");
  } catch (error) {
    console.error("--- ❌ Error en Job de Análisis de Hábitos:", error);
  }
};

// --- Tareas Programadas (cron) ---

// CONSULTA 3: Se ejecuta todos los días a las 3:00 AM
const jobAnalisisVelocidad = cron.schedule(
  "0 3 * * *",
  ejecutarAnalisisVelocidad
);

// CONSULTA 4: Se ejecuta todos los días a las 4:00 AM
const jobAnalisisHabitos = cron.schedule("0 4 * * *", ejecutarAnalisisHabitos);

// --- Función de Inicio ---

const startAnalyticsJobs = () => {
  console.log("⏰ Iniciando programador de tareas nocturnas...");
  jobAnalisisVelocidad.start();
  jobAnalisisHabitos.start();

  // ¡¡AQUÍ ESTÁ LA CORRECCIÓN!!
  // Llamamos a la función directamente
  // (Comenta esto cuando termines de probar)
  console.log("--- 🏃‍♂️ Forzando ejecución de Job de Hábitos AHORA ---");
  ejecutarAnalisisHabitos();
};

module.exports = { startAnalyticsJobs };
