import { describe, expect, test } from "bun:test";
import { isNonBrowserSpec } from "./vps-browser-policy";
import { isNonBrowserSpec as workerPolicy } from "../../worker/executor/scripts/browser-policy.js";

describe("Owner permanently retired all VPS browser tasks", () => {
  test("Every platform browser task, including Reddit and Audit, is denied", () => {
    for (const platform of ["reddit", "facebook", "linkedin", "instagram", "tiktok", "pinterest", "youtube", "x", "audit", "gmail"]) {
      for (const spec of [{ platform }, { brain_task: { task_type: `${platform}_warmup` } }, { brain_task: { task_type: "record_replay_login", platform } }]) {
        expect(isNonBrowserSpec(spec)).toBe(false);
        expect(workerPolicy(spec)).toBe(false);
      }
    }
    expect(isNonBrowserSpec({ brain_task: { task_type: "membership_archive" } })).toBe(false);
    expect(isNonBrowserSpec({ brain_task: { task_type: "future_unknown_task" } })).toBe(false);
  });
  test("Only video storage and reviewed factory package receipt stay available", () => {
    for (const task_type of ["archive_video", "receive_subject_factory_package"]) {
      expect(isNonBrowserSpec({ brain_task: { task_type } })).toBe(true);
      expect(workerPolicy({ brain_task: { task_type } })).toBe(true);
    }
  });
  test("Unrelated audio, membership and ping tasks are denied on the video-only VPS", () => {
    for (const task_type of ["ping", "stt_media_fetch", "stt_calibrate", "membership_transcribe"]) {
      expect(isNonBrowserSpec({ brain_task: { task_type } })).toBe(false);
      expect(workerPolicy({ brain_task: { task_type } })).toBe(false);
    }
  });
});