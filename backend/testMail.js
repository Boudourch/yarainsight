require("dotenv").config();

console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? " trouvé" : " undefined");

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.sendMail({
  from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
  to: "chtiouiboudour123@gmail.com",
  subject: "Test Nodemailer ",
  html: "<h2>Nodemailer fonctionne parfaitement !</h2>",
}).then(() => {
  console.log(" Email envoyé avec succès !");
}).catch((err) => {
  console.log(" Erreur :", err.message);
});