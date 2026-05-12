const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const transporter = require('../config/mailer');

const JWT_SECRET   = 'mon_secret_jwt_pfe_2026';
const FRONTEND_URL = 'http://localhost:5001';

// ── Middleware: verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token      = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token requis' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token invalide' });
    }
}

// ── Email templates
function emailWrapper(content) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px;border:1px solid #e0e0e0;border-radius:10px;background:#fff;">
        ${content}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#aaa;font-size:12px;text-align:center;">© 2026 Yara Insights — Tous droits réservés</p>
    </div>`;
}

// ══════════════════════════════════════════════
//  INSCRIPTION
// ══════════════════════════════════════════════
router.post('/register', async (req, res) => {
    try {
        const { nom, prenom, email, mot_de_passe, telephone } = req.body;
        console.log('Tentative inscription:', email);

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
        }

        const verification_token   = crypto.randomBytes(32).toString('hex');
        const verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await User.createWithToken({ nom, prenom, email, mot_de_passe, telephone, verification_token, verification_expires });

        const confirmLink = `${FRONTEND_URL}/api/auth/verify-email/${verification_token}`;

        await transporter.sendMail({
            from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Confirmez votre compte Yara Insights',
            html: emailWrapper(`
                <h2 style="color:#E8B84B;">Bienvenue sur Yara Insights, ${prenom} ! </h2>
                <p style="color:#444;">Merci de vous être inscrit. Cliquez ci-dessous pour confirmer votre email :</p>
                <div style="text-align:center;margin:28px 0;">
                    <a href="${confirmLink}" style="background:#E8B84B;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block;">
                         Confirmer mon compte
                    </a>
                </div>
                <p style="color:#888;font-size:13px;">Ce lien expire dans <strong>24 heures</strong>.</p>
                <p style="color:#888;font-size:13px;">Si vous n'avez pas créé de compte, ignorez cet email.</p>
            `)
        });

        console.log('Inscription OK, email envoyé:', email);
        res.status(201).json({ success: true, message: 'Inscription réussie ! Vérifiez votre email pour confirmer votre compte.' });

    } catch (error) {
        console.error('Erreur inscription:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur: ' + error.message });
    }
});

// ══════════════════════════════════════════════
//  VÉRIFICATION EMAIL (inscription + changement email)
// ══════════════════════════════════════════════
router.get('/verify-email/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const db = require('../config/db');

        // Check: is it a pending email change token?
        const [pendingRows] = await db.execute(
            `SELECT * FROM users WHERE pending_email_token = ? AND pending_email_expires > NOW()`,
            [token]
        );

        if (pendingRows.length > 0) {
            // ── Confirm email change
            const user = pendingRows[0];
            await db.execute(
                `UPDATE users SET email = pending_email, pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL, updated_at = NOW() WHERE id = ?`,
                [user.id]
            );
            console.log(`Email changé pour user ${user.id}: ${user.pending_email}`);

            return res.send(`
                <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Email confirmé - Yara Insights</title></head>
                <body style="font-family:Arial,sans-serif;text-align:center;padding:50px;background:#f5f5f5;">
                    <div style="background:white;max-width:500px;margin:auto;padding:40px;border-radius:15px;box-shadow:0 2px 20px rgba(0,0,0,0.1);">
                        <div style="font-size:60px;"></div>
                        <h2 style="color:#E8B84B;">Adresse email mise à jour !</h2>
                        <p style="color:#444;">Votre nouvelle adresse email a été confirmée avec succès.</p>
                        <p style="color:#666;font-size:14px;">Connectez-vous avec votre nouvelle adresse.</p>
                        <a href="${FRONTEND_URL}/login.html" style="display:inline-block;margin-top:25px;padding:14px 35px;background:#E8B84B;color:#000;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;">
                             Se connecter
                        </a>
                    </div>
                </body></html>
            `);
        }

        // ── Normal account verification
        const user = await User.findByVerificationToken(token);

        if (!user) {
            return res.status(400).send(`
                <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Lien invalide - Yara Insights</title></head>
                <body style="font-family:Arial,sans-serif;text-align:center;padding:50px;background:#f5f5f5;">
                    <div style="background:white;max-width:500px;margin:auto;padding:40px;border-radius:15px;box-shadow:0 2px 20px rgba(0,0,0,0.1);">
                        <div style="font-size:60px;"></div>
                        <h2 style="color:#e74c3c;">Lien invalide ou expiré</h2>
                        <p style="color:#666;">Veuillez vous réinscrire ou demander un nouveau lien.</p>
                        <a href="${FRONTEND_URL}/register.html" style="display:inline-block;margin-top:20px;padding:12px 30px;background:#E8B84B;color:#000;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;">
                            S'inscrire à nouveau
                        </a>
                    </div>
                </body></html>
            `);
        }

        await User.verifyUser(user.id);
        console.log('Email vérifié pour:', user.email);

        res.send(`
            <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Compte confirmé - Yara Insights</title></head>
            <body style="font-family:Arial,sans-serif;text-align:center;padding:50px;background:#f5f5f5;">
                <div style="background:white;max-width:500px;margin:auto;padding:40px;border-radius:15px;box-shadow:0 2px 20px rgba(0,0,0,0.1);">
                    <div style="font-size:60px;"></div>
                    <h2 style="color:#E8B84B;">Email confirmé avec succès !</h2>
                    <p style="color:#444;">Bienvenue sur <strong>Yara Insights</strong>, <strong>${user.prenom}</strong> !</p>
                    <p style="color:#666;font-size:14px;">Votre compte est maintenant activé. Vous pouvez vous connecter.</p>
                    <a href="${FRONTEND_URL}/login.html" style="display:inline-block;margin-top:25px;padding:14px 35px;background:#E8B84B;color:#000;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;">
                         Se connecter
                    </a>
                </div>
            </body></html>
        `);

    } catch (error) {
        console.error('Erreur vérification email:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ══════════════════════════════════════════════
//  CONNEXION
// ══════════════════════════════════════════════
router.post('/login', async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;
        console.log('Tentative connexion:', email);

        const user = await User.findByEmail(email);
        if (!user) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });

        if (!user.is_verified) {
            return res.status(403).json({ success: false, message: 'Veuillez confirmer votre email avant de vous connecter.' });
        }

        const isValid = await User.verifyPassword(mot_de_passe, user.mot_de_passe);
        if (!isValid) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });

        await User.updateAllUsersStatus();
        const userWithStatus = await User.getUserWithStatus(user.id);

        if (userWithStatus.statut === 'bloque') {
            return res.status(403).json({ success: false, message: 'Compte bloqué. Veuillez contacter l\'administrateur.', statut: 'bloque' });
        }

        await User.updateLastLogin(user.id);

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, statut: userWithStatus.statut },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const responseData = {
            success: true,
            message: 'Connexion réussie',
            token,
            user: {
                id: user.id, nom: user.nom, prenom: user.prenom,
                email: user.email, telephone: user.telephone,
                role: user.role, statut: userWithStatus.statut,
                jours_inactivite: userWithStatus.jours_inactivite,
                must_change_password: user.must_change_password || false
            }
        };

        if (userWithStatus.statut === 'inactif') {
            responseData.warning = `Compte inactif depuis ${userWithStatus.jours_inactivite} jours.`;
        }

        console.log('Connexion réussie:', email);
        res.json(responseData);

    } catch (error) {
        console.error('Erreur connexion:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur: ' + error.message });
    }
});

// ══════════════════════════════════════════════
//  MISE À JOUR DU PROFIL (email + mot de passe)
// ══════════════════════════════════════════════
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { new_email, current_password, new_password } = req.body;
        const userId = req.user.id;
        const db     = require('../config/db');

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

        // Toujours vérifier le mot de passe actuel
        if (!current_password) {
            return res.status(400).json({ success: false, message: 'Le mot de passe actuel est requis' });
        }

        const passwordValid = await bcrypt.compare(current_password, user.mot_de_passe);
        if (!passwordValid) {
            return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
        }

        // ── CAS 1: Changement d'email
        if (new_email && new_email !== user.email) {

            // Email déjà utilisé?
            const existing = await User.findByEmail(new_email);
            if (existing && existing.id !== userId) {
                return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé par un autre compte' });
            }

            // Génère token de confirmation
            const pendingToken   = crypto.randomBytes(32).toString('hex');
            const pendingExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

            // Sauvegarde pending email + token en DB
            await db.execute(
                `UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires = ?, updated_at = NOW() WHERE id = ?`,
                [new_email, pendingToken, pendingExpires, userId]
            );

            // Envoie email de confirmation au NOUVEAU email
            const confirmLink = `${FRONTEND_URL}/api/auth/verify-email/${pendingToken}`;

            await transporter.sendMail({
                from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
                to: new_email,
                subject: 'Confirmez votre nouvelle adresse email — Yara Insights',
                html: emailWrapper(`
                    <h2 style="color:#E8B84B;">Confirmer votre nouvelle adresse </h2>
                    <p style="color:#444;">Bonjour <strong>${user.prenom}</strong>,</p>
                    <p style="color:#444;">Vous avez demandé à changer votre adresse email sur Yara Insights.</p>
                    <p style="color:#444;">Cliquez ci-dessous pour confirmer votre nouvelle adresse :</p>
                    <div style="text-align:center;margin:28px 0;">
                        <a href="${confirmLink}" style="background:#E8B84B;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block;">
                             Confirmer le nouvel email
                        </a>
                    </div>
                    <p style="color:#888;font-size:13px;">Ce lien expire dans <strong>24 heures</strong>.</p>
                    <p style="color:#888;font-size:13px;">Si vous n'avez pas fait cette demande, ignorez cet email. Votre ancien email reste actif.</p>
                `)
            });

            console.log(`Confirmation email envoyée à: ${new_email} pour user ${userId}`);
            return res.json({
                success: true,
                message: `Un email de confirmation a été envoyé à ${new_email}. Cliquez sur le lien pour valider le changement.`,
                pending_email: true
            });
        }

        // ── CAS 2: Changement de mot de passe
        if (new_password) {
            if (new_password.length < 6) {
                return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
            }

            const hashed = await bcrypt.hash(new_password, 10);
            await db.execute(
                `UPDATE users SET mot_de_passe = ?, updated_at = NOW() WHERE id = ?`,
                [hashed, userId]
            );

            // Envoie email de notification à l'email ACTUEL
            const now = new Date().toLocaleString('fr-FR', {
                timeZone: 'Africa/Tunis',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            await transporter.sendMail({
                from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
                to: user.email,
                subject: ' Mot de passe modifié — Yara Insights',
                html: emailWrapper(`
                    <h2 style="color:#E8B84B;">Mot de passe mis à jour </h2>
                    <p style="color:#444;">Bonjour <strong>${user.prenom}</strong>,</p>
                    <p style="color:#444;">Votre mot de passe Yara Insights a été modifié avec succès.</p>
                    <div style="background:#f9f9f9;border-left:4px solid #E8B84B;padding:14px 18px;border-radius:6px;margin:20px 0;">
                        <p style="color:#333;margin:0;font-size:14px;">
                             <strong>Date :</strong> ${now}<br>
                             <strong>Compte :</strong> ${user.email}
                        </p>
                    </div>
                    <p style="color:#666;font-size:13px;">
                        Si vous n'êtes pas à l'origine de cette modification, veuillez contacter immédiatement notre support ou changer votre mot de passe dès que possible.
                    </p>
                    <div style="text-align:center;margin:24px 0;">
                        <a href="${FRONTEND_URL}/login.html" style="background:#E8B84B;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold;display:inline-block;">
                             Se connecter
                        </a>
                    </div>
                `)
            });

            const updatedUser = await User.findById(userId);
            console.log(`Mot de passe changé pour user ${userId}`);

            return res.json({
                success: true,
                message: 'Mot de passe mis à jour avec succès. Un email de confirmation vous a été envoyé.',
                user: {
                    id: updatedUser.id, nom: updatedUser.nom, prenom: updatedUser.prenom,
                    email: updatedUser.email, telephone: updatedUser.telephone, role: updatedUser.role
                }
            });
        }

        return res.status(400).json({ success: false, message: 'Aucune modification à effectuer' });

    } catch (error) {
        console.error('Erreur profile update:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur: ' + error.message });
    }
});

// ══════════════════════════════════════════════
//  CHECK STATUS
// ══════════════════════════════════════════════
router.get('/check-status', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Token requis' });

        const decoded = jwt.verify(token, JWT_SECRET);
        await User.updateAllUsersStatus();
        const user = await User.getUserWithStatus(decoded.id);
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

        const response = { success: true, statut: user.statut, jours_inactivite: user.jours_inactivite, derniere_connexion: user.derniere_connexion, date_inscription: user.date_inscription };
        if (user.statut === 'actif')    response.message = `Compte actif. Dernière activité il y a ${user.jours_inactivite} jours.`;
        else if (user.statut === 'inactif') { response.message = `Compte inactif depuis ${user.jours_inactivite} jours.`; response.warning = true; }
        else if (user.statut === 'bloque')  response.message = 'Compte bloqué. Contactez l\'administrateur.';
        res.json(response);

    } catch (error) {
        console.error('Erreur check-status:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ══════════════════════════════════════════════
//  REFRESH TOKEN
// ══════════════════════════════════════════════
router.post('/refresh-token', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Token requis' });

        const decoded = jwt.verify(token, JWT_SECRET);
        await User.updateAllUsersStatus();
        const user = await User.getUserWithStatus(decoded.id);
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        if (user.statut === 'bloque') return res.status(403).json({ success: false, message: 'Compte bloqué', statut: 'bloque' });

        const newToken = jwt.sign({ id: user.id, email: user.email, role: user.role, statut: user.statut }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token: newToken, user: { id: user.id, nom: user.nom, prenom: user.prenom, email: user.email, role: user.role, statut: user.statut, jours_inactivite: user.jours_inactivite } });

    } catch (error) {
        console.error('Erreur refresh-token:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ══════════════════════════════════════════════
//  VERIFY TOKEN
// ══════════════════════════════════════════════
router.get('/verify', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Token requis' });

        const decoded = jwt.verify(token, JWT_SECRET);
        await User.updateAllUsersStatus();
        const user = await User.getUserWithStatus(decoded.id);
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        if (user.statut === 'bloque') return res.status(403).json({ success: false, message: 'Compte bloqué', statut: 'bloque' });

        res.json({ success: true, user: { id: user.id, nom: user.nom, prenom: user.prenom, email: user.email, role: user.role, statut: user.statut } });

    } catch (error) {
        console.error('Erreur verify:', error);
        res.status(401).json({ success: false, message: 'Token invalide' });
    }
});

// ══════════════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════════════
router.post('/logout', async (req, res) => {
    try {
        res.json({ success: true, message: 'Déconnexion réussie' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

module.exports = router;