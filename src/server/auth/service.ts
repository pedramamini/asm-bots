import { create, verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.208.0/encoding/hex.ts";
import type { DatabaseService } from "../db/service.ts";
import type { UserRow, SessionRow } from "../db/schema.ts";

export interface UserCreateRequest {
  username: string;
  email: string;
  password: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  created: Date;
  updated: Date;
}

export interface Session {
  userId: string;
  token: string;
  expires: Date;
}

export class AuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly SALT_LENGTH = 16;
  private readonly TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  private readonly JWT_KEY: Promise<CryptoKey>;

  constructor(
    private db: DatabaseService,
    jwtSecret: string
  ) {
    // Convert JWT secret to CryptoKey
    const encoder = new TextEncoder();
    const keyData = encoder.encode(jwtSecret);
    this.JWT_KEY = crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }

  private async hashPassword(password: string, salt?: string): Promise<[string, string]> {
    const saltBytes = salt
      ? new TextEncoder().encode(salt)
      : crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));

    const passwordBytes = new TextEncoder().encode(password);
    const combinedBytes = new Uint8Array(saltBytes.length + passwordBytes.length);
    combinedBytes.set(saltBytes);
    combinedBytes.set(passwordBytes, saltBytes.length);

    const hashBuffer = await crypto.subtle.digest("SHA-256", combinedBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return [hashHex, encodeHex(saltBytes)];
  }

  private async generateToken(userId: string): Promise<string> {
    const payload = {
      sub: userId,
      exp: Date.now() + this.TOKEN_EXPIRY,
    };

    return await create(
      { alg: "HS256", typ: "JWT" },
      payload,
      await this.JWT_KEY
    );
  }

  private async verifyToken(token: string): Promise<string> {
    try {
      const payload = await verify(token, await this.JWT_KEY);
      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new AuthError("Invalid token payload", "INVALID_TOKEN");
      }
      return payload.sub;
    } catch (error) {
      throw new AuthError("Invalid or expired token", "INVALID_TOKEN");
    }
  }

  async registerUser(userData: UserCreateRequest): Promise<User> {
    // Validate input
    if (!userData.username || !userData.email || !userData.password) {
      throw new AuthError("Missing required fields", "INVALID_INPUT");
    }

    if (userData.password.length < 8) {
      throw new AuthError("Password must be at least 8 characters", "INVALID_PASSWORD");
    }

    // Check for existing user
    const existingUser = await this.db.getUserByUsername(userData.username);
    if (existingUser) {
      throw new AuthError("Username already exists", "DUPLICATE_USER");
    }

    const existingEmail = await this.db.getUserByEmail(userData.email);
    if (existingEmail) {
      throw new AuthError("Email already exists", "DUPLICATE_USER");
    }

    // Hash password
    const [hash, salt] = await this.hashPassword(userData.password);

    const user: UserRow = {
      id: crypto.randomUUID(),
      username: userData.username,
      email: userData.email,
      password_hash: `${salt}:${hash}`,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    try {
      await this.db.createUser(user);
      const { password_hash, ...userWithoutPassword } = user;
      return {
        ...userWithoutPassword,
        created: new Date(user.created),
        updated: new Date(user.updated),
      };
    } catch (error) {
      throw new AuthError("Failed to create user", "DATABASE_ERROR");
    }
  }

  async loginUser(username: string, password: string): Promise<Session> {
    try {
      // Get user from database
      const user = await this.db.getUserByUsername(username);
      if (!user) {
        throw new AuthError("Invalid username or password", "INVALID_CREDENTIALS");
      }

      const [salt, storedHash] = user.password_hash.split(':');
      const [hash] = await this.hashPassword(password, salt);

      if (hash !== storedHash) {
        throw new AuthError("Invalid username or password", "INVALID_CREDENTIALS");
      }

      // Generate session token
      const token = await this.generateToken(user.id);
      const expires = new Date(Date.now() + this.TOKEN_EXPIRY);

      const session: SessionRow = {
        id: crypto.randomUUID(),
        user_id: user.id,
        token,
        expires: expires.toISOString(),
        created: new Date().toISOString(),
      };

      await this.db.createSession(session);

      return {
        userId: user.id,
        token,
        expires,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("Login failed", "DATABASE_ERROR");
    }
  }

  async validateSession(token: string): Promise<string> {
    const userId = await this.verifyToken(token);

    try {
      const session = await this.db.getSessionByToken(token);
      if (!session || new Date(session.expires) <= new Date()) {
        throw new AuthError("Session expired", "INVALID_SESSION");
      }

      return userId;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("Failed to validate session", "DATABASE_ERROR");
    }
  }

  async logoutUser(token: string): Promise<void> {
    try {
      const session = await this.db.getSessionByToken(token);
      if (session) {
        await this.db.deleteSession(session.id);
      }
    } catch (error) {
      throw new AuthError("Failed to logout", "DATABASE_ERROR");
    }
  }

  async refreshSession(token: string): Promise<Session> {
    const userId = await this.validateSession(token);

    try {
      // Generate new token
      const newToken = await this.generateToken(userId);
      const expires = new Date(Date.now() + this.TOKEN_EXPIRY);

      const session = await this.db.getSessionByToken(token);
      if (!session) {
        throw new AuthError("Session not found", "INVALID_SESSION");
      }

      const updatedSession: Partial<SessionRow> = {
        token: newToken,
        expires: expires.toISOString(),
      };

      await this.db.updateSession(session.id, updatedSession);

      return {
        userId,
        token: newToken,
        expires,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("Failed to refresh session", "DATABASE_ERROR");
    }
  }
}