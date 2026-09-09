/*
 * The Assistant — web embed loader.
 *
 * One script tag, one key:
 *   <script src="https://<console>/embed.js" data-key="pk_live_…" async></script>
 *
 * Optional, for an assistant that should act as the signed-in person:
 *   data-user-token="<a token your site signs>"   — you already have the user
 *   data-token-url="/api/assistant-token"         — fetched on open instead
 *
 * Everything lives in an iframe, which is the whole point: the host page's CSS
 * cannot reach in and break the chat, and the chat cannot read the host page.
 * The loader itself stays deliberately small and dependency-free — it is running
 * on someone else's site, and the failure mode for a heavy widget is that they
 * remove it.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-key");
  if (!key) {
    console.warn("[assistant] no data-key on the script tag — nothing to open");
    return;
  }

  var origin = new URL(script.src, location.href).origin;
  var token = script.getAttribute("data-user-token") || "";
  var tokenUrl = script.getAttribute("data-token-url") || "";
  var label = script.getAttribute("data-label") || "Ask a question";
  var accent = script.getAttribute("data-accent") || "#0f766e";
  var open = false;
  var frame = null;

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;" +
    "border:0;border-radius:28px;background:" + accent + ";color:#fff;cursor:pointer;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.22);display:grid;place-items:center;font:600 13px/1 system-ui,sans-serif";
  button.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  var panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:20px;bottom:88px;z-index:2147483000;width:380px;height:min(620px,calc(100vh - 120px));" +
    "max-width:calc(100vw - 40px);border-radius:14px;overflow:hidden;display:none;" +
    "box-shadow:0 12px 48px rgba(0,0,0,.24);background:#fff";

  // Phones: fill the screen instead of a floating card nobody can type in.
  function layout() {
    if (window.innerWidth < 520) {
      panel.style.cssText = panel.style.cssText
        .replace(/right:20px/, "right:0")
        .replace(/bottom:88px/, "bottom:0")
        .replace(/width:380px/, "width:100vw")
        .replace(/height:min\(620px,calc\(100vh - 120px\)\)/, "height:100dvh")
        .replace(/border-radius:14px/, "border-radius:0");
    }
  }
  layout();
  window.addEventListener("resize", layout);

  function src(userToken) {
    var u = origin + "/embed?k=" + encodeURIComponent(key);
    if (userToken) u += "&uid=" + encodeURIComponent(userToken);
    return u;
  }

  function mount(userToken) {
    frame = document.createElement("iframe");
    frame.src = src(userToken);
    frame.title = label;
    frame.style.cssText = "width:100%;height:100%;border:0;display:block";
    // No allow-same-origin: the chat needs no access to the host page.
    frame.setAttribute("allow", "clipboard-write");
    panel.appendChild(frame);
  }

  function show() {
    panel.style.display = "block";
    open = true;
    if (frame) return;
    if (!tokenUrl) return mount(token);
    // Fetch the token on first open rather than on page load: an unopened widget
    // should not make a request for a signed identity nobody asked for.
    fetch(tokenUrl, { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { mount((j && (j.token || j.user_token)) || ""); })
      .catch(function () { mount(""); });
  }

  function hide() {
    panel.style.display = "none";
    open = false;
  }

  button.addEventListener("click", function () { open ? hide() : show(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) hide(); });

  function attach() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach);
})();
