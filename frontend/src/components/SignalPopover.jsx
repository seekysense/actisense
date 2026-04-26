import { useState, useEffect } from "react";

export function SignalPopover({ data, onClose, onChange }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!data) return null;
  const { area, sig, state } = data;
  const [local, setLocal] = useState(state);

  const save = (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(area.id, sig.id, next);
  };

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover">
        <div className="pop-head">
          <div className="pop-title">Signal override · {area.name}</div>
          <div className="pop-close" onClick={onClose}>×</div>
        </div>
        <div className="pop-sig">{sig.text}</div>
        <div className="pop-meta">
          <span className="mono">{sig.id}</span>
          <span className="dot-sep" />
          <span>Priority P{sig.priority}</span>
          <span className="dot-sep" />
          <span>{sig.source === "native_axis" ? "Native Axis" : "Embedder"}</span>
        </div>

        <div className="pop-row" style={{ borderTop: 0, paddingTop: 0 }}>
          <div>
            <div className="pop-row-label">Enabled for this area</div>
            <div className="pop-row-sub">Pause the signal without removing configuration</div>
          </div>
          <div
            className={"sig-toggle " + (local.enabled ? "on" : "")}
            style={{ width: 32, height: 18 }}
            onClick={() => save({ enabled: !local.enabled })}
          />
        </div>

        <div className="pop-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <div>
              <div className="pop-row-label">Similarity threshold</div>
              <div className="pop-row-sub">
                Default {(sig.default_threshold || 0.5).toFixed(2)} · higher = fewer false positives
              </div>
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
              {(local.threshold || 0).toFixed(2)}
            </div>
          </div>
          <input
            type="range" min="0" max="1" step="0.01"
            className="pop-slider"
            value={local.threshold || 0}
            onChange={(e) => save({ threshold: parseFloat(e.target.value) })}
          />
          <div className="pop-thr-row"><span>0.00</span><span>0.50</span><span>1.00</span></div>
        </div>

        <div className="pop-row">
          <div style={{ width: "100%" }}>
            <div className="pop-row-label">Action</div>
            <div className="pop-row-sub">Override the default action for this area only</div>
            <select
              className="pop-select"
              value={local.action || sig.default_action}
              onChange={(e) => save({ action: e.target.value })}
            >
              <option value="statistic">statistic — log only</option>
              <option value="notify">notify — send to queue</option>
              <option value="alarm">alarm — immediate escalation</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
}
