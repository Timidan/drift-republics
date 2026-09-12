import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--watch", "server/main.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4186", "--strictPort", ...process.argv.slice(2)], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop());
for (const child of children) child.once("exit", code => stop(code ?? 1));
