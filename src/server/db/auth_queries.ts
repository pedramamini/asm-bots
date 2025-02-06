import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { SCHEMA, UserRow, SessionRow, QueryResult, AuthQueries } from "./schema.ts";

export class SQLiteAuthQueries implements AuthQueries {
  constructor(private db: DB) {
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.execute(SCHEMA.USERS);
    this.db.execute(SCHEMA.SESSIONS);
    SCHEMA.INDEXES.forEach(index => this.db.execute(index));
  }

  async createUser(user: UserRow): Promise<QueryResult> {
    return await this.db.query(
      `INSERT INTO users (id, username, email, password_hash, created, updated)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.username,
        user.email,
        user.password_hash,
        user.created,
        user.updated,
      ]
    ) as QueryResult;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      "SELECT * FROM users WHERE id = ?",
      [id]
    );
    return result[0] || null;
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    return result[0] || null;
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );
    return result[0] || null;
  }

  async updateUser(id: string, updates: Partial<UserRow>): Promise<QueryResult> {
    const fields = Object.keys(updates)
      .filter(key => key !== 'id') // Prevent ID updates
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.entries(updates)
      .filter(([key]) => key !== 'id')
      .map(([_, value]) => value);

    return await this.db.query(
      `UPDATE users SET ${fields} WHERE id = ?`,
      [...values, id]
    ) as QueryResult;
  }

  async deleteUser(id: string): Promise<QueryResult> {
    return await this.db.query(
      "DELETE FROM users WHERE id = ?",
      [id]
    ) as QueryResult;
  }

  async createSession(session: SessionRow): Promise<QueryResult> {
    return await this.db.query(
      `INSERT INTO sessions (id, user_id, token, expires, created)
       VALUES (?, ?, ?, ?, ?)`,
      [
        session.id,
        session.user_id,
        session.token,
        session.expires,
        session.created,
      ]
    ) as QueryResult;
  }

  async getSessionByToken(token: string): Promise<SessionRow | null> {
    const result = await this.db.query<SessionRow>(
      "SELECT * FROM sessions WHERE token = ?",
      [token]
    );
    return result[0] || null;
  }

  async getSessionsByUserId(userId: string): Promise<SessionRow[]> {
    return await this.db.query<SessionRow>(
      "SELECT * FROM sessions WHERE user_id = ?",
      [userId]
    );
  }

  async updateSession(id: string, updates: Partial<SessionRow>): Promise<QueryResult> {
    const fields = Object.keys(updates)
      .filter(key => key !== 'id') // Prevent ID updates
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.entries(updates)
      .filter(([key]) => key !== 'id')
      .map(([_, value]) => value);

    return await this.db.query(
      `UPDATE sessions SET ${fields} WHERE id = ?`,
      [...values, id]
    ) as QueryResult;
  }

  async deleteSession(id: string): Promise<QueryResult> {
    return await this.db.query(
      "DELETE FROM sessions WHERE id = ?",
      [id]
    ) as QueryResult;
  }

  async deleteExpiredSessions(): Promise<QueryResult> {
    return await this.db.query(
      "DELETE FROM sessions WHERE expires <= ?",
      [new Date().toISOString()]
    ) as QueryResult;
  }
}