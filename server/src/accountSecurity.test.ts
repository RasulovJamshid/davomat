import { describe,expect,it } from "vitest";
import { createAccountToken,hashAccountToken } from "./accountSecurity.js";

describe("account recovery tokens",()=>{
  it("creates unpredictable 256-bit tokens without storing the secret",()=>{
    const first=createAccountToken();const second=createAccountToken();
    expect(first).toMatch(/^[a-f0-9]{64}$/);expect(second).not.toBe(first);
    expect(hashAccountToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAccountToken(first)).not.toBe(first);
  });
  it("hashes the same token consistently",()=>expect(hashAccountToken("a".repeat(64))).toBe(hashAccountToken("a".repeat(64))));
});
