const fs = require("node:fs");
const path = require("node:path");
function writeAudioFixtures(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const rate = 22050,
    duration = 40;
  const samples = Buffer.alloc(rate * duration * 2);
  for (let i = 0; i < rate * duration; i += 1)
    samples.writeInt16LE(
      Math.round(900 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      i * 2
    );
  const chunk = (name, bytes) => {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes, Buffer.alloc(bytes.length % 2)]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(rate, 4);
  format.writeUInt32LE(rate * 2, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const tags = Buffer.concat([
    Buffer.from("INFO"),
    chunk("INAM", Buffer.from("Synthetic title\0")),
    chunk("IART", Buffer.from("Fixture artist\0")),
    chunk("IPRD", Buffer.from("Fixture album\0")),
  ]);
  const content = Buffer.concat([
    Buffer.from("WAVE"),
    chunk("fmt ", format),
    chunk("LIST", tags),
    chunk("data", samples),
  ]);
  const wave = chunk("RIFF", content);
  const audio = path.join(directory, "测试音乐 #100%.wav");
  const plain = path.join(directory, "no-tags.wav");
  fs.writeFileSync(audio, wave);
  fs.writeFileSync(
    plain,
    chunk(
      "RIFF",
      Buffer.concat([
        Buffer.from("WAVE"),
        chunk("fmt ", format),
        chunk("data", samples),
      ])
    )
  );
  fs.writeFileSync(
    audio.replace(/\.wav$/, ".lrc"),
    "[00:00.00]合成歌词\n[00:02.00]第二行\n"
  );
  const broken = path.join(directory, "broken.wav");
  fs.writeFileSync(broken, "invalid audio fixture");
  return { audio, plain, broken };
}
module.exports = { writeAudioFixtures };
