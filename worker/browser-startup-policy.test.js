import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

describe("Permanent VPS platform browser startup retirement", () => {
  test("Compose recorder starts are inert even when explicitly requested", () => {
    const config = parse(readFileSync(new URL("./docker-compose.yml", import.meta.url), "utf8"), { merge: true });
    for (const name of ["recorder-blue", "recorder-green"]) {
      expect(config.services[name].command).toEqual(["/bin/true"]);
      expect(config.services[name].restart).toBe("no");
      expect(config.services[name].profiles).toEqual(["retired-browser"]);
    }
  });
});