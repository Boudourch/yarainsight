const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../config/emailService');

class User {

    // ========== INSCRIPTION NORMALE (register page) ==========
    // Crée user avec token — statut inactif jusqu'à confirmation email
    static async create(userData) {
        const { nom, prenom, email, mot_de_passe, telephone, role } = userData;
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

        const verification_token = crypto.randomBytes(32).toString('hex');
        const verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        const [result] = await db.execute(
            `INSERT INTO users 
            (nom, prenom, email, mot_de_passe, telephone, role, statut, is_verified, verification_token, verification_expires) 
            VALUES (?, ?, ?, ?, ?, ?, 'inactif', 0, ?, ?)`,
            [nom, prenom, email, hashedPassword, telephone || null, role || 'user', verification_token, verification_expires]
        );

        // Envoie email de confirmation
        await sendConfirmationEmail(email, prenom, verification_token);

        return result.insertId;
    }

    // ========== CRÉATION PAR ADMIN/MANAGER ==========
    // Même flow que create() — user reçoit email de confirmation
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

    // Trouver user par token de vérification (token valide + pas encore vérifié)
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

    // Marquer user comme vérifié et activer son compte
    static async verifyUser(userId) {
        await db.execute(
            `UPDATE users 
             SET is_verified = 1, statut = 'actif', verification_token = NULL, verification_expires = NULL 
             WHERE id = ?`,
            [userId]
        );
    }

    // Trouver un utilisateur par email
    static async findByEmail(email) {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        return rows[0];
    }

    // Trouver un utilisateur par ID
    static async findById(id) {
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0];
    }

    // Vérifier le mot de passe
    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    // Mettre à jour la dernière connexion
    static async updateLastLogin(userId) {
        await db.execute('UPDATE users SET derniere_connexion = NOW() WHERE id = ?', [userId]);
    }

    // Supprimer un utilisateur
    static async deleteUser(userId) {
        const [result] = await db.execute('DELETE FROM users WHERE id = ?', [userId]);
        return result;
    }

    // ========== FONCTIONS POUR LA GESTION DES STATUTS ==========

    // 1. Mettre à jour le statut de tous les utilisateurs automatiquement
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

    // 2. Récupérer un utilisateur avec son statut calculé et jours d'inactivité
    static async getUserWithStatus(id) {
        await this.updateAllUsersStatus();
        
        const query = `
            SELECT 
                id, nom, prenom, email, telephone, role,
                date_inscription, 
                derniere_connexion, 
                statut,
                DATEDIFF(NOW(), COALESCE(derniere_connexion, date_inscription)) as jours_inactivite
            FROM users 
            WHERE id = ?
        `;
        
        const [rows] = await db.execute(query, [id]);
        return rows[0];
    }

    // 3. Récupérer tous les utilisateurs avec leurs statuts (pour admin)
    static async getAllUsers() {
        await this.updateAllUsersStatus();
        
        const query = `
            SELECT 
                id, nom, prenom, email, telephone, role,
                DATE_FORMAT(date_inscription, '%d/%m/%Y %H:%i') as date_inscription_formatee,
                CASE 
                    WHEN derniere_connexion IS NULL THEN 'Jamais connecté'
                    ELSE DATE_FORMAT(derniere_connexion, '%d/%m/%Y %H:%i')
                END as derniere_connexion_formatee,
                statut,
                DATEDIFF(NOW(), COALESCE(derniere_connexion, date_inscription)) as jours_inactivite
            FROM users 
            ORDER BY date_inscription DESC
        `;
        
        const [rows] = await db.execute(query);
        return rows;
    }

    // 4. Bloquer un utilisateur
    static async bloquerUser(userId) {
        const query = `UPDATE users SET statut = 'bloque' WHERE id = ?`;
        const [result] = await db.execute(query, [userId]);
        return result;
    }

    // 5. Débloquer un utilisateur
    static async debloquerUser(userId) {
        const query = `UPDATE users SET statut = 'actif' WHERE id = ?`;
        const [result] = await db.execute(query, [userId]);
        return result;
    }

    // 6. Vérifier si un utilisateur peut se connecter (pas bloqué)
    static async canLogin(userId) {
        const user = await this.getUserWithStatus(userId);
        if (!user) return false;
        return user.statut !== 'bloque';
    }

    // 7. Obtenir le message de statut pour un utilisateur
    static async getStatusMessage(userId) {
        const user = await this.getUserWithStatus(userId);
        if (!user) return { canLogin: false, message: 'Utilisateur non trouvé' };
        
        if (user.statut === 'bloque') {
            return { 
                canLogin: false, 
                message: ' Compte bloqué. Veuillez contacter l\'administrateur.' 
            };
        }
        
        if (user.statut === 'inactif') {
            return { 
                canLogin: true, 
                warning: true,
                message: ` Compte inactif depuis ${user.jours_inactivite} jours. Connectez-vous pour le réactiver.` 
            };
        }
        
        return { 
            canLogin: true, 
            warning: false,
            message: ` Compte actif. Dernière activité il y a ${user.jours_inactivite} jours.` 
        };
    }
}

module.exports = User;