UPDATE users u SET role=CASE e.access_role WHEN 'ADMINISTRATOR' THEN 'ADMIN' WHEN 'LOCATION_MANAGER' THEN 'MANAGER' ELSE 'EMPLOYEE' END,token_version=token_version+1,updated_at=now()
FROM employees e WHERE e.user_id=u.id AND u.role<>CASE e.access_role WHEN 'ADMINISTRATOR' THEN 'ADMIN' WHEN 'LOCATION_MANAGER' THEN 'MANAGER' ELSE 'EMPLOYEE' END;
