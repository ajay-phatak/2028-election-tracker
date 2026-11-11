// AdSense wiring — everything stays off until these are filled in after approval.
//
// To go live:
//   1. Set AD_CLIENT to the publisher id from the AdSense dashboard ("ca-pub-…").
//   2. Create an ad unit per slot below and paste its numeric id.
//   3. Uncomment the AdSense loader <script> in index.html.
export const AD_CLIENT = null; // e.g. "ca-pub-1234567890123456"

export const AD_SLOTS = {
  belowMap: null, // horizontal unit between the map and the House section, e.g. "1234567890"
  aboveFooter: null, // horizontal unit at the end of the page
};
