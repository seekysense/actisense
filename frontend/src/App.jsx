import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./hooks/useAuth.js";
import { Login } from "./pages/Login.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Events } from "./pages/Events.jsx";
import { Config } from "./pages/Config.jsx";
import { Setup } from "./pages/Setup.jsx";
import SiteSettings from "./pages/SiteSettings.jsx";
import Logs from "./pages/Logs.jsx";
import "./index.css";

function NavBar({ username, onLogout }) {
  const loc = useLocation();
  const linkStyle = (path) => ({
    color: loc.pathname === path ? "var(--accent)" : "var(--ink-3)",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 500,
  });
  return (
    <nav style={{
      display: "none",
    }} />
  );
}

function RequireAuth({ token, children }) {
  const loc = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

export function App() {
  const { token, username, login, logout } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            token
              ? <Navigate to="/" replace />
              : <Login onLogin={login} />
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth token={token}>
              <Dashboard username={username} onLogout={logout} />
            </RequireAuth>
          }
        />
        <Route
          path="/events"
          element={
            <RequireAuth token={token}>
              <PageShell username={username} onLogout={logout}>
                <Events />
              </PageShell>
            </RequireAuth>
          }
        />
        <Route
          path="/config"
          element={
            <RequireAuth token={token}>
              <PageShell username={username} onLogout={logout}>
                <Config />
              </PageShell>
            </RequireAuth>
          }
        />
        <Route
          path="/setup"
          element={
            <RequireAuth token={token}>
              <Setup username={username} onLogout={logout} />
            </RequireAuth>
          }
        />
        <Route
          path="/setup/site"
          element={
            <RequireAuth token={token}>
              <SiteSettings />
            </RequireAuth>
          }
        />
        <Route
          path="/logs"
          element={
            <RequireAuth token={token}>
              <Logs />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function PageShell({ children, username, onLogout }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <nav style={{
        background: "var(--bg-2)",
        borderBottom: "1px solid var(--line)",
        padding: "10px 28px",
        display: "flex",
        alignItems: "center",
        gap: 24,
      }}>
        <Link to="/" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none", fontSize: 14 }}>
          ← H4H
        </Link>
        <Link to="/events" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: 13 }}>Events</Link>
        <Link to="/config" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: 13 }}>Config</Link>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" }}>{username}</div>
        <button
          onClick={onLogout}
          style={{ appearance: "none", border: "1px solid var(--line-2)", background: "transparent", padding: "3px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "var(--ink-3)" }}
        >
          Logout
        </button>
      </nav>
      {children}
    </div>
  );
}
