// Loaded with `electron -r` before the app's main.js, in tests only. It gives
// the app a throwaway profile and keeps it offline: no request leaves until
// the test has installed its fixture routes, and after that only Reddit's
// hosts and lemmy.world (all answered by fixtures) and openrelay:// are allowed.
const { app, session } = require("electron");

app.setPath("userData", process.env.OPENRELAY_TEST_PROFILE);
// The test window is a real one, often behind others: keep it rendering, or
// the reader's animations (and the sheets that wait on them) never finish.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
globalThis.openRelayFixturesReady = false;
app.whenReady().then(() => {
  session
    .fromPartition("persist:openrelay")
    .webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      // Reddit's hosts and the fixture Lemmy instance.
      const reddit = /^(?:(www\.|old\.)?reddit\.com|v\.redd\.it|lemmy\.world)$/.test(url.hostname);
      callback({
        cancel:
          !["openrelay:", "devtools:", "chrome-error:", "data:", "blob:"].includes(url.protocol) &&
          !(reddit && url.protocol === "https:" && globalThis.openRelayFixturesReady),
      });
    });
});
