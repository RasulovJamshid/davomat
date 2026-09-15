export interface EmployeeInput {
  name: string;
  phone: string;
  email: string;
  role: string;
  department: string;
  location: string;
  salaryType?: "MONTHLY" | "HOURLY";
  baseSalary: string;
  hourlyRate: string;
}

export type EmployeeValidationErrors = Partial<
  Record<keyof EmployeeInput, string>
>;

export function validateEmployee(
  input: EmployeeInput,
): EmployeeValidationErrors {
  const errors: EmployeeValidationErrors = {};
  if (input.name.trim().length < 2)
    errors.name = "Enter the employee’s full name";
  if (!/^\+998\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(input.phone.trim())) {
    errors.phone = "Use an Uzbekistan number such as +998 90 123 45 67";
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "Enter a valid email address";
  }
  if (!input.role) errors.role = "Select a role";
  if (!input.department) errors.department = "Select a department";
  if (!input.location) errors.location = "Select a primary location";
  const baseSalary = Number(input.baseSalary.replace(/\s/g, ""));
  const hourlyRate = Number(input.hourlyRate.replace(/\s/g, ""));
  if (
    !Number.isFinite(baseSalary) ||
    (input.salaryType === "HOURLY" ? baseSalary < 0 : baseSalary <= 0)
  )
    errors.baseSalary = "Enter a monthly salary greater than zero";
  if (
    !Number.isFinite(hourlyRate) ||
    (input.salaryType === "HOURLY" ? hourlyRate <= 0 : hourlyRate < 0)
  )
    errors.hourlyRate = "Enter a valid non-negative hourly rate";
  return errors;
}

export function hasValidationErrors(errors: EmployeeValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
