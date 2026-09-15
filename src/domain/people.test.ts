import { describe, expect, it } from "vitest";
import {
  hasValidationErrors,
  validateEmployee,
  type EmployeeInput,
} from "./people";

const validEmployee: EmployeeInput = {
  name: "Aziza Karimova",
  phone: "+998 90 123 45 67",
  email: "aziza@example.uz",
  role: "Sales lead",
  department: "Sales",
  location: "Yunusobod",
  baseSalary: "6200000",
  hourlyRate: "35000",
};

describe("employee validation", () => {
  it("allows hourly pay without a fixed salary, but requires a positive hourly rate", () => {
    expect(
      validateEmployee({
        ...validEmployee,
        salaryType: "HOURLY",
        baseSalary: "0",
        hourlyRate: "30000",
      }),
    ).toEqual({});
    expect(
      validateEmployee({
        ...validEmployee,
        salaryType: "HOURLY",
        baseSalary: "0",
        hourlyRate: "0",
      }).hourlyRate,
    ).toBeDefined();
    expect(
      validateEmployee({
        ...validEmployee,
        salaryType: "MONTHLY",
        baseSalary: "0",
      }).baseSalary,
    ).toBeDefined();
  });
  it("accepts a complete Uzbekistan employee profile", () => {
    expect(validateEmployee(validEmployee)).toEqual({});
  });

  it("allows email to be omitted", () => {
    expect(
      validateEmployee({ ...validEmployee, email: "" }).email,
    ).toBeUndefined();
  });

  it("rejects an invalid phone number", () => {
    expect(
      validateEmployee({ ...validEmployee, phone: "123" }).phone,
    ).toBeDefined();
  });

  it("requires organization assignments", () => {
    const errors = validateEmployee({
      ...validEmployee,
      role: "",
      department: "",
      location: "",
    });
    expect(hasValidationErrors(errors)).toBe(true);
    expect(Object.keys(errors)).toHaveLength(3);
  });
});
