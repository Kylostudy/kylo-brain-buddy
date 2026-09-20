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
//   6. navigator.webdriver getter teljes törlése
//   7. Canvas + Audio fingerprint stabil, workflow-alapú finom zaj
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
  const locale = String(fp?.locale || "en-US");
  const languages = Array.isArray(fp?.languages) && fp.languages.length
    ? fp.languages.map(String)
    : [locale, String(locale).split("-")[0]].filter(Boolean);
  const ua = String(fp?.userAgent || "");
  const chromeMajor = Number(fp?.chromeMajor || 149);
  const viewportWidth = Number(fp?.viewport?.width || 1280);
  const viewportHeight = Number(fp?.viewport?.height || 800);
  const deviceScaleFactor = Number(fp?.deviceScaleFactor || 1);
  const canvasMode = String(fp?.canvasMode || "real");
  const audioMode = String(fp?.audioMode || "real");
  const canvasSeed = Number(fp?.canvasSeed || 0) >>> 0;
  const audioSeed = Number(fp?.audioSeed || 0) >>> 0;

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
    const LOCALE = ${JSON.stringify(locale)};
    const LANGUAGES = ${JSON.stringify(languages)};
    const USER_AGENT = ${JSON.stringify(ua)};
    const CHROME_MAJOR = ${chromeMajor};
    const VIEWPORT_WIDTH = ${viewportWidth};
    const VIEWPORT_HEIGHT = ${viewportHeight};
    const DEVICE_SCALE_FACTOR = ${deviceScaleFactor};
    const CANVAS_MODE = ${JSON.stringify(canvasMode)};
    const AUDIO_MODE = ${JSON.stringify(audioMode)};
    const CANVAS_SEED = ${canvasSeed};
    const AUDIO_SEED = ${audioSeed};

    const hashNoise = (seed, n) => {
      let x = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b)) >>> 0;
      x ^= x >>> 16;
      x = Math.imul(x, 0x7feb352d) >>> 0;
      x ^= x >>> 15;
      x = Math.imul(x, 0x846ca68b) >>> 0;
      x ^= x >>> 16;
      return (x % 3) - 1;
    };

    const patchFunctionToString = (fn, name) => {
      try { NATIVE_NAMES.set(fn, name); } catch (_) {}
      return fn;
    };


    // A CreepJS és társai a getterek/függvények toString()-jét nézik: ha nem
    // "[native code]"-ot adnak vissza, azonnal hazugságnak (lie) számít.
    // Ezért globálisan lecseréljük a Function.prototype.toString-et, és a saját
    // függvényeinket natívnak mutatjuk.
    const NATIVE_NAMES = new WeakMap();
    try {
      const origToString = Function.prototype.toString;
      const fakeToString = function () {
        const name = NATIVE_NAMES.get(this);
        if (name) return "function " + name + "() { [native code] }";
        return origToString.call(this);
      };
      NATIVE_NAMES.set(fakeToString, "toString");
      Object.defineProperty(Function.prototype, "toString", {
        value: fakeToString,
        writable: true,
        configurable: true,
      });
    } catch (_) {}

    const tagNative = (fn, name) => {
      try { if (typeof fn === "function") NATIVE_NAMES.set(fn, name); } catch (_) {}
      return fn;
    };

    // Getter definiálása úgy, hogy natívnak látsszon.
    const defineNativeGetter = (target, prop, getter) => {
      try {
        tagNative(getter, "get " + prop);
        Object.defineProperty(target, prop, { get: getter, configurable: true });
        return true;
      } catch (_) { return false; }
    };


    // ---- 0. webdriver getter teljes eltüntetése ----------------------------
    try {
      const protoDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "webdriver");
      if (protoDescriptor) delete Navigator.prototype.webdriver;
      const ownDescriptor = Object.getOwnPropertyDescriptor(navigator, "webdriver");
      if (ownDescriptor) delete navigator.webdriver;
    } catch (_) {}

    // ---- 0/b. alap böngésző-felület: UA Client Hints, chrome, nyelvek -------
    // Egyes oldalak nem a screenshot méretét nézik, hanem ezeket az apró
    // JS-jeleket. Ha itt Linux/headless/üres plugins látszik Windows UA mellett,
    // azonnal gyanús lesz.
    try {
      const platformName = PLATFORM === "MacIntel" ? "macOS" : PLATFORM === "Win32" ? "Windows" : "Linux";
      const brandVersion = String(CHROME_MAJOR);
      const fullVersion = CHROME_MAJOR + ".0.7827.55";
      const brands = [
        { brand: "Not A(Brand", version: "99" },
        { brand: "Google Chrome", version: brandVersion },
        { brand: "Chromium", version: brandVersion },
      ];
      const fullVersionList = [
        { brand: "Not A(Brand", version: "99.0.0.0" },
        { brand: "Google Chrome", version: fullVersion },
        { brand: "Chromium", version: fullVersion },
      ];
      const uaData = {
        brands,
        mobile: false,
        platform: platformName,
        getHighEntropyValues: async (hints = []) => {
          const all = {
            brands,
            mobile: false,
            platform: platformName,
            architecture: PLATFORM === "MacIntel" ? "arm" : "x86",
            bitness: PLATFORM === "MacIntel" ? "" : "64",
            model: "",
            platformVersion: PLATFORM === "Win32" ? "15.0.0" : PLATFORM === "MacIntel" ? "14.0.0" : "6.6.0",
            uaFullVersion: fullVersion,
            fullVersionList,
            wow64: false,
          };
          const out = { brands, mobile: false, platform: platformName };
          for (const hint of hints) if (hint in all) out[hint] = all[hint];
          return out;
        },
        toJSON: () => ({ brands, mobile: false, platform: platformName }),
      };
      Object.defineProperty(Navigator.prototype, "userAgentData", {
        get: () => uaData,
        configurable: true,
      });
    } catch (_) {}

    try {
      Object.defineProperty(Navigator.prototype, "languages", {
        get: () => LANGUAGES,
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, "language", {
        get: () => LOCALE,
        configurable: true,
      });
    } catch (_) {}

    try {
      if (!window.chrome) {
        Object.defineProperty(window, "chrome", {
          value: { runtime: {}, loadTimes: function () {}, csi: function () {}, app: {} },
          configurable: true,
        });
      }
    } catch (_) {}

    try {
      // Valódi (headed) Chrome-ban a PDF-pluginek natívan léteznek, és a
      // navigator.plugins egy igazi PluginArray. Ilyenkor NEM nyúlunk hozzá:
      // a sannysoft „Plugins is of type PluginArray" tesztje így zöld marad.
      const nativePlugins = navigator.plugins;
      const nativeOk =
        typeof PluginArray !== "undefined" &&
        nativePlugins instanceof PluginArray &&
        nativePlugins.length > 0;

      if (!nativeOk && typeof PluginArray !== "undefined" && typeof Plugin !== "undefined") {
        // Fallback (headless): valódi prototípusú objektumokat építünk, hogy a
        // típusellenőrzés (instanceof / toString) ne bukjon el.
        const makeMimeType = (type, suffixes, description) => {
          const mt = Object.create(MimeType.prototype);
          Object.defineProperties(mt, {
            type: { value: type, enumerable: true },
            suffixes: { value: suffixes, enumerable: true },
            description: { value: description, enumerable: true },
          });
          return mt;
        };
        const makePlugin = (name, filename, description, mimes) => {
          const p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name: { value: name, enumerable: true },
            filename: { value: filename, enumerable: true },
            description: { value: description, enumerable: true },
            length: { value: mimes.length, enumerable: true },
          });
          mimes.forEach((m, i) => {
            Object.defineProperty(p, i, { value: m, enumerable: true });
            Object.defineProperty(p, m.type, { value: m, enumerable: false });
            Object.defineProperty(m, "enabledPlugin", { value: p, enumerable: true });
          });
          return p;
        };

        const mimePdf = makeMimeType("application/pdf", "pdf", "Portable Document Format");
        const mimeXpdf = makeMimeType("text/pdf", "pdf", "Portable Document Format");
        const names = [
          ["PDF Viewer", "internal-pdf-viewer"],
          ["Chrome PDF Viewer", "internal-pdf-viewer"],
          ["Chromium PDF Viewer", "internal-pdf-viewer"],
          ["Microsoft Edge PDF Viewer", "internal-pdf-viewer"],
          ["WebKit built-in PDF", "internal-pdf-viewer"],
        ];
        const pluginList = names.map(([n, f]) =>
          makePlugin(n, f, "Portable Document Format", [mimePdf, mimeXpdf]),
        );

        const pluginArray = Object.create(PluginArray.prototype);
        pluginList.forEach((p, i) => {
          Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
          Object.defineProperty(pluginArray, p.name, { value: p, enumerable: false });
        });
        Object.defineProperty(pluginArray, "length", { value: pluginList.length });
        Object.defineProperty(pluginArray, "item", {
          value: function (i) { return this[i] || null; },
        });
        Object.defineProperty(pluginArray, "namedItem", {
          value: function (n) { return this[n] || null; },
        });
        Object.defineProperty(pluginArray, "refresh", { value: function () {} });

        const mimeArray = Object.create(MimeTypeArray.prototype);
        [mimePdf, mimeXpdf].forEach((m, i) => {
          Object.defineProperty(mimeArray, i, { value: m, enumerable: true });
          Object.defineProperty(mimeArray, m.type, { value: m, enumerable: false });
        });
        Object.defineProperty(mimeArray, "length", { value: 2 });
        Object.defineProperty(mimeArray, "item", {
          value: function (i) { return this[i] || null; },
        });
        Object.defineProperty(mimeArray, "namedItem", {
          value: function (n) { return this[n] || null; },
        });

        Object.defineProperty(Navigator.prototype, "plugins", {
          get: () => pluginArray,
          configurable: true,
        });
        Object.defineProperty(Navigator.prototype, "mimeTypes", {
          get: () => mimeArray,
          configurable: true,
        });
      }
    } catch (_) {}

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

    // ---- 4/b. screen/window méretek összhangja -----------------------------
    // A valódi viewportot a Playwright context adja, itt csak a JS screen API-kat
    // igazítjuk hozzá, hogy ne legyen ellentmondásos fingerprint.
    try {
      const screenProps = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        availWidth: VIEWPORT_WIDTH,
        availHeight: Math.max(1, VIEWPORT_HEIGHT - 40),
        colorDepth: 24,
        pixelDepth: 24,
      };
      for (const [key, value] of Object.entries(screenProps)) {
        try { Object.defineProperty(Screen.prototype, key, { get: () => value, configurable: true }); } catch (_) {}
        try { Object.defineProperty(window.screen, key, { get: () => value, configurable: true }); } catch (_) {}
      }
      Object.defineProperty(window, "outerWidth", { get: () => VIEWPORT_WIDTH, configurable: true });
      Object.defineProperty(window, "outerHeight", { get: () => VIEWPORT_HEIGHT, configurable: true });
      Object.defineProperty(window, "devicePixelRatio", { get: () => DEVICE_SCALE_FACTOR, configurable: true });
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
      patchFunctionToString(NewPC, "RTCPeerConnection");
      NewPC.prototype = OrigPC.prototype;
      // eslint-disable-next-line no-global-assign
      window.RTCPeerConnection = NewPC;
      if (typeof webkitRTCPeerConnection !== "undefined") {
        window.webkitRTCPeerConnection = NewPC;
      }
    }

    // ---- 6. Canvas fingerprint stabil zaj ----------------------------------
    // Nem véletlenszerű: ugyanaz a workflow mindig ugyanazt az apró eltérést
    // adja. Átlátszó pixeleket békén hagyunk, ezért a transparent-pixel teszt
    // továbbra is 0 marad.
    if (CANVAS_MODE === "noise") {
      const applyCanvasNoise = (imageData, seed) => {
        try {
          const data = imageData && imageData.data;
          if (!data || data.length < 4) return imageData;
          const step = Math.max(4, Math.floor(data.length / 160));
          for (let i = 0; i < data.length; i += step) {
            const a = data[i + 3];
            if (!a) continue;
            const n = hashNoise(seed, i);
            if (!n) continue;
            data[i] = Math.max(0, Math.min(255, data[i] + n));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] - n));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
          }
        } catch (_) {}
        return imageData;
      };

      const cloneWithNoise = (canvas) => {
        try {
          const w = canvas.width || 0;
          const h = canvas.height || 0;
          if (!w || !h) return canvas;
          const copy = document.createElement("canvas");
          copy.width = w;
          copy.height = h;
          const ctx = copy.getContext("2d", { willReadFrequently: true });
          if (!ctx) return canvas;
          ctx.drawImage(canvas, 0, 0);
          const imageData = ctx.getImageData(0, 0, w, h);
          applyCanvasNoise(imageData, CANVAS_SEED + w * 31 + h * 17);
          ctx.putImageData(imageData, 0, 0);
          return copy;
        } catch (_) {
          return canvas;
        }
      };

      try {
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = patchFunctionToString(function (...args) {
          const imageData = origGetImageData.apply(this, args);
          return applyCanvasNoise(imageData, CANVAS_SEED + (args[0] || 0) * 13 + (args[1] || 0) * 7);
        }, "getImageData");
      } catch (_) {}

      try {
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = patchFunctionToString(function (...args) {
          const copy = cloneWithNoise(this);
          return origToDataURL.apply(copy, args);
        }, "toDataURL");
      } catch (_) {}

      try {
        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = patchFunctionToString(function (callback, ...args) {
          const copy = cloneWithNoise(this);
          return origToBlob.call(copy, callback, ...args);
        }, "toBlob");
      } catch (_) {}
    }

    // ---- 7. Audio fingerprint stabil zaj -----------------------------------
    if (AUDIO_MODE === "noise") {
      const audioDelta = (i) => hashNoise(AUDIO_SEED, i) * 0.00000012;
      try {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = patchFunctionToString(function (...args) {
          const data = origGetChannelData.apply(this, args);
          try {
            if (!data.__kyloNoiseApplied) {
              for (let i = 0; i < data.length; i += 97) data[i] += audioDelta(i);
              Object.defineProperty(data, "__kyloNoiseApplied", { value: true });
            }
          } catch (_) {}
          return data;
        }, "getChannelData");
      } catch (_) {}

      try {
        const origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
        AudioBuffer.prototype.copyFromChannel = patchFunctionToString(function (destination, channelNumber, startInChannel = 0) {
          const ret = origCopyFromChannel.call(this, destination, channelNumber, startInChannel);
          try {
            for (let i = 0; i < destination.length; i += 97) destination[i] += audioDelta(i + startInChannel);
          } catch (_) {}
          return ret;
        }, "copyFromChannel");
      } catch (_) {}

      try {
        const origFloat = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = patchFunctionToString(function (array) {
          const ret = origFloat.call(this, array);
          try {
            for (let i = 0; i < array.length; i += 23) array[i] += audioDelta(i);
          } catch (_) {}
          return ret;
        }, "getFloatFrequencyData");
      } catch (_) {}
    }
  } catch (e) {
    // Bármi hiba esetén ne törjük el az oldalt.
    console && console.warn && console.warn("fingerprint-patch failed", e);
  }
})();
`;
}
