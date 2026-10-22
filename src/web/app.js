// Quiz page: choose Yes/No for every Question, optionally add Clarifications, then submit once.
(function () {
  const form = document.getElementById("quiz");
  if (!form) return;
  const cards = Array.from(form.querySelectorAll("[data-question]"));
  const progress = form.querySelector("[data-progress]");
  const error = form.querySelector("[data-error]");
  const submitButton = form.querySelector('button[type="submit"]');
  let submitting = false;

  function answeredCount() {
    return cards.filter((card) => card.dataset.answer === "yes" || card.dataset.answer === "no").length;
  }

  function refresh() {
    const answered = answeredCount();
    progress.textContent = `${answered} of ${cards.length} answered`;
    submitButton.disabled = submitting || answered < cards.length;
  }

  for (const card of cards) {
    const buttons = Array.from(card.querySelectorAll("[data-answer]"));
    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        card.dataset.answer = btn.dataset.answer;
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === btn));
        card.classList.add("answered");
        refresh();
      });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || answeredCount() < cards.length) return;
    submitting = true;
    error.textContent = "";
    submitButton.textContent = "Submitting…";
    refresh();
    const answers = cards.map((card) => ({
      id: card.dataset.question,
      answer: card.dataset.answer,
      clarification: card.querySelector("textarea").value,
    }));
    try {
      const res = await fetch(`/api/quizzes/${form.dataset.quiz}/submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (res.ok || res.status === 409) {
        // Reload to show the locked, read-only Submitted view.
        location.reload();
        return;
      }
      const body = await res.json().catch(() => ({}));
      error.textContent = body.error || `Submission failed (HTTP ${res.status})`;
    } catch {
      error.textContent = "Could not reach quiz-me. Is the server still running?";
    }
    submitting = false;
    submitButton.textContent = "Submit";
    refresh();
  });

  refresh();
})();
