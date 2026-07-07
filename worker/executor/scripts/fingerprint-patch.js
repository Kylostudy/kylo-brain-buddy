// worker/executor/scripts/fingerprint-patch.js
// Böngészőben futó init-script összeállítása a fingerprint objektumból.
// Minden Playwright context.addInitScript() előtt hívjuk, mielőtt bármi page
// megnyílik. A cél: a botjeleket letakarni úgy, ahogy a Dolphin(anty) teszi.
//
// Amit spoofolunk:
//   1. WebGL vendor/renderer (getParameter override)
//   2. WebGL2 ugyanazon override
//   3. navigator.hardwareConcurrency + navigator.deviceMemory
//   4. navigator.platform (Win32/MacIntel/Linux x86_64)
//   5. WebRTC IP-szivárgás blokk (createOffer / SDP csere)
//
// A WebRTC-t emellett Chrome launch-flag-gel is letiltjuk (lásd run.js).

export function buildFingerprintInitScript(fp) {
  const vendor = String(fp?.webglVendor || "Google Inc. (NVIDIA)");
  const renderer = String(
    fp?.webglRenderer ||
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  );
  const cores = Number(fp?.hardwareConcurrency || 8);
  const memory = Number(fp?.deviceMemory || 8);
  const platform = String(fp?.platform || "Win32");

  // A stringeket biztonságosan sorosítjuk, hogy egyetlen script-string legyen,
  // amit átadhatunk az addInitScript-nek.
  return `
(() => {
  try {
    const VENDOR = ${JSON.stringify(vendor)};
    const RENDERER = ${JSON.stringify(renderer)};
    const CORES = ${cores};
    const MEMORY = ${memory};
    const PLATFORM = ${JSON.stringify(platform)};

    // ---- 1-2. WebGL(2) getParameter override -------------------------------
    // A WEBGL_debug_renderer_info kiterjesztés két konstansát írjuk felül:
    //   UNMASKED_VENDOR_WEBGL  = 0x9245
    //   UNMASKED_RENDERER_WEBGL= 0x9246
    // + a szabvány VENDOR (0x1F00) és RENDERER (0x1F01) mezőket is.
    const patchGetParameter = (proto) => {
      if (!proto || !proto.getParameter) return;
      const orig = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 0x9245 || p === 0x1F00) return VENDOR;
        if (p === 0x9246 || p === 0x1F01) return RENDERER;
        return orig.call(this, p);
      };
    };
    if (typeof WebGLRenderingContext !== "undefined") {
      patchGetParameter(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== "undefined") {
      patchGetParameter(WebGL2RenderingContext.prototype);
    }

    // A getExtension('WEBGL_debug_renderer_info') mindig legyen elérhető,
    // különben a fenti override sosem fut le kliens oldalon.
    const patchGetExt = (proto) => {
      if (!proto || !proto.getExtension) return;
      const origExt = proto.getExtension;
      proto.getExtension = function (name) {
        const ext = origExt.call(this, name);
        if (name === "WEBGL_debug_renderer_info" && !ext) {
          return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
        }
        return ext;
      };
    };
    if (typeof WebGLRenderingContext !== "undefined")
      patchGetExt(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== "undefined")
      patchGetExt(WebGL2RenderingContext.prototype);

    // ---- 3. hardwareConcurrency + deviceMemory -----------------------------
    try {
      Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
        get: () => CORES, configurable: true,
      });
    } catch (_) {}
    try {
      Object.defineProperty(Navigator.prototype, "deviceMemory", {
        get: () => MEMORY, configurable: true,
      });
    } catch (_) {}

    // ---- 4. navigator.platform --------------------------------------------
    try {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => PLATFORM, configurable: true,
      });
    } catch (_) {}

    // ---- 5. WebRTC IP-szivárgás védelem ------------------------------------
    // Két rétegű: (a) az iceServers-t üresre kényszerítjük, hogy ne kérdezze
    // meg a STUN szervereket a valódi IP-ért; (b) a createOffer SDP-jéből
    // kiszűrjük a "candidate:" sorokat, amik IP-t szivárogtatnának.
    if (typeof RTCPeerConnection !== "undefined") {
      const OrigPC = RTCPeerConnection;
      const NewPC = function (config, ...rest) {
        try {
          if (config) config.iceServers = [];
        } catch (_) {}
        const pc = new OrigPC(config, ...rest);
        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = async function (...args) {
          const offer = await origCreateOffer(...args);
          if (offer && typeof offer.sdp === "string") {
            offer.sdp = offer.sdp
              .split("\\n")
              .filter((l) => !l.startsWith("a=candidate:"))
              .join("\\n");
          }
          return offer;
        };
        return pc;
      };
      NewPC.prototype = OrigPC.prototype;
      // eslint-disable-next-line no-global-assign
      window.RTCPeerConnection = NewPC;
      if (typeof webkitRTCPeerConnection !== "undefined") {
        window.webkitRTCPeerConnection = NewPC;
      }
    }
  } catch (e) {
    // Bármi hiba esetén ne törjük el az oldalt.
    console && console.warn && console.warn("fingerprint-patch failed", e);
  }
})();
`;
}
