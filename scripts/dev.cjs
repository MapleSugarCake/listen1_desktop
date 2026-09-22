const { spawn } = require("node:child_process");
const child = spawn(require("electron"), ["./app", "--enable-logging"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development" },
  windowsHide: true,
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
