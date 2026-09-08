"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ChangePassword() {
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password !== confirm) {
      setMsg({ ok: false, text: "Passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMsg({ ok: true, text: "Password updated." });
      setPassword("");
      setConfirm("");
    } catch {
      setMsg({ ok: false, text: "Couldn't update password. Try signing out and in again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="np">New password</label>
        <input id="np" type="password" className="input font-mono" minLength={8} required
          value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="cp">Confirm password</label>
        <input id="cp" type="password" className="input font-mono" minLength={8} required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {msg && <div className={msg.ok ? "chip-ok" : "chip-err"}>{msg.text}</div>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
