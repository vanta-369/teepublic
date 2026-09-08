"use client";

import { useState } from "react";

// Backend-free contact form: composes a mailto so no server route is needed.
// Replace SUPPORT_EMAIL with the real inbox.
const SUPPORT_EMAIL = "support@higgstee.com";

const TOPICS = ["General question", "Billing / upgrade", "Extension help", "Something else"];

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`[${topic}] from ${name || "Higgstee visitor"}`);
    const body = encodeURIComponent(`${message}\n\n— ${name}\n${email}`);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <form onSubmit={onSubmit} className="surface p-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input font-mono" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="topic">Topic</label>
        <select id="topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="message">Message</label>
        <textarea id="message" className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)} required />
      </div>
      <button type="submit" className="btn-primary w-full">Send message</button>
      <p className="text-center text-xs text-zinc-500">
        Or email us directly at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent-500 hover:text-accent-400">{SUPPORT_EMAIL}</a>
      </p>
    </form>
  );
}
