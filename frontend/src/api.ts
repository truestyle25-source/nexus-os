import axios from "axios";

// PRODUÇÃO: usa VITE_API_URL, sem fallback para localhost
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  console.error("VITE_API_URL não configurado - configure no .env");
}

export const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api` : "/api",
  headers: { "Content-Type": "application/json" },
  timeout: 15000
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem("nexus_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem("nexus_token");
      localStorage.removeItem("nexus_user");
      window.location.href = "/login";
    }
    if (error.response?.status === 402) {
      // Trial expirado ou assinatura bloqueada - redireciona para billing
      const code = error.response.data?.code;
      if (["TRIAL_EXPIRED","SUBSCRIPTION_EXPIRED","SUBSCRIPTION_BLOCKED","NO_SUBSCRIPTION"].includes(code)) {
        if (window.location.pathname !== "/billing") {
          window.location.href = `/billing?reason=${code}`;
        }
      }
    }
    return Promise.reject(error);
  }
);