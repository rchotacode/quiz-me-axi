/** The agent guide printed by `quiz-me skill` and installed by `quiz-me skill --install`. */
export const SKILL_MD = `---
name: quiz-me
description: Put a batch of yes/no decision Questions to the user in their browser with the quiz-me CLI, then collect their Answers and Clarifications without blocking. Use when you need the user's call on several decisions at once (design choices, trade-offs, scope, confirmations) instead of asking them one by one in chat.
---

# quiz-me

\`quiz-me\` shows the user a **Quiz**: a batch of yes/no **Questions** on a local web page. They give each Question an **Answer** (Yes or No), optionally add a **Clarification** (free text that qualifies it), and press Submit. There are no right answers; you are collecting decisions.

Every command returns at once and prints TOON on stdout. Nothing ever waits for the user, so you poll.

## When to use it

- Two or more decisions you can phrase as yes/no, where the user's judgement matters.
- A single quick question belongs in chat.
- A question that needs a free-form reply belongs in chat too. A Clarification only qualifies a Yes or No.

## Steps

1. **Write the Quiz** as JSON and pipe it to \`quiz-me ask\`:

   \`\`\`sh
   quiz-me ask <<'EOF'
   {"title": "Storage decisions",
    "questions": [
      {"title": "Use Postgres?", "body": "We need **joins** across orders and users.\\n\\nThe alternative is \`sqlite\` on the app host."},
      {"id": "cache", "title": "Add caching now?", "body": "No latency metrics yet."}
    ]}
   EOF
   \`\`\`

   Use \`quiz-me ask --file <path>\` to read the JSON from a file instead. Each Question needs a \`title\`, phrased so Yes and No are both clear choices. Its \`body\` is optional Markdown: give enough context that the user can decide without reading your conversation. Question ids default to \`q1\`..\`qn\`; set \`id\` when you want stable names.

2. **Point the user at it.** \`ask\` prints \`quiz: <id>\` and \`url: http://localhost:<port>/q/<id>\`, and opens the url in the browser. Tell the user a Quiz is waiting and quote the url. If \`browser:\` is anything other than \`opened\`, ask them to open the url themselves. Use \`quiz-me ask --no-open\` when the user's browser is on another machine, or when you will hand over the url yourself.

3. **Poll** with \`quiz-me answers <id>\`. It prints \`status: pending\` until the user submits, then \`status: submitted\` with \`answers[n]{id,title,answer,clarification}\`. Check when the user says they are done, or between other work. A tight polling loop just burns turns.

4. **Act on the Answers.** Read every Clarification: it can narrow or reverse what a bare Yes or No suggests. A submitted Quiz is locked, so to revisit a decision, ask a new Quiz.

5. **Stop the server** with \`quiz-me stop\` once you are done with Quizzes for now. This is optional: the server stops itself after 30 minutes with no pending Quizzes, and \`answers\` reads from disk, so it keeps working after the server is gone.

## Reference

- \`quiz-me\` on its own shows whether the server is running, the 10 most recent Quizzes with their ids and statuses, and next steps.
- Port: the default is 6767. \`QUIZ_ME_PORT\` overrides it, and \`--port <n>\` on \`quiz-me ask\`, \`quiz-me stop\` or bare \`quiz-me\` overrides both. If something that isn't quiz-me holds the port, \`ask\` fails rather than picking another one: rerun with \`quiz-me ask --port <n>\`.
- Errors print \`error:\` plus \`help[]\` on stdout and exit 1. An unknown flag exits 2. Run \`quiz-me <command> --help\` for usage.
- Quizzes are deleted 7 days after they are created. After that, \`answers\` reports the id as unknown.
`;
