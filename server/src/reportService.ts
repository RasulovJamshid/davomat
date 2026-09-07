import { pool } from "./db.js";

export type ReportType="ATTENDANCE"|"PAYROLL"|"AUDIT"|"ACCOUNTING";
export async function generateReportRows(companyId:string,type:ReportType,filters:Record<string,unknown>={}){
  const from=typeof filters.from==="string"?filters.from:null;const to=typeof filters.to==="string"?filters.to:null;
  if(type==="AUDIT")return (await pool.query(`SELECT a.created_at AS timestamp,u.email AS actor,a.action,a.entity_type,a.entity_id,a.previous_value,a.next_value FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.company_id=$1 AND a.created_at::date BETWEEN COALESCE($2::date,CURRENT_DATE-30) AND COALESCE($3::date,CURRENT_DATE) ORDER BY a.created_at`,[companyId,from,to])).rows;
  if(type==="PAYROLL"||type==="ACCOUNTING")return (await pool.query(`SELECT pp.starts_on AS period_start,pp.ends_on AS period_end,e.employee_number,e.full_name,p.base_salary,p.overtime_pay,p.night_pay,p.holiday_pay,p.benefits,p.bonuses,p.deductions,p.tax,p.employer_contributions,p.net_pay,p.status FROM payslips p JOIN payroll_periods pp ON pp.id=p.payroll_period_id JOIN employees e ON e.id=p.employee_id WHERE p.company_id=$1 AND pp.starts_on<=COALESCE($3::date,CURRENT_DATE) AND pp.ends_on>=COALESCE($2::date,CURRENT_DATE-30) ORDER BY pp.starts_on,e.full_name`,[companyId,from,to])).rows;
  return (await pool.query(`SELECT p.occurred_at,e.employee_number,e.full_name,p.event_type,p.source,p.within_geofence,p.device_id FROM punches p JOIN employees e ON e.id=p.employee_id WHERE p.company_id=$1 AND p.occurred_at::date BETWEEN COALESCE($2::date,CURRENT_DATE-30) AND COALESCE($3::date,CURRENT_DATE) ORDER BY p.occurred_at`,[companyId,from,to])).rows;
}
export function rowsToCsv(rows:Record<string,unknown>[]){if(!rows.length)return "";const columns=Object.keys(rows[0]);const quote=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;return [columns.map(quote).join(","),...rows.map(row=>columns.map(key=>quote(row[key])).join(","))].join("\n");}
