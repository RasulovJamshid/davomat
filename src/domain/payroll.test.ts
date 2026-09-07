import { describe, expect, it } from "vitest";
import { calculatePayroll, formatUzs } from "./payroll";

describe("payroll calculation", () => {
  it("calculates overtime using minutes and a multiplier", () => {
    const result = calculatePayroll({ baseSalary: 5_000_000, hourlyRate: 30_000, overtimeMinutes: 90, overtimeMultiplier: 1.5, bonuses: 0, deductions: 0, tax: 0 });
    expect(result.overtimePay).toBe(67_500);
  });

  it("calculates gross and net pay from explicit line items", () => {
    const result = calculatePayroll({ baseSalary: 5_000_000, hourlyRate: 30_000, overtimeMinutes: 120, overtimeMultiplier: 1.5, bonuses: 250_000, deductions: 75_000, tax: 600_000 });
    expect(result.grossPay).toBe(5_340_000);
    expect(result.netPay).toBe(4_665_000);
  });

  it("never produces a negative net payment", () => {
    const result = calculatePayroll({ baseSalary: 100_000, hourlyRate: 0, overtimeMinutes: 0, overtimeMultiplier: 1, bonuses: 0, deductions: 200_000, tax: 0 });
    expect(result.netPay).toBe(0);
  });

  it("formats Uzbek currency without decimals", () => {
    expect(formatUzs(1_250_000)).toContain("1");
    expect(formatUzs(1_250_000)).toContain("UZS");
  });
});
