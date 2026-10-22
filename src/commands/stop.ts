import { CliError, type Command } from "../command.ts";
import { PORT_FLAG, resolvePort } from "../port.ts";
import { probe, stopServer } from "../server-control.ts";

export const stopCommand: Command = {
  name: "stop",
  usage: "quiz-me stop [--port <n>]",
  description: "Stop the local quiz-me server; Answers stay readable. Safe to repeat",
  flags: [PORT_FLAG],
  async run(ctx) {
    const port = resolvePort(ctx.flags.port, ctx.env);
    const state = await probe(port);
    if (state.state === "foreign") {
      throw new CliError(`Port ${port} is in use by something that isn't quiz-me (${state.detail}); not stopping it`, [
        "Run `quiz-me stop --port <n>` with the port the quiz-me server uses",
      ]);
    }
    if (state.state === "down") {
      return {
        server: "not running",
        port,
        help: ["Pass `--port <n>` if the server was started on another port"],
      };
    }
    await stopServer(port);
    return { server: "stopped", port };
  },
};
