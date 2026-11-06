"use client";

import { FormEvent, useState } from "react";
import { BUDGET_OPTIONS, SERVICE_LABELS } from "@/lib/labels";
import type { ServiceInterest } from "@/lib/types";

const SERVICES = Object.keys(SERVICE_LABELS) as ServiceInterest[];

export function LeadForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload = {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      company: String(formData.get("company") ?? ""),
      website: String(formData.get("website") ?? ""),
      service: String(formData.get("service") ?? ""),
      budget: String(formData.get("budget") ?? ""),
      message: String(formData.get("message") ?? ""),
      source: "website",
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="lead-success" role="status">
        <p className="lead-success-title">Brief received.</p>
        <p className="lead-success-body">
          Thanks for reaching out to ASA Scaliq. Our team will review your
          project and get back within one business day.
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setStatus("idle")}
        >
          Submit another brief
        </button>
      </div>
    );
  }

  return (
    <form className="lead-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <label>
          <span>Full name</span>
          <input name="name" type="text" autoComplete="name" required />
        </label>
        <label>
          <span>Work email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" type="tel" autoComplete="tel" required />
        </label>
        <label>
          <span>Company</span>
          <input name="company" type="text" autoComplete="organization" required />
        </label>
        <label>
          <span>Website</span>
          <input name="website" type="url" placeholder="https://" />
        </label>
        <label>
          <span>Service interest</span>
          <select name="service" required defaultValue="">
            <option value="" disabled>
              Select a focus
            </option>
            {SERVICES.map((key) => (
              <option key={key} value={key}>
                {SERVICE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>Approximate budget</span>
          <select name="budget" defaultValue="">
            <option value="">Optional</option>
            {BUDGET_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>Project brief</span>
          <textarea
            name="message"
            rows={4}
            required
            placeholder="What are you launching, who is it for, and what should success look like?"
          />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button
        type="submit"
        className="btn-primary"
        disabled={status === "loading"}
      >
        {status === "loading" ? "Sending brief…" : "Send project brief"}
      </button>
    </form>
  );
}
