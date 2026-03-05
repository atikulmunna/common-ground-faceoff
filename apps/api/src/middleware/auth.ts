import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/auth.js";

export interface AuthUser {
  id: string;
  email: string;
  role: "individual_user" | "session_creator" | "session_participant" | "institutional_admin" | "moderator";
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      data: null,
      error: { code: "auth_error", message: "Missing or invalid Authorization header" }
    });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: (payload.role as AuthUser["role"]) ?? "individual_user"
    };
    next();
  } catch {
    res.status(401).json({
      success: false,
      data: null,
      error: { code: "auth_error", message: "Invalid or expired token" }
    });
  }
}
