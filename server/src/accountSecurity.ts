import { createHash, randomBytes } from "node:crypto";

export const createAccountToken = () => randomBytes(32).toString("hex");
export const hashAccountToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
