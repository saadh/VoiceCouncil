import { useState } from "react";
import type { IntakeInput } from "../lib/api";

// Phase 0: structured intake. Role required; JD + resume optional paste.
export default function IntakeForm({
  onSubmit,
  busy,
}: {
  onSubmit: (input: IntakeInput) => void;
  busy?: boolean;
}) {
  const [role, setRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [resume, setResume] = useState("");

  const canSubmit = role.trim().length > 0 && !busy;

  return (
    <form
      className="card intake"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ role, jobDescription, resume });
      }}
    >
      <h2>Set up your mock interview</h2>
      <p className="muted">
        The panel tailors its questions to this. Role is required; paste the job
        description and your resume for sharper, personalized questions.
      </p>

      <label>
        Role <span className="req">*</span>
        <input
          type="text"
          placeholder="e.g. Senior Backend Engineer at a fintech"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          autoFocus
        />
      </label>

      <label>
        Job description <span className="muted">(optional)</span>
        <textarea
          rows={4}
          placeholder="Paste the JD here…"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
        />
      </label>

      <label>
        Your resume <span className="muted">(optional)</span>
        <textarea
          rows={4}
          placeholder="Paste your resume here…"
          value={resume}
          onChange={(e) => setResume(e.target.value)}
        />
      </label>

      <button className="btn btn--primary" type="submit" disabled={!canSubmit}>
        {busy ? "Convening the council…" : "Convene the council →"}
      </button>
    </form>
  );
}
