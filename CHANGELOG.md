# Changelog

## 0.1.0

First release.

- `<KoiPond />` React component: procedural koi in WebGL2 water, one shared three.js renderer.
- Koi with temperaments and activities (drift, cruise, dart, rest, investigate, feed, flee), a bend-limited spine,
  a spring-driven tail and lit 3D bodies with unique markings.
- Water: GPU wave simulation (taps, drops, wakes), refraction, depth colour, light on the floor and on ripples.
- Interaction: glide to leave a wake, tap for a splash, double-tap or long-press to feed, scroll or swipe to stir.
- Scene: lily pads (some flowering), corner rocks, rain, falling sakura, water plants, minnows, bubbles.
- Looks: `natural`, `ink` (woodblock print), and dithered `violet`, `ember`, `mono` (koi lifted into the light tones).
- Style changes spread across the pond as a ripple from the last click, the koi swimming on through it.
- Dither look keeps ripples, wakes and light visible (each gets its own tone).
- Pauses off screen; a still pond for `prefers-reduced-motion`.
