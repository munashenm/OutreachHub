import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipRole } from "../generated/prisma/client";
import { getDb, isUniqueViolation, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import { slugify } from "../lib/password";
import { COOKIE_NAME, readSessionToken, signSessionToken } from "../lib/session-token";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionContext = {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; slug: string; isDemo: boolean };
  role: MembershipRole;
  memberships: { workspaceId: string; workspaceName: string; role: MembershipRole }[];
};

let dummyPasswordHash: string | undefined;

function getDummyPasswordHash() {
  dummyPasswordHash ??= bcrypt.hashSync("outreachhub-invalid-login", 12);
  return dummyPasswordHash;
}

function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function writeSession(userId: string, workspaceId: string) {
  const token = await signSessionToken({ userId, workspaceId });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token);
  if (!session) return null;

  const membership = await getDb().membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: session.userId,
        workspaceId: session.workspaceId,
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true, isDemo: true } },
    },
  });
  if (!membership) return null;

  const memberships = await getDb().membership.findMany({
    where: { userId: membership.userId },
    include: { workspace: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return {
    user: membership.user,
    workspace: membership.workspace,
    role: membership.role,
    memberships: memberships.map((item) => ({
      workspaceId: item.workspaceId,
      workspaceName: item.workspace.name,
      role: item.role,
    })),
  };
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  return session;
}

export function assertCanManageWorkspace(role: MembershipRole) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new AppError("You do not have permission to change this workspace.", 403, "FORBIDDEN");
  }
}

async function createWorkspace(db: DbClient, userId: string, name: string) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base.slice(0, 40)}-${attempt + 1}`;
    try {
      return await db.workspace.create({
        data: {
          name,
          slug,
          memberships: { create: { userId, role: "OWNER" } },
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("A workspace with a similar name already exists. Try a different name.");
}

export async function registrationOpen() {
  const users = await getDb().user.count();
  return users === 0;
}

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const created = await getDb().$transaction(async (tx) => {
      const users = await tx.user.count();
      if (users > 0) {
        throw new AppError("The Urban Focus account already exists. Sign in instead.", 403, "FORBIDDEN");
      }
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, passwordHash },
      });
      const workspace = await createWorkspace(tx, user.id, input.workspaceName);
      return { userId: user.id, workspaceId: workspace.id };
    });
    await writeSession(created.userId, created.workspaceId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("An account with this email already exists.");
    }
    throw error;
  }
}

export async function loginAccount(email: string, password: string) {
  const user = await getDb().user.findUnique({ where: { email } });
  const matches = await bcrypt.compare(password, user?.passwordHash ?? getDummyPasswordHash());
  if (!user || !matches) {
    throw new AppError("Invalid email or password.", 401, "INVALID_LOGIN");
  }
  const membership = await getDb().membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) {
    throw new AppError("This account is not a member of a workspace.", 403, "FORBIDDEN");
  }
  await writeSession(user.id, membership.workspaceId);
}

export async function logoutAccount() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function requestPasswordReset(email: string) {
  const user = await getDb().user.findUnique({ where: { email } });
  if (!user) return {};

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await getDb().passwordResetToken.deleteMany({ where: { userId: user.id } });
  await getDb().passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const devResetUrl = `${appUrl()}/reset-password?token=${token}`;
  if (process.env.NODE_ENV !== "production") {
    console.info(`Development password reset link: ${devResetUrl}`);
    return { devResetUrl };
  }
  console.error("Password reset was requested, but outbound email is not configured.");
  return {};
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await getDb().passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new AppError("This reset link is invalid or has expired.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await getDb().$transaction([
    getDb().user.update({ where: { id: record.userId }, data: { passwordHash } }),
    getDb().passwordResetToken.deleteMany({ where: { userId: record.userId } }),
  ]);
}

export async function switchWorkspace(userId: string, workspaceId: string) {
  const membership = await getDb().membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) {
    throw new AppError("You are not a member of that workspace.", 403, "FORBIDDEN");
  }
  await writeSession(userId, workspaceId);
}

export async function createAdditionalWorkspace(userId: string, name: string) {
  const workspace = await getDb().$transaction((tx) => createWorkspace(tx, userId, name));
  await writeSession(userId, workspace.id);
  return workspace;
}

export async function renameWorkspace(workspaceId: string, name: string) {
  await getDb().workspace.update({ where: { id: workspaceId }, data: { name } });
}
