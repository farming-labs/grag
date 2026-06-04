"use client";

import { useEffect, useRef } from "react";
import { mountPixelSnow, type PixelSnowOptions } from "@/lib/pixel-snow";

export default function PixelSnow(props: PixelSnowOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const {
    color,
    flakeSize,
    minFlakeSize,
    pixelResolution,
    speed,
    depthFade,
    farPlane,
    brightness,
    gamma,
    density,
    variant,
    direction
  } = props;

  useEffect(() => {
    if (!ref.current) return;

    return mountPixelSnow(ref.current, {
      color,
      flakeSize,
      minFlakeSize,
      pixelResolution,
      speed,
      depthFade,
      farPlane,
      brightness,
      gamma,
      density,
      variant,
      direction
    });
  }, [
    color,
    flakeSize,
    minFlakeSize,
    pixelResolution,
    speed,
    depthFade,
    farPlane,
    brightness,
    gamma,
    density,
    variant,
    direction
  ]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none"
      }}
    />
  );
}
