import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

// Demo user for local development. Replace with a real user store before production use.
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD_HASH = bcrypt.hashSync("password123", 10);

export function verifyCredentials(username: string, password: string): boolean {
  if (username !== DEMO_USERNAME) return false;
  return bcrypt.compareSync(password, DEMO_PASSWORD_HASH);
}

export { JWT_SECRET };
