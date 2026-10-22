# Async polling with disk persistence

Answering a Quiz takes a human minutes, but agent harnesses kill long-running commands, and AXI forbids commands that wait for input. So `quiz-me ask` returns immediately and `quiz-me answers <id>` never blocks: it returns the Answers, or a definitive `pending`. Every Quiz is persisted to a state directory on disk, so Answers survive the shared server shutting down (it auto-stops when idle) and `answers` can read them without the server running or knowing its port.

## Considered Options

- **Blocking `ask`**: simplest for the agent, but hits harness timeouts and breaks AXI's no-waiting rule.
- **Blocking `ask` run as a background task**: depends on the harness supporting background processes, so it isn't portable.
- **`ask` plus a re-callable blocking `wait --timeout`**: rejected in favour of a purely non-blocking surface.
- **In-memory state**: a server restart would lose submitted Answers that the agent hadn't read yet.
