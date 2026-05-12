// emailService.js
const transporter = require('./mailer');

async function sendConfirmationEmail(email, prenom, token) {
  const confirmUrl = `http://localhost:3000/confirm-email.html?token=${token}`;

  await transporter.sendMail({
    from: '"Yara Insights" <' + process.env.EMAIL_USER + '>',
    to: email,
    subject: 'Confirm your Yara Insights account',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;">
        <h2 style="color:#E8B84B;">Welcome to Yara Insights, ${prenom}!</h2>
        <p>An account has been created for you. Click below to confirm your email:</p>
        <a href="${confirmUrl}" 
           style="display:inline-block;background:#E8B84B;color:#000;padding:12px 28px;
                  border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
          Confirm my account
        </a>
        <p style="color:#999;font-size:12px;">This link expires in 24 hours.</p>
      </div>
    `
  });
}

module.exports = { sendConfirmationEmail };