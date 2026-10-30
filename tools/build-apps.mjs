// Rebuilds the desktop app (Windows installer + portable exe) and the Android
// debug APK from the current sources.
//
//   node tools/build-apps.mjs          both
//   node tools/build-apps.mjs exe      desktop only
//   node tools/build-apps.mjs apk      Android only
//
// The desktop's `npm run dist` runs the root build first, so the APK step
// (which copies dist/ in through Gradle's copyOpenRelay task) reuses it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const desktop = join(root, "apps/desktop");
const android = join(root, "apps/android");

const wanted = process.argv.slice(2);
for (const arg of wanted)
  if (arg !== "exe" && arg !== "apk") fail(`Unknown target "${arg}". Use exe, apk, or nothing for both.`);
const buildExe = wanted.length === 0 || wanted.includes("exe");
const buildApk = wanted.length === 0 || wanted.includes("apk");

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function run(command, args, cwd, env = process.env) {
  const line = [command, ...args].join(" ");
  console.log(`\n> ${line}  (in ${cwd})`);
  // npm and gradlew are .cmd/.bat files on Windows, which need a shell.
  const result = spawnSync(line, { cwd, env, stdio: "inherit", shell: true });
  if (result.status !== 0) fail(`${line} failed (exit ${result.status ?? result.signal}).`);
}

// Gradle 9 and AGP 9 need JDK 17+. JAVA_HOME may point at an older JDK, so
// prefer it only when it's new enough, then Android Studio's bundled one.
function jdkMajor(home) {
  try {
    const match = /JAVA_VERSION="(\d+)/.exec(readFileSync(join(home, "release"), "utf8"));
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function findJdk() {
  const candidates = [process.env.JAVA_HOME];
  if (process.platform === "win32") {
    candidates.push("C:/Program Files/Android/Android Studio/jbr");
    for (const vendor of ["C:/Program Files/Eclipse Adoptium", "C:/Program Files/Java", "C:/Program Files/OpenJDK"])
      if (existsSync(vendor)) for (const dir of readdirSync(vendor)) candidates.push(join(vendor, dir));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    candidates.push("/opt/android-studio/jbr");
  }
  return candidates.find((home) => home && jdkMajor(home) >= 17);
}

if (buildExe) {
  if (!existsSync(join(desktop, "node_modules"))) run("npm", ["ci"], desktop);
  // electron-builder only targets the host OS; on Windows that's NSIS + portable.
  run("npm", ["run", "dist"], desktop);
} else {
  run("npm", ["run", "build"], root);
}

if (buildApk) {
  const javaHome = findJdk();
  if (!javaHome) fail("No JDK 17+ found. Install one (or Android Studio) and set JAVA_HOME to it.");
  console.log(`\nUsing JDK at ${javaHome}`);
  const gradlew = `"${join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
  run(gradlew, ["assembleDebug"], android, { ...process.env, JAVA_HOME: javaHome });
}

console.log("\nDone.");
if (buildExe) {
  const release = join(desktop, "release");
  for (const file of readdirSync(release).filter((f) => /\.(exe|dmg|AppImage)$/.test(f)))
    console.log(`  ${join(release, file)}`);
}
if (buildApk) console.log(`  ${join(android, "app/build/outputs/apk/debug/app-debug.apk")}`);
