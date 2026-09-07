export interface PayrollInput {
  baseSalary: number;
  hourlyRate: number;
  overtimeMinutes: number;
  overtimeMultiplier: number;
  bonuses: number;
  deductions: number;
  tax: number;
}

export interface PayrollResult {
  overtimePay: number;
  grossPay: number;
  netPay: number;
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const overtimePay = Math.round(
    input.hourlyRate * (input.overtimeMinutes / 60) * input.overtimeMultiplier,
  );
  const grossPay = input.baseSalary + overtimePay + input.bonuses;
  const netPay = Math.max(0, grossPay - input.deductions - input.tax);
  return { overtimePay, grossPay, netPay };
}

export function formatUzs(amount: number): string {
  return `${new Intl.NumberFormat("uz-UZ").format(amount)} UZS`;
}
