import { Database } from "./database";
import { SCHEMA, UserRow, SessionRow, QueryResult, AuthQueries } from "./schema";

export class SQLiteAuthQueries implements AuthQueries {
  constructor(private db: Database) {
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.execute(SCHEMA.USERS);
    this.db.execute(SCHEMA.SESSIONS);
    SCHEMA.INDEXES.forEach(index => this.db.execute(index));
  }

  createUser(user: UserRow): QueryResult {
    return this.db.query<QueryResult>(
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
    )[0];
  }

  getUserById(id: string): UserRow | null {
    const result = this.db.query<UserRow>(
      "SELECT * FROM users WHERE id = ?",
      [id]
    );
    return result[0] || null;
  }

  getUserByUsername(username: string): UserRow | null {
    const result = this.db.query<UserRow>(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    return result[0] || null;
  }

  getUserByEmail(email: string): UserRow | null {
    const result = this.db.query<UserRow>(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );
    return result[0] || null;
  }

  updateUser(id: string, updates: Partial<UserRow>): QueryResult {
    const fields = Object.keys(updates)
      .filter(key => key !== 'id') // Prevent ID updates
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.entries(updates)
      .filter(([key]) => key !== 'id')
      .map(([_, value]) => value);

    return this.db.query<QueryResult>(
      `UPDATE users SET ${fields} WHERE id = ?`,
      [...values, id]
    )[0];
  }

  deleteUser(id: string): QueryResult {
    return this.db.query<QueryResult>(
      "DELETE FROM users WHERE id = ?",
      [id]
    )[0];
  }

  createSession(session: SessionRow): QueryResult {
    return this.db.query<QueryResult>(
      `INSERT INTO sessions (id, user_id, token, expires, created)
       VALUES (?, ?, ?, ?, ?)`,
      [
        session.id,
        session.user_id,
        session.token,
        session.expires,
        session.created,
      ]
    )[0];
  }

  getSessionByToken(token: string): SessionRow | null {
    const result = this.db.query<SessionRow>(
      "SELECT * FROM sessions WHERE token = ?",
      [token]
    );
    return result[0] || null;
  }

  getSessionsByUserId(userId: string): SessionRow[] {
    return this.db.query<SessionRow>(
      "SELECT * FROM sessions WHERE user_id = ?",
      [userId]
    );
  }

  updateSession(id: string, updates: Partial<SessionRow>): QueryResult {
    const fields = Object.keys(updates)
      .filter(key => key !== 'id') // Prevent ID updates
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.entries(updates)
      .filter(([key]) => key !== 'id')
      .map(([_, value]) => value);

    return this.db.query<QueryResult>(
      `UPDATE sessions SET ${fields} WHERE id = ?`,
      [...values, id]
    )[0];
  }

  deleteSession(id: string): QueryResult {
    return this.db.query<QueryResult>(
      "DELETE FROM sessions WHERE id = ?",
      [id]
    )[0];
  }

  deleteExpiredSessions(): QueryResult {
    return this.db.query<QueryResult>(
      "DELETE FROM sessions WHERE expires <= ?",
      [new Date().toISOString()]
    )[0];
  }
}