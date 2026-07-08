console.log(`[recorder] boot indul: node=${process.version} pid=${process.pid}`);

import("./index.js").catch((error) => {
  console.error("[recorder] index import/indítás hiba", error?.stack || error?.message || error);
  process.exit(1);
});