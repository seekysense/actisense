import { useState } from "react";

export function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const ok = await onLogin(username, password);
    if (!ok) setError("Incorrect username or password");
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.svg" className="site-brand-logo" alt="" />
          <div>
            <div className="login-brand-name">H4H Visual AI</div>
            <div className="login-brand-tag">Operations Console</div>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <div className="login-label">Username</div>
            <input
              className="login-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="login-field">
            <div className="login-label">Password</div>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
