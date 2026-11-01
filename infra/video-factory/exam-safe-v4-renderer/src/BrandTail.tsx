// Silent, text-free brand tail background: rotating gold sunburst rays with warm
// glow. Shared "master" asset for the exam-promo CTA beat; localized copy is
// layered on top by the renderer.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const BrandTail: React.FC<Record<string, never>> = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = (frame / fps) * 1000;
  const rot = (t / 1000) * 6; // slow 6 deg/sec rotation
  const fade = Math.min(1, frame / 12);
  void durationInFrames;
  const rays = Array.from({ length: 18 }, (_, i) => i * 20);
  return (
    <AbsoluteFill style={{ background: "#0A0703" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(60% 34% at 50% 42%, rgba(233,180,76,0.32), rgba(233,180,76,0.10) 45%, transparent 70%)",
          opacity: fade,
        }}
      />
      <AbsoluteFill style={{ opacity: 0.5 * fade, transform: `rotate(${rot}deg)`, transformOrigin: "50% 42%" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "300%", height: "300%", position: "absolute", left: "-100%", top: "-100%" }}>
          {rays.map((deg) => (
            <polygon
              key={deg}
              points="50,42 46,-60 54,-60"
              fill="rgba(233,180,76,0.16)"
              transform={`rotate(${deg} 50 42)`}
            />
          ))}
        </svg>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 40%, rgba(5,3,1,0.65) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
