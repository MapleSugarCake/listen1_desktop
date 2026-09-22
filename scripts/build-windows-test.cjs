const { build, Platform, Arch } = require("electron-builder");

build({
  targets: Platform.WINDOWS.createTarget(["nsis", "7z"], Arch.x64),
  publish: "never",
  config: {
    directories: { output: "dist/windows-test" },
    win: {
      target: [
        { target: "nsis", arch: ["x64"] },
        { target: "7z", arch: ["x64"] },
      ],
    },
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
