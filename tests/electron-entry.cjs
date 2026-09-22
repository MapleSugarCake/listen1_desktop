// Test-only entry: never use the real Listen1 profile.
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const profile = process.env.LISTEN1_TEST_USER_DATA;
if (!profile) throw new Error("LISTEN1_TEST_USER_DATA is required");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", path.resolve(profile));
app.setPath("sessionData", path.resolve(profile));
const application = path.resolve(
  process.env.LISTEN1_TEST_APP || path.join(__dirname, "../app")
);
app.setAppPath(application);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
require(path.join(application, "main.js"));
