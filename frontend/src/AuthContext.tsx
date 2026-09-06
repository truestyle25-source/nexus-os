import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "./api";

interface Subscription {
  status: string;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  daysLeft?: number;
  plan?: any;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
}

interface AuthContextType {
  user: User | null;
  subscription: Subscription | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  refreshSubscription: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("nexus_token");
    const savedUser = localStorage.getItem("nexus_user");
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      refreshSubscription();
    }
    setLoading(false);
  }, []);

  async function refreshSubscription() {
    try {
      const { data } = await api.get("/billing/status");
      setSubscription(data);
    } catch {}
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("nexus_token", data.token);
    localStorage.setItem("nexus_user", JSON.stringify(data.user));
    setUser(data.user);
    setSubscription(data.subscription);
  }

  async function register(payload: any) {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("nexus_token", data.token);
    localStorage.setItem("nexus_user", JSON.stringify(data.user));
    setUser(data.user);
    setSubscription(data.subscription);
  }

  function logout() {
    localStorage.clear();
    setUser(null);
    setSubscription(null);
    window.location.href = "/login";
  }

  return <AuthContext.Provider value={{ user, subscription, loading, login, register, logout, refreshSubscription }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);