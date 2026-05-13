const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../config/emailService');

// ========== FONCTION D'ENVOI D'EMAIL DE CONFIRMATION ==========
async function sendConfirmationEmail(email, prenom, token) {
    const confirmLink = `http://localhost:5001/api/auth/verify-email/${token}`;
    
    await emailService.sendNotificationEmail(email, 'Confirm your Yara Insights account', `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #E8B84B;">Welcome to Yara Insights, ${prenom}!</h2>
            <p>Click below to confirm your email and activate your account:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${confirmLink}" 
                   style="background-color: #E8B84B; color: #000; padding: 14px 28px; 
                          border-radius: 8px; text-decoration: none; font-size: 16px; 
                          display: inline-block; font-weight: bold;">
                    Confirm my account
                </a>
            </div>
            <p style="color: #888; font-size: 13px;">This link expires in <strong>24 hours</strong>.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #aaa; font-size: 12px; text-align: center;">© 2026 Yara Insights — All rights reserved</p>
        </div>
    `);
}

class User {

    // ========== INSCRIPTION NORMALE (register page) ==========
    static async create(userData) {
        const { nom, prenom, email, mot_de_passe, telephone, role } = userData;
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

        const verification_token = crypto.randomBytes(32).toString('hex');
        const verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const [result] = await db.execute(
            `INSERT INTO users 
            (nom, prenom, email, mot_de_passe, telephone, role, statut, is_verified, verification_token, verification_expires) 
            VALUES (?, ?, ?, ?, ?, ?, 'inactif', 0, ?, ?)`,
            [nom, prenom, email, hashedPassword, telephone || null, role || 'user', verification_token, verification_expires]
        );

        await sendConfirmationEmail(email, prenom, verification_token);

        return result.insertId;
    }

    // ========== CRÉATION PAR ADMIN/MANAGER ==========
    static async createWithToken(userData) {
        const { nom, prenom, email, mot_de_passe, telephone, role, verification_token, verification_expires } = userData;
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

        const [result] = await db.execute(
            `INSERT INTO users 
            (nom, prenom, email, mot_de_passe, telephone, role, statut, is_verified, verification_token, verification_expires) 
            VALUES (?, ?, ?, ?, ?, ?, 'inactif', 0, ?, ?)`,
            [nom, prenom, email, hashedPassword, telephone || null, role || 'user', verification_token, verification_expires]
        );
        return result.insertId;
    }

    // ========== RECHERCHE PAR TOKEN DE VÉRIFICATION ==========
    static async findByVerificationToken(token) {
        const [rows] = await db.execute(
            `SELECT * FROM users 
             WHERE verification_token = ? 
             AND verification_expires > NOW()
             AND is_verified = 0`,
            [token]
        );
        return rows[0];
    }

    // ========== VÉRIFIER ET ACTIVER UN COMPTE ==========
    static async verifyUser(userId) {
        await db.execute(
            `UPDATE users 
             SET is_verified = 1, statut = 'actif', verification_token = NULL, verification_expires = NULL 
             WHERE id = ?`,
            [userId]
        );
    }

    // ========== RECHERCHE PAR EMAIL ==========
    static async findByEmail(email) {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        return rows[0];
    }

    // ========== RECHERCHE PAR ID ==========
    static async findById(id) {
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0];
    }

    // ========== VÉRIFICATION MOT DE PASSE ==========
    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    // ========== METTRE À JOUR DERNIÈRE CONNEXION ==========
    static async updateLastLogin(userId) {
        await db.execute('UPDATE users SET derniere_connexion = NOW() WHERE id = ?', [userId]);
    }

    // ========== SUPPRIMER UN UTILISATEUR ==========
    static async deleteUser(userId) {
        const [result] = await db.execute('DELETE FROM users WHERE id = ?', [userId]);
        return result;
    }

    // ========== GESTION DES STATUTS ==========
    static async updateAllUsersStatus() {
        const query = `
            UPDATE users 
            SET statut = CASE
                WHEN statut = 'bloque' THEN 'bloque'
                WHEN derniere_connexion IS NOT NULL AND derniere_connexion < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'inactif'
                WHEN derniere_connexion IS NULL AND date_inscription < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'inactif'
                WHEN derniere_connexion IS NOT NULL AND derniere_connexion >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'actif'
                WHEN derniere_connexion IS NULL AND date_inscription >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'actif'
                ELSE statut
            END
            WHERE statut != 'bloque'
        `;
        const [result] = await db.execute(query);
        return result;
    }

    static async getUserWithStatus(id) {
        await this.updateAllUsersStatus();
        const query = `
            SELECT 
                id, nom, prenom, email, telephone, role,
                date_inscription, derniere_connexion, statut,
                DATEDIFF(NOW(), COALESCE(derniere_connexion, date_inscription)) as jours_inactivite
            FROM users WHERE id = ?
        `;
        const [rows] = await db.execute(query, [id]);
        return rows[0];
    }

    static async getAllUsers() {
        await this.updateAllUsersStatus();
        const query = `
            SELECT id, nom, prenom, email, telephone, role,
                DATE_FORMAT(date_inscription, '%d/%m/%Y %H:%i') as date_inscription_formatee,
                CASE 
                    WHEN derniere_connexion IS NULL THEN 'Jamais connecté'
                    ELSE DATE_FORMAT(derniere_connexion, '%d/%m/%Y %H:%i')
                END as derniere_connexion_formatee,
                statut,
                DATEDIFF(NOW(), COALESCE(derniere_connexion, date_inscription)) as jours_inactivite
            FROM users ORDER BY date_inscription DESC
        `;
        const [rows] = await db.execute(query);
        return rows;
    }

    static async bloquerUser(userId) {
        const [result] = await db.execute(`UPDATE users SET statut = 'bloque' WHERE id = ?`, [userId]);
        return result;
    }

    static async debloquerUser(userId) {
        const [result] = await db.execute(`UPDATE users SET statut = 'actif' WHERE id = ?`, [userId]);
        return result;
    }

    static async canLogin(userId) {
        const user = await this.getUserWithStatus(userId);
        if (!user) return false;
        return user.statut !== 'bloque';
    }

    static async getStatusMessage(userId) {
        const user = await this.getUserWithStatus(userId);
        if (!user) return { canLogin: false, message: 'Utilisateur non trouvé' };
        if (user.statut === 'bloque') {
            return { canLogin: false, message: 'Compte bloqué. Contactez l\'administrateur.' };
        }
        if (user.statut === 'inactif') {
            return { canLogin: true, warning: true, message: `Compte inactif depuis ${user.jours_inactivite} jours. Connectez-vous pour le réactiver.` };
        }
        return { canLogin: true, warning: false, message: `Compte actif. Dernière activité il y a ${user.jours_inactivite} jours.` };
    }

    // ========== MOT DE PASSE OUBLIÉ ==========
    static async saveResetToken(userId, resetToken, expiresAt) {
        const [result] = await db.execute(`UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?`, [resetToken, expiresAt, userId]);
        return result;
    }

    static async findByResetToken(email, resetToken) {
        const [rows] = await db.execute(`SELECT * FROM users WHERE email = ? AND reset_token = ? AND reset_expires > NOW()`, [email, resetToken]);
        return rows[0] || null;
    }

    static async updatePasswordAndClearResetToken(userId, newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const [result] = await db.execute(`UPDATE users SET mot_de_passe = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?`, [hashedPassword, userId]);
        return result;
    }

    // ========== MÉTHODES SUPPLÉMENTAIRES ==========
    static async updatePassword(userId, newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const [result] = await db.execute(`UPDATE users SET mot_de_passe = ?, updated_at = NOW() WHERE id = ?`, [hashedPassword, userId]);
        return result;
    }

    static async updateEmail(userId, newEmail) {
        const [result] = await db.execute(`UPDATE users SET email = ?, pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL, updated_at = NOW() WHERE id = ?`, [newEmail, userId]);
        return result;
    }

    static async savePendingEmail(userId, newEmail, token, expiresAt) {
        const [result] = await db.execute(`UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires = ? WHERE id = ?`, [newEmail, token, expiresAt, userId]);
        return result;
    }
}

module.exports = User;