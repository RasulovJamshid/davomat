export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  mustChangePassword?:boolean;
  company: { id: string; name: string };
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "atlas.accessToken";

export const sessionStore = {
  getToken: () => localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY),
  setToken: (token: string, persistent = true) => {
    localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
    (persistent ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  },
  clear: () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); },
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string[]>) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStore.getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": localStorage.getItem("atlas.locale") ?? "en",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; fields?: Record<string, string[]> } };
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") sessionStore.clear();
    throw new ApiError(body.error?.message ?? "Request failed", response.status, body.error?.fields);
  }
  return body.data as T;
}

export async function downloadApiFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { headers: {
    ...(sessionStore.getToken() ? { Authorization: `Bearer ${sessionStore.getToken()}` } : {}),
    "Accept-Language": localStorage.getItem("atlas.locale") ?? "en",
  }});
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new ApiError(body.error?.message ?? "Request failed", response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string, persistent = true): Promise<LoginResponse> {
  const result = await apiRequest<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  sessionStore.setToken(result.token, persistent);
  return result;
}

export const requestPasswordReset=(email:string)=>apiRequest<{accepted:boolean;message:string}>("/auth/forgot-password",{method:"POST",body:JSON.stringify({email})});
export const resetPassword=(token:string,newPassword:string)=>apiRequest<{changed:boolean}>("/auth/reset-password",{method:"POST",body:JSON.stringify({token,newPassword})});

export async function getCurrentUser(): Promise<SessionUser> {
  const result = await apiRequest<{ id: string; email: string; displayName: string; role: SessionUser["role"];mustChangePassword:boolean; companyId: string; companyName: string }>("/auth/me");
  return { id: result.id, email: result.email, displayName: result.displayName, role: result.role,mustChangePassword:result.mustChangePassword, company: { id: result.companyId, name: result.companyName } };
}
