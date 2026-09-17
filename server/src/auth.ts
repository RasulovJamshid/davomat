import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { pool } from "./db.js";
import { localize } from "./localization.js";

export interface AuthClaims {
  sub: string;
  companyId: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  email: string;
  tokenVersion: number;
}

export interface AuthRequest extends Request {
  auth: AuthClaims;
}

export function signAccessToken(claims: AuthClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: "atlas-api",
    audience: "atlas-web",
  });
}

export const requireAuth: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    response
      .status(401)
      .json({
        error: {
          code: "AUTH_REQUIRED",
          message: localize(request, "Authentication required"),
        },
      });
    return;
  }
  try {
    const claims = jwt.verify(value.slice(7), config.JWT_SECRET, {
      issuer: "atlas-api",
      audience: "atlas-web",
    }) as AuthClaims;
    void pool
      .query<{
        role: AuthClaims["role"];
        email: string;
        token_version: number;
      }>(
        `SELECT role,email,token_version FROM users WHERE id=$1 AND company_id=$2 AND active=true`,
        [claims.sub, claims.companyId],
      )
      .then((result) => {
        if (!result.rows[0]) {
          response
            .status(401)
            .json({
              error: {
                code: "ACCOUNT_INACTIVE",
                message: localize(request, "User account is no longer active"),
              },
            });
          return;
        }
        if (result.rows[0].token_version !== claims.tokenVersion) {
          response
            .status(401)
            .json({
              error: {
                code: "SESSION_INVALID",
                message: localize(request, "Session expired or invalid"),
              },
            });
          return;
        }
        (request as AuthRequest).auth = {
          ...claims,
          role: result.rows[0].role,
          email: result.rows[0].email,
        };
        next();
      })
      .catch(next);
  } catch {
    response
      .status(401)
      .json({
        error: {
          code: "SESSION_INVALID",
          message: localize(request, "Session expired or invalid"),
        },
      });
  }
};

export const requireManager: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (
    !(["ADMIN", "MANAGER"] as string[]).includes(
      (request as AuthRequest).auth.role,
    )
  ) {
    response
      .status(403)
      .json({
        error: {
          code: "MANAGER_REQUIRED",
          message: localize(request, "Manager access required"),
        },
      });
    return;
  }
  next();
};
