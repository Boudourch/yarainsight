const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Test de connexion au démarrage (optionnel mais recommandé)
transporter.verify((error, success) => {
  if (error) {
    console.log(" Erreur mailer :", error.message);
  } else {
    console.log(" Mailer prêt à envoyer des emails !");
  }
});

module.exports = transporter;