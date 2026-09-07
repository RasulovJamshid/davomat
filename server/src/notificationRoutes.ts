import { Router } from "express";
import { z } from "zod";
import type { AuthRequest } from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";

export const notificationRouter=Router();

notificationRouter.get("/notifications",asyncHandler(async(request,response)=>{
  const{sub,companyId,role}=(request as AuthRequest).auth;
  if(role==="EMPLOYEE"){
    const employee=await pool.query<{id:string}>(`SELECT id FROM employees WHERE user_id=$1 AND company_id=$2 AND status<>'INACTIVE'`,[sub,companyId]);if(!employee.rows[0])throw new HttpError(403,"No employee profile is linked to this account");
    const result=await pool.query(`WITH notices AS (
      SELECT 'leave:'||l.id AS key,CASE l.status WHEN 'PENDING' THEN 'Leave request submitted' WHEN 'APPROVED' THEN 'Leave approved' ELSE 'Leave request declined' END AS title,l.starts_on||' to '||l.ends_on AS body,COALESCE(l.resolved_at,l.created_at) AS "createdAt",'requests' AS action FROM leave_requests l WHERE l.company_id=$1 AND l.employee_id=$2 AND (l.status='PENDING' OR l.resolved_at>now()-interval '30 days')
      UNION ALL SELECT 'correction:'||x.id,CASE x.status WHEN 'PENDING' THEN 'Correction awaiting review' WHEN 'APPROVED' THEN 'Time correction approved' ELSE 'Time correction declined' END,x.details,COALESCE(x.resolved_at,x.created_at),'requests' FROM attendance_exceptions x WHERE x.company_id=$1 AND x.employee_id=$2 AND x.exception_type='CORRECTION_REQUEST' AND (x.status='PENDING' OR x.resolved_at>now()-interval '30 days')
      UNION ALL SELECT 'shift:'||s.id,'Upcoming shift',COALESCE(l.name,'Work location')||' · '||to_char(s.starts_at,'Mon DD, HH24:MI'),s.starts_at,'schedule' FROM shifts s LEFT JOIN locations l ON l.id=s.location_id WHERE s.company_id=$1 AND s.employee_id=$2 AND s.status='PUBLISHED' AND s.starts_at BETWEEN now() AND now()+interval '24 hours'
    ) SELECT n.*,r.read_at IS NOT NULL AS read FROM notices n LEFT JOIN notification_reads r ON r.user_id=$3 AND r.notification_key=n.key ORDER BY n."createdAt" DESC LIMIT 30`,[companyId,employee.rows[0].id,sub]);response.json({data:result.rows});return;
  }
  const result=await pool.query(`WITH notices AS (
    SELECT 'exception:'||x.id AS key,'Attendance exception' AS title,e.full_name||' · '||replace(lower(x.exception_type),'_',' ') AS body,x.created_at AS "createdAt",'Attendance' AS action FROM attendance_exceptions x JOIN employees e ON e.id=x.employee_id WHERE x.company_id=$1 AND x.status='PENDING'
    UNION ALL SELECT 'leave:'||l.id,'Leave request',e.full_name||' · '||l.starts_on||' to '||l.ends_on,l.created_at,'Leave' FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.company_id=$1 AND l.status='PENDING'
    UNION ALL SELECT 'payroll:'||p.id,'Payroll needs review',e.full_name||' · attendance issue',p.updated_at,'Payroll' FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.company_id=$1 AND p.status='REVIEW'
  ) SELECT n.*,r.read_at IS NOT NULL AS read FROM notices n LEFT JOIN notification_reads r ON r.user_id=$2 AND r.notification_key=n.key ORDER BY n."createdAt" DESC LIMIT 50`,[companyId,sub]);response.json({data:result.rows});
}));

const readSchema=z.object({keys:z.array(z.string().min(3).max(100)).min(1).max(100)});
notificationRouter.post("/notifications/read",asyncHandler(async(request,response)=>{const input=readSchema.parse(request.body);const{sub}=(request as AuthRequest).auth;await pool.query(`INSERT INTO notification_reads(user_id,notification_key) SELECT $1,unnest($2::text[]) ON CONFLICT(user_id,notification_key) DO UPDATE SET read_at=now()`,[sub,input.keys]);response.json({data:{read:input.keys.length}});}));
