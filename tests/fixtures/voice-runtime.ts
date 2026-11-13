// Transport fixture only. Real engines are exercised by the optional local voice smoke test.
const args = process.argv.slice(2);
const home = args[args.indexOf("--home") + 1];
if (!home) throw new Error("Missing voice home");
if (args.includes("check")) {
  console.log(JSON.stringify({ ready: true, message: "Fixture model ready" }));
} else if (args.includes("transcribe")) {
  const audio = await Bun.stdin.bytes();
  await Bun.write(
    `${home}/started.json`,
    JSON.stringify({ pid: process.pid, args, audio: [...audio] }),
  );
  if (audio[0] === 0) await Bun.sleep(30_000);
  console.log(JSON.stringify({ text: "Локальная диктовка." }));
} else {
  throw new Error("Unexpected fixture command");
}

export {};
