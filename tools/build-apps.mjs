// Rebuilds OpenRelay's release packages from the current sources: the desktop
// app (Windows installer + portable exe), the Android APK, and the Chrome and
// Firefox extensions.
//
//   node tools/build-apps.mjs                  all of them
//   node tools/build-apps.mjs exe apk          just the ones named
//                                              (exe, apk, chrome, firefox)
//
// The APK is a signed release build, which needs apps/android/keystore.properties
// (see keystore.properties.example). Add --debug for a debug APK instead.
// The Chrome .crx is signed with dist.pem in the repo root, so it keeps the
// extension's ID; the Firefox .xpi is unsigned until Mozilla signs it.
//
// The packages are then copied into releases/<desktop|android|chrome|firefox>/,
// named with their version (a rebuild of the same version replaces its files).
// Those folders are committed as the project's official downloads, except
// releases/desktop/: the exes are too close to GitHub's 100 MiB file limit, so
// they're git-ignored and published as GitHub Release assets instead. Debug
// APKs are never copied there.
//
// --publish then uploads this run's packages to the GitHub Release
// v<package.json version> with the GitHub CLI (gh), creating it as a draft at
// the current commit if it doesn't exist yet. Publish the draft on GitHub.
// The commit must be pushed and the working tree clean, so the release matches
// its tag.
//
// The desktop's `npm run dist` runs the root build first, so the other steps
// (the APK copies dist/ in through Gradle's copyOpenRelay task) reuse it.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crx3, zipDirectory } from "./extension-packages.mjs";

const root = resolve(import.meta.dirname, "..");
const desktop = join(root, "apps/desktop");
const android = join(root, "apps/android");
const releases = join(root, "releases");
const crxKey = join(root, "dist.pem");
// GitHub rejects pushes containing a file over 100 MiB.
const GITHUB_FILE_LIMIT = 100 * 1024 * 1024;

const TARGETS = ["exe", "apk", "chrome", "firefox"];
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const publish = args.includes("--publish");
const wanted = args.filter((arg) => arg !== "--debug" && arg !== "--publish");
for (const arg of wanted)
  if (!TARGETS.includes(arg))
    fail(
      `Unknown target "${arg}". Use any of ${TARGETS.join(", ")}, or nothing for all, ` +
        `plus --debug for a debug APK or --publish to upload to GitHub Releases.`,
    );
if (publish && debug) fail("--debug APKs aren't published. Leave out one of --debug and --publish.");
const builds = (target) => wanted.length === 0 || wanted.includes(target);
const buildExe = builds("exe");
const buildApk = builds("apk");
const buildChrome = builds("chrome");
const buildFirefox = builds("firefox");

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

// Runs a command quietly in the repo root and returns its exit status and stdout.
function query(command, args) {
  const result = spawnSync([command, ...args].join(" "), { cwd: root, encoding: "utf8", shell: true });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

// Fails before the long builds if the release couldn't be published afterwards.
function checkPublish() {
  if (!query("gh", ["--version"]).ok)
    fail("--publish needs the GitHub CLI. Install it (winget install GitHub.cli) and run `gh auth login`.");
  if (!query("gh", ["auth", "status"]).ok) fail("The GitHub CLI isn't signed in. Run `gh auth login`.");
  if (query("git", ["status", "--porcelain", "--untracked-files=no"]).out)
    fail("Commit your changes before publishing, so the release matches its tag.");
  if (!query("git", ["branch", "-r", "--contains", "HEAD"]).out)
    fail("Push the current commit before publishing; the release's tag points at it.");
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

// Without a complete keystore.properties Gradle would quietly produce an
// unsigned APK, which Android refuses to install. Check before building anything.
function checkKeystore() {
  const file = join(android, "keystore.properties");
  if (!existsSync(file))
    fail(`Missing ${file}. Copy keystore.properties.example and fill it in, or pass --debug.`);
  const props = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const empty = ["storeFile", "storePassword", "keyAlias", "keyPassword"].filter((key) => !props[key]);
  if (empty.length) fail(`${file} has no value for ${empty.join(", ")}.`);
  if (!existsSync(resolve(android, props.storeFile))) fail(`Keystore ${resolve(android, props.storeFile)} not found.`);
}

if (publish) checkPublish();
if (buildApk && !debug) checkKeystore();
// A new key would give the extension a new ID, so installed copies wouldn't update.
if (buildChrome && !existsSync(crxKey))
  fail(`Missing ${crxKey}, the key the .crx is signed with. Restore it, or leave out the chrome target.`);

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
  run(gradlew, [debug ? "assembleDebug" : "assembleRelease"], android, { ...process.env, JAVA_HOME: javaHome });
}

const manifestVersion = (dir) => JSON.parse(readFileSync(join(root, dir, "manifest.json"), "utf8")).version;

// [releases/ subfolder, name, source path or contents] for this build's packages.
const packages = [];
if (buildExe) {
  const { productName, version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
  const release = join(desktop, "release");
  // release/ keeps older versions' installers too; take only this version's.
  for (const file of readdirSync(release))
    if (file.startsWith(`${productName}-${version}-`) && /\.(exe|dmg|AppImage)$/.test(file))
      packages.push(["desktop", file, join(release, file)]);
}
if (buildApk && !debug) {
  const outputs = join(android, "app/build/outputs/apk/release");
  const [apk] = JSON.parse(readFileSync(join(outputs, "output-metadata.json"), "utf8")).elements;
  if (apk.outputFile.includes("unsigned")) fail(`${apk.outputFile} is unsigned. Check apps/android/keystore.properties.`);
  packages.push(["android", `OpenRelay-${apk.versionName}.apk`, join(outputs, apk.outputFile)]);
}
if (buildChrome) {
  const version = manifestVersion("dist");
  const zip = zipDirectory(join(root, "dist"));
  const { crx, id } = crx3(zip, readFileSync(crxKey));
  console.log(`\nChrome extension ID ${id}`);
  packages.push(["chrome", `OpenRelay-${version}-chrome.zip`, zip]);
  packages.push(["chrome", `OpenRelay-${version}.crx`, crx]);
}
if (buildFirefox)
  packages.push([
    "firefox",
    `OpenRelay-${manifestVersion("dist-firefox")}-unsigned.xpi`,
    zipDirectory(join(root, "dist-firefox")),
  ]);

const size = (source) => (typeof source === "string" ? statSync(source).size : source.length);
const mib = (source) => `${(size(source) / 1024 / 1024).toFixed(1)} MiB`;

// Everything but the git-ignored desktop folder gets committed.
const tooLarge = packages.filter(([folder, , source]) => folder !== "desktop" && size(source) > GITHUB_FILE_LIMIT);
if (tooLarge.length)
  fail(
    `Not copied to releases/, since GitHub rejects committed files over 100 MiB:\n` +
      tooLarge.map(([folder, name, source]) => `  ${folder}/${name} (${mib(source)})`).join("\n"),
  );

for (const [folder, name, source] of packages) {
  mkdirSync(join(releases, folder), { recursive: true });
  if (typeof source === "string") copyFileSync(source, join(releases, folder, name));
  else writeFileSync(join(releases, folder, name), source);
}

console.log("\nDone.");
for (const [folder, name, source] of packages) console.log(`  ${join(releases, folder, name)}  (${mib(source)})`);
if (buildApk && debug) console.log(`  ${join(android, "app/build/outputs/apk/debug/app-debug.apk")}`);

if (publish) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const stale = packages.filter(([, name]) => !name.includes(`-${version}-`) && !name.includes(`-${version}.`));
  if (stale.length)
    fail(`Not published: ${stale.map(([, name]) => name).join(", ")} doesn't match package.json's version ${version}.`);
  const tag = `v${version}`;
  const files = packages.map(([folder, name]) => `"${join(releases, folder, name)}"`);
  if (query("gh", ["release", "view", tag]).ok) {
    // Replace this version's assets, e.g. after a rebuild.
    run("gh", ["release", "upload", tag, ...files, "--clobber"], root);
  } else {
    const commit = query("git", ["rev-parse", "HEAD"]).out;
    run(
      "gh",
      ["release", "create", tag, ...files, "--draft", "--target", commit, "--title", `"OpenRelay ${version}"`, "--generate-notes"],
      root,
    );
  }
  console.log(`\nUploaded ${files.length} file(s) to the ${tag} release. ${query("gh", ["release", "view", tag, "--json", "url", "-q", ".url"]).out}`);
}
