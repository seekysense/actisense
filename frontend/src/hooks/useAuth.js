import { useState, useCallback } from "react";
import { api } from "../api/client.js";

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem("vsa_token"));
  const [username, setUsername] = useState(() => localStorage.getItem("vsa_username") || "");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (user, pass) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.login(user, pass);
      localStorage.setItem("vsa_token", data.access_token);
      localStorage.setItem("vsa_username", data.username || user);
      setToken(data.access_token);
      setUsername(data.username || user);
      return true;
    } catch (_) {
      setError("Incorrect username or password");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("vsa_token");
    localStorage.removeItem("vsa_username");
    setToken(null);
    setUsername("");
  }, []);

  return { token, username, error, loading, login, logout };
}
