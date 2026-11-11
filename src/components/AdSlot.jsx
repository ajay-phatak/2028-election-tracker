import { useEffect } from "react";
import { AD_CLIENT } from "../config/ads.config";

// Responsive AdSense unit. Renders nothing (no blank space, no requests) until
// AD_CLIENT and the slot id are set in src/config/ads.config.js.
export default function AdSlot({ slot }) {
  const enabled = Boolean(AD_CLIENT && slot);

  useEffect(() => {
    if (!enabled) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Loader script not present (e.g. blocked); the slot just stays empty.
    }
  }, [enabled, slot]);

  if (!enabled) return null;

  return (
    <ins
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={AD_CLIENT}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
