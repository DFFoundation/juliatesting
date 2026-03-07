// src/components/UI.js
import React from "react";

export function Badge({ children, variant = "default", style }) {
  const variants = {
    default: { background: "#f0efe9", color: "#4a4840", border: "1px solid #e2e0d8" },
    green: { background: "#edf7f1", color: "#1a7a4a", border: "1px solid #b8e8cc" },
    red: { background: "#fdf0ee", color: "#c0392b", border: "1px solid #f5c0b8" },
    amber: { background: "#fef8ed", color: "#b45309", border: "1px solid #f5dfa0" },
    blue: { background: "#eef4fc", color: "#1d5fa8", border: "1px solid #b8d4f0" },
    navy: { background: "#e8edf5", color: "#1b3254", border: "1px solid #b0c0d8" },
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      whiteSpace: "nowrap",
      ...variants[variant],
      ...style,
    }}>
      {children}
    </span>
  );
}

export function Button({ children, onClick, variant = "default", size = "md", disabled, style, title }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 6,
    borderRadius: 6, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.12s", border: "none", whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
  };
  const sizes = {
    sm: { padding: "4px 10px", fontSize: 12 },
    md: { padding: "7px 14px", fontSize: 13 },
    lg: { padding: "10px 20px", fontSize: 14 },
  };
  const variants = {
    default: { background: "#fff", color: "#1a1a18", border: "1px solid #e2e0d8", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
    primary: { background: "#1b3254", color: "#fff" },
    success: { background: "#1a7a4a", color: "#fff" },
    danger: { background: "#c0392b", color: "#fff" },
    ghost: { background: "transparent", color: "#4a4840" },
  };
  return (
    <button onClick={disabled ? undefined : onClick} title={title} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function Card({ children, style, className }) {
  return (
    <div className={className} style={{
      background: "#fff",
      border: "1px solid #e2e0d8",
      borderRadius: 8,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      ...style,
    }}>
      {children}
    </div>
  );
}

export function Input({ value, onChange, placeholder, style, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        padding: "7px 11px",
        border: "1px solid #e2e0d8",
        borderRadius: 6,
        fontSize: 13,
        background: "#fff",
        color: "#1a1a18",
        width: "100%",
        ...style,
      }}
    />
  );
}

export function Select({ value, onChange, children, style }) {
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        padding: "7px 11px",
        border: "1px solid #e2e0d8",
        borderRadius: 6,
        fontSize: 13,
        background: "#fff",
        color: "#1a1a18",
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </select>
  );
}

export function Spinner({ size = 16, color = "#1b3254" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#8a8778" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 15, color: "#4a4840", marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13 }}>{subtitle}</div>}
    </div>
  );
}

export function StatusDot({ status }) {
  const colors = {
    approved: "#1a7a4a",
    pending: "#b45309",
    excluded: "#c0392b",
    running: "#1d5fa8",
    complete: "#1a7a4a",
    error: "#c0392b",
  };
  return (
    <span style={{
      display: "inline-block",
      width: 7, height: 7,
      borderRadius: "50%",
      background: colors[status] || "#8a8778",
      flexShrink: 0,
    }} />
  );
}

export function SectionHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1a1a18" }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: "#8a8778", marginTop: 2 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>{actions}</div>}
    </div>
  );
}

export function Divider({ style }) {
  return <div style={{ height: 1, background: "#e2e0d8", ...style }} />;
}
