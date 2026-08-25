import gsap from 'gsap';

// MapLibre's flyTo/easeTo already computes a smooth curved flight path — this
// only swaps its default linear-ish ease for GSAP's power2.inOut, which reads
// as a much more natural "settle into place" glide than the built-in default.
export const flyEase = gsap.parseEase('power2.inOut') as (t: number) => number;
