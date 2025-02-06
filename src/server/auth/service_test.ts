import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { AuthService, AuthError } from "./service.ts";
import { SQLiteDatabaseService } from "../db/service.ts";
import { SQLiteAuthQueries } from "../db/auth_queries.ts";

const TEST_DB = ":memory:";
const TEST_JWT_SECRET = "test-secret-key-for-jwt-tokens";

function createTestServices() {
  const db = new SQLiteDatabaseService(TEST_DB);
  const authQueries = new SQLiteAuthQueries(db.getDatabase());
  const auth = new AuthService(authQueries, TEST_JWT_SECRET);
  return { db, auth };
}

Deno.test("AuthService - User Registration", async (t) => {
  const { auth } = createTestServices();

  await t.step("Register Valid User", async () => {
    const user = await auth.registerUser({
      username: "testuser",
      email: "test@example.com",
      password: "password123",
    });

    assertExists(user.id);
    assertEquals(user.username, "testuser");
    assertEquals(user.email, "test@example.com");
  });

  await t.step("Reject Duplicate Username", async () => {
    await assertRejects(
      () =>
        auth.registerUser({
          username: "testuser",
          email: "different@example.com",
          password: "password123",
        }),
      AuthError,
      "DUPLICATE_USER"
    );
  });

  await t.step("Reject Duplicate Email", async () => {
    await assertRejects(
      () =>
        auth.registerUser({
          username: "different",
          email: "test@example.com",
          password: "password123",
        }),
      AuthError,
      "DUPLICATE_USER"
    );
  });

  await t.step("Reject Weak Password", async () => {
    await assertRejects(
      () =>
        auth.registerUser({
          username: "newuser",
          email: "new@example.com",
          password: "weak",
        }),
      AuthError,
      "INVALID_PASSWORD"
    );
  });
});

Deno.test("AuthService - User Authentication", async (t) => {
  const { auth } = createTestServices();

  // Register a test user first
  await auth.registerUser({
    username: "testuser",
    email: "test@example.com",
    password: "password123",
  });

  await t.step("Login Valid User", async () => {
    const session = await auth.loginUser("testuser", "password123");
    assertExists(session.token);
    assertExists(session.expires);
    assertEquals(typeof session.userId, "string");
  });

  await t.step("Reject Invalid Password", async () => {
    await assertRejects(
      () => auth.loginUser("testuser", "wrongpassword"),
      AuthError,
      "INVALID_CREDENTIALS"
    );
  });

  await t.step("Reject Non-existent User", async () => {
    await assertRejects(
      () => auth.loginUser("nonexistent", "password123"),
      AuthError,
      "INVALID_CREDENTIALS"
    );
  });
});

Deno.test("AuthService - Session Management", async (t) => {
  const { auth } = createTestServices();

  // Register and login a test user
  await auth.registerUser({
    username: "testuser",
    email: "test@example.com",
    password: "password123",
  });

  const session = await auth.loginUser("testuser", "password123");

  await t.step("Validate Valid Session", async () => {
    const userId = await auth.validateSession(session.token);
    assertEquals(typeof userId, "string");
  });

  await t.step("Refresh Session", async () => {
    const newSession = await auth.refreshSession(session.token);
    assertExists(newSession.token);
    assertEquals(typeof newSession.userId, "string");
    assertEquals(newSession.userId, session.userId);
  });

  await t.step("Logout User", async () => {
    await auth.logoutUser(session.token);
    await assertRejects(
      () => auth.validateSession(session.token),
      AuthError,
      "INVALID_SESSION"
    );
  });

  await t.step("Reject Invalid Token", async () => {
    await assertRejects(
      () => auth.validateSession("invalid-token"),
      AuthError,
      "INVALID_TOKEN"
    );
  });
});

Deno.test("AuthService - Session Expiry", async (t) => {
  const { auth } = createTestServices();

  // Register and login a test user
  await auth.registerUser({
    username: "testuser",
    email: "test@example.com",
    password: "password123",
  });

  const session = await auth.loginUser("testuser", "password123");

  await t.step("Expire Session", async () => {
    // Simulate session expiration by waiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Force session expiration in database
    await auth["db"].deleteExpiredSessions();

    await assertRejects(
      () => auth.validateSession(session.token),
      AuthError,
      "INVALID_SESSION"
    );
  });
});