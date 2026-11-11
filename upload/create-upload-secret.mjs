import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createUploadSecret } from "./auth.mjs";

const silentOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
const input = createInterface({ input: process.stdin, output: silentOutput, terminal: Boolean(process.stdin.isTTY) });
input.once("SIGINT", () => process.exit(130));
process.stderr.write("Upload-Passwort: ");
let password;
try {
  password = await input.question("");
} finally {
  input.close();
  process.stderr.write("\n");
}

const secret = await createUploadSecret(password);
if (process.argv.includes("--local")) {
  await writeFile(new URL(".dev.vars", import.meta.url), "UPLOAD_AUTH=" + secret + "\n", { flag: "wx", mode: 0o600 });
  process.stderr.write("Lokales Upload-Secret gespeichert.\n");
} else {
  process.stdout.write(secret + "\n");
}
