// backend/routes/notificaciones.js

const express = require("express");
const router = express.Router();
const webpush = require("web-push");
const Notificacion = require("../models/Notificacion");
const User = require("../models/User"); // ¡Importante!
const AnaliticaPrediccion = require("../models/AnaliticaPrediccion"); // ¡Importante!
const { protect, adminOnly } = require("../middleware/authMiddleware");

// Configura web-push con tus llaves del .env
webpush.setVapidDetails(
  "mailto:l2225010050@guasave.tecnm.mx", // Un email de contacto
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// --- RUTA 1: Obtener el Historial de Alertas (para el Admin) ---
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const notificaciones = await Notificacion.aggregate([
      { $match: { tipo: "incidente" } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "camions",
          localField: "relacionCon.id",
          foreignField: "_id",
          as: "infoCamion",
        },
      },
      {
        $project: {
          _id: 1,
          titulo: 1,
          mensaje: 1,
          createdAt: 1,
          camionUnidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
        },
      },
      { $limit: 100 },
    ]);
    res.json(notificaciones);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Guardar la Suscripción Push (del Estudiante) ---
router.post("/subscribe", protect, async (req, res) => {
  const subscription = req.body;
  const userId = req.user.id;

  try {
    await User.findByIdAndUpdate(userId, {
      "estudiante.pushSubscription": subscription,
    });
    res.status(201).json({ message: "Suscripción guardada" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al guardar suscripción" });
  }
});

// --- RUTA 3: Disparar la Notificación Predictiva (del Estudiante) ---
router.get("/mi-prediccion", protect, async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Busca la predicción del usuario
    const prediccion = await AnaliticaPrediccion.findById(userId);
    if (!prediccion) {
      // No es un error, solo que no hay datos
      return res.json({ message: "Aún no hay predicciones para ti." });
    }

    // 2. Busca la "dirección" (suscripción) del usuario
    const user = await User.findById(userId);
    if (!user || !user.estudiante || !user.estudiante.pushSubscription) {
      return res
        .status(404)
        .json({ message: "El usuario no está suscrito a notificaciones." });
    }
    const subscription = user.estudiante.pushSubscription;

    // 3. Prepara el mensaje
    const payload = JSON.stringify({
      title: "¡Tu Ruta de TecBus!",
      body: `¡Hola ${
        user.nombre.split(" ")[0]
      }! Vemos que usualmente tomas la ruta "${
        prediccion.prediccion.ruta
      }" a las ${prediccion.prediccion.hora}. ¡Que tengas un buen viaje!`,
      icon: "httpsE://i.imgur.com/gL982gC.png", // Ícono de ejemplo
    });

    // 4. ¡Envía la notificación!
    await webpush.sendNotification(subscription, payload);

    res.json({ message: "Notificación de predicción enviada!" });
  } catch (error) {
    // Esto puede pasar si la suscripción (la "dirección") ha expirado
    console.error("Error al enviar push notification:", error);
    res.status(500).json({ message: "Error al enviar la notificación" });
  }
});

module.exports = router;
