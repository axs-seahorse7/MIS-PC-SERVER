import mysql from 'mysql2/promise';

class UserModel {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'pcb_user',
            password: process.env.DB_PASSWORD || 'StrongPassword123!',
            database: process.env.DB_NAME || 'pcb_tracker',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        });
    }

    async getAllUsers() {
        const [rows] = await this.pool.query('SELECT * FROM users');
        return rows;
    }

    async getUserById(id) {
        const [rows] = await this.pool.query('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0];
    }

    async createUser(userData) {
        const { name, email, password } = userData;
        const [result] = await this.pool.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, password]);
        return { id: result.insertId, ...userData };
    }

    async updateUser(id, userData) {
        const { name, email, password } = userData;
        await this.pool.query('UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?', [name, email, password, id]);
        return { id, ...userData };
    }

    async deleteUser(id) {
        await this.pool.query('DELETE FROM users WHERE id = ?', [id]);
        return { id };
    }

}

export default new UserModel();