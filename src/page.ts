import { escapeHtml } from "./html.ts";
import { renderMarkdown } from "./markdown.ts";
import type { Question, Quiz } from "./quiz.ts";

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
${body}
</body>
</html>
`;
}

function questionHead(q: Question, i: number): string {
  return `<h2><span class="num">${i + 1}</span><span class="title">${escapeHtml(q.title)}</span></h2>
  ${q.body ? `<div class="body">${renderMarkdown(q.body)}</div>` : ""}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function renderQuizPage(quiz: Quiz): string {
  return quiz.submission ? renderSubmitted(quiz) : renderPending(quiz);
}

function renderPending(quiz: Quiz): string {
  const title = quiz.title ?? "Quiz";
  const total = quiz.questions.length;
  const cards = quiz.questions
    .map(
      (q, i) => `<section class="card" data-question="${escapeHtml(q.id)}">
  ${questionHead(q, i)}
  <div class="choices" role="group" aria-label="Answer">
    <button type="button" class="choice yes" data-answer="yes" aria-pressed="false">Yes</button>
    <button type="button" class="choice no" data-answer="no" aria-pressed="false">No</button>
  </div>
  <label class="clarification">
    <span>Clarification <em>(optional)</em></span>
    <textarea rows="2" placeholder="Anything that qualifies or explains your Answer"></textarea>
  </label>
</section>`,
    )
    .join("\n");
  return layout(
    title,
    `<main>
<header class="page-head">
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${plural(total, "Question")}. Answer Yes or No to each; add a Clarification where it helps.</p>
</header>
<form id="quiz" data-quiz="${escapeHtml(quiz.id)}" data-total="${total}" novalidate>
${cards}
<footer class="bar">
  <span class="progress" data-progress aria-live="polite">0 of ${total} answered</span>
  <span class="error" data-error role="alert"></span>
  <button type="submit" class="submit" disabled>Submit</button>
</footer>
</form>
</main>
<script src="/assets/app.js"></script>`,
  );
}

function renderSubmitted(quiz: Quiz): string {
  const title = quiz.title ?? "Quiz";
  const answers = new Map(quiz.submission!.answers.map((a) => [a.id, a]));
  const cards = quiz.questions
    .map((q, i) => {
      const a = answers.get(q.id);
      const answer = a ? `<p class="answer ${a.answer}">${a.answer === "yes" ? "Yes" : "No"}</p>` : "";
      const clar = a?.clarification ? `<blockquote class="given-clarification">${escapeHtml(a.clarification)}</blockquote>` : "";
      return `<section class="card locked" data-question="${escapeHtml(q.id)}">
  ${questionHead(q, i)}
  ${answer}
  ${clar}
</section>`;
    })
    .join("\n");
  return layout(
    `${title} (submitted)`,
    `<main>
<header class="page-head">
  <h1>${escapeHtml(title)}</h1>
  <p class="banner" role="status">Submitted — return to your agent</p>
</header>
${cards}
</main>`,
  );
}

export function renderNotFoundPage(id: string): string {
  return layout(
    "Quiz not found",
    `<main><header class="page-head"><h1>Quiz not found</h1><p class="lede">No Quiz with id ${escapeHtml(id)}. It may have expired.</p></header></main>`,
  );
}
