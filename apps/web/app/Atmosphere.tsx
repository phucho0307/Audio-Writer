'use client';

import { useEffect, useRef, useState } from 'react';
import { calm, MOTION_EVENT } from '@/lib/motion';
import { isNarrating, onNarrating } from '@/lib/ambience';

/**
 * The fog the whole site sits in.
 *
 * Horror and infidelity are the two genres this platform is actually for, and
 * a flat black page is not atmospheric, it is just unlit. This is one
 * full-screen quad running a noise shader: smoke drifting at two speeds, a
 * single warm source bleeding in from above, and a vignette pulling the
 * corners down.
 *
 * It is drawn once per frame at a capped resolution and nothing else is in the
 * scene, so the cost is a single fragment pass rather than a 3D world. It
 * stops entirely when the tab is hidden, when the page is scrolled past it,
 * and for anyone who has asked for reduced motion - in which case the CSS
 * gradient underneath is the whole effect and the canvas never mounts.
 */

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;

  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uRes;
  uniform vec3  uGround;
  uniform vec3  uMist;
  uniform vec3  uAccent;
  uniform float uFade;
  uniform float uLive;

  // Value noise. Cheaper than simplex and indistinguishable once it has been
  // through five octaves of fbm and dimmed to a tenth of its strength.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Corrected for the viewport's shape, so the smoke does not stretch into
    // streaks on a wide monitor.
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * (uRes.x / uRes.y), uv.y);

    // While a story is being read aloud the smoke moves a little more.
    float t = uTime * 0.02;

    // Two layers moving at different speeds and directions. One layer reads as
    // a texture; two read as depth.
    float near = fbm(p * 2.6 + vec2(t * 1.6, -t * 0.9));
    float far  = fbm(p * 1.3 + vec2(-t * 0.7, t * 0.45) + near * 0.35);

    float fog = smoothstep(0.25, 0.95, far * 0.65 + near * 0.35);

    // Heaviest low and to the sides, thin where the text sits.
    fog *= mix(0.35, 1.0, 1.0 - smoothstep(0.0, 0.75, uv.y));
    fog *= mix(0.55, 1.0, smoothstep(0.42, 0.0, abs(uv.x - 0.5)) * 0.4 + 0.6);

    vec3 col = mix(uGround, uMist, fog * 0.16);

    // The one warm source, up and slightly behind, breathing on a long
    // irrational period so it never visibly loops.
    vec2 lamp = vec2(0.5, 1.04);
    float d = distance(vec2(uv.x * (uRes.x / uRes.y), uv.y),
                       vec2(lamp.x * (uRes.x / uRes.y), lamp.y));
    float glow = exp(-d * 2.35);
    float flicker = 0.88
      + 0.12 * sin(uTime * 0.9)
      + 0.05 * sin(uTime * 2.3 + 1.7)
      // A slower swell on top while narration plays, so the room reads as
      // listening rather than as a brightness setting that got turned up.
      + uLive * 0.10 * sin(uTime * 0.55);
    col += uAccent * glow * (0.3 + uLive * 0.16) * flicker;

    // Corners pulled down, so the page has an edge it fades into.
    float vig = smoothstep(1.15, 0.25, distance(uv, vec2(0.5)));
    col *= mix(0.72, 1.0, vig);

    gl_FragColor = vec4(col, uFade);
  }
`;

/** `#rrggbb` or a computed `rgb(r, g, b)` to linear-ish 0..1, for the shader. */
function toRgb(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = value.match(/(\d+(?:\.\d+)?)/g);
  if (rgb && rgb.length >= 3) {
    return [+rgb[0] / 255, +rgb[1] / 255, +rgb[2] / 255];
  }
  return [0, 0, 0];
}

export default function Atmosphere() {
  const host = useRef<HTMLDivElement>(null);
  // Bumped when the reader changes their mind about motion, which tears the
  // renderer down or builds it back up without a page load.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setEpoch((n) => n + 1);
    window.addEventListener(MOTION_EVENT, bump);
    const system = window.matchMedia('(prefers-reduced-motion: reduce)');
    system.addEventListener('change', bump);
    return () => {
      window.removeEventListener(MOTION_EVENT, bump);
      system.removeEventListener('change', bump);
    };
  }, []);

  useEffect(() => {
    if (calm()) return;

    let stop = false;
    let dispose: (() => void) | undefined;

    // Imported here rather than at the top of the file so three.js is fetched
    // only once the page is interactive, and never at all for a reader who
    // has asked for stillness.
    (async () => {
      const THREE = await import('three');
      if (stop || !host.current) return;

      const el = host.current;
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      });
      // Capped: this is a background wash, and a 4K pass of five-octave fbm
      // every frame is a laptop fan for something nobody is looking at.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      // `false`: size the drawing buffer only. Letting three.js write an
      // inline width from innerWidth (which includes the scrollbar) made
      // the canvas 13px wider than the page it sits behind.
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.Camera();

      const css = getComputedStyle(document.documentElement);
      const pick = (name: string, fallback: string) =>
        new THREE.Vector3(
          ...toRgb(css.getPropertyValue(name).trim() || fallback),
        );

      const uniforms = {
        uTime: { value: 0 },
        uRes: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        uGround: { value: pick('--color-ground', '#07080a') },
        uMist: { value: pick('--color-mist', '#6f8a86') },
        uAccent: { value: pick('--color-accent', '#c8a24e') },
        uFade: { value: 0 },
        uLive: { value: 0 },
      };

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      scene.add(mesh);

      const onResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
      };
      window.addEventListener('resize', onResize);

      // Re-read the palette when the reader switches night and day, so the fog
      // belongs to the theme it is sitting under.
      const themes = new MutationObserver(() => {
        const now = getComputedStyle(document.documentElement);
        const re = (name: string, fallback: string) =>
          toRgb(now.getPropertyValue(name).trim() || fallback);
        uniforms.uGround.value.set(...re('--color-ground', '#07080a'));
        uniforms.uMist.value.set(...re('--color-mist', '#6f8a86'));
        uniforms.uAccent.value.set(...re('--color-accent', '#c8a24e'));
      });
      themes.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      // Eased towards its target rather than set, so starting and stopping
      // playback is a change in the weather and not a light switch.
      let liveTarget = isNarrating() ? 1 : 0;
      const stopListening = onNarrating((live) => {
        liveTarget = live ? 1 : 0;
      });

      let raf = 0;
      let last = performance.now();
      const start = last;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);

        // Nothing to draw when the tab is in the background or the reader has
        // scrolled the fog off screen.
        if (document.hidden || window.scrollY > window.innerHeight * 1.4) {
          last = now;
          return;
        }

        // Time advances by elapsed seconds rather than frame count, so the
        // drift is the same speed on a 60Hz panel and a 144Hz one.
        const dt = Math.min((now - last) / 1000, 0.05);
        uniforms.uTime.value += dt * (1 + uniforms.uLive.value * 0.35);
        uniforms.uLive.value +=
          (liveTarget - uniforms.uLive.value) * Math.min(dt * 1.2, 1);
        last = now;

        // Faded in over the first second: appearing at full strength in frame
        // one looks like a bug, drifting up out of black looks intended.
        uniforms.uFade.value = Math.min(1, (now - start) / 1000);

        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      dispose = () => {
        cancelAnimationFrame(raf);
        stopListening();
        window.removeEventListener('resize', onResize);
        themes.disconnect();
        mesh.geometry.dispose();
        (mesh.material as { dispose: () => void }).dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      stop = true;
      dispose?.();
    };
  }, [epoch]);

  return (
    <div
      ref={host}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 [&>canvas]:h-full [&>canvas]:w-full"
    />
  );
}
