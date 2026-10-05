/**
 * Terrain surface mesh.
 */
import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { hexToRgb, sampleGradient } from '../utils/colorUtils'
import { hasFillLayer } from '../utils/geometryBuilders'
import { TONE_GLSL, toneFor } from '../utils/imageryTone'
import { useStore } from '../store/useStore'
import { groundPixelMetres, metresPerWorldUnit } from '../utils/geoCoords'
import { latitudeFor } from '../utils/sunHours'
import { curvatureField, fieldGrid, gridKey, localLightField, localReliefField, packFields, sunHoursTint, textureShadeField, wetnessField } from '../utils/surfaceFields'

/** A worker-measured `[cx, cy, cz, r]` as a three Sphere — see sphereOf in geometry.worker.js. */
const toSphere = (s) => new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3])

// ── Gradient texture ──────────────────────────────────────────────────────────

const GRAD_TEX_SIZE = 256

function buildGradientTexture(gradientStops) {
  const data = new Uint8Array(GRAD_TEX_SIZE * 4)
  for (let i = 0; i < GRAD_TEX_SIZE; i++) {
    const t = i / (GRAD_TEX_SIZE - 1)
    const [r, g, b] = sampleGradient(gradientStops, t)
    data[i * 4]     = Math.round(r * 255)
    data[i * 4 + 1] = Math.round(g * 255)
    data[i * 4 + 2] = Math.round(b * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, GRAD_TEX_SIZE, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}

// Ceiling on the ray-marching heightmap texture — see `needsHeightmapTex`.
const MAX_SHADOW_TEX = 2048

/**
 * Box-filters a raster down until neither side exceeds `maxSide`.
 *
 * Averaging rather than point-sampling matters here: the consumers march a ray
 * across the result comparing heights, and a dropped-sample downsample would
 * lose exactly the thin ridges that cast the shadows. Returns the input
 * untouched when it already fits, so the common case allocates nothing.
 */
function downsampleRaster(pixels, width, height, maxSide) {
  const step = Math.ceil(Math.max(width, height) / maxSide)
  if (step <= 1) return { pixels, width, height }

  const w = Math.max(1, Math.floor(width / step))
  const h = Math.max(1, Math.floor(height / step))
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = y * step, y1 = Math.min(height, y0 + step)
    for (let x = 0; x < w; x++) {
      const x0 = x * step, x1 = Math.min(width, x0 + step)
      let sum = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * width
        for (let sx = x0; sx < x1; sx++) { sum += pixels[row + sx]; n++ }
      }
      out[y * w + x] = n ? sum / n : 0
    }
  }
  return { pixels: out, width: w, height: h }
}

// ── Shaders ───────────────────────────────────────────────────────────────────
const SURFACE_VERT = /* glsl */ `
  // Raw terrain view collapses the elevation axis here rather than in the
  // geometry, because the geometry is what the exporters read: flattening it
  // upstream would make STL quietly ship a flat slab. Doing it in the shader
  // also makes the toggle a uniform flip instead of a worker rebuild.
  uniform bool uFlatten;

  attribute float brightness;
  varying float vBrightness;
  varying vec3  vNormal;
  varying vec2  vUv;
  void main() {
    vBrightness = brightness;
    vNormal     = normal;
    vUv         = uv;
    vec3 pos    = uFlatten ? vec3(position.x, 0.0, position.z) : position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`
const SURFACE_FRAG = /* glsl */ `
  uniform vec3      uFillColor;
  uniform bool      uGradient;
  uniform bool      uRawTerrain;
  uniform float     uRawMin;
  uniform float     uRawMax;
  uniform sampler2D uGradientTex;
  uniform bool      uHypsometricBanded;
  uniform float     uContourInterval;
  uniform float     uHypsoWeight;
  uniform float     uElevScale;
  uniform int       uColorMode; // 0=Elevation, 1=Slope, 2=Aspect

  uniform sampler2D uOverlayTex;
  uniform bool      uShowImagery;
  uniform sampler2D uImageryTex;
  uniform float     uImageryOpacity;
  uniform vec3      uImageryLo;
  uniform vec3      uImageryHi;
  uniform float     uImageryGamma;
  uniform float     uImageryBrightness;
  uniform float     uImageryContrast;
  uniform float     uImagerySaturation;
  uniform bool      uShowTexture;
  uniform float     uTextureScale;
  uniform vec2      uTextureOffset;
  uniform int       uTextureBlendMode; // 0=Normal 1=Multiply 2=Screen 3=Overlay 4=SoftLight 5=Add
  uniform float     uTextureOpacity;

  uniform float     uElevMinCut;
  uniform float     uElevMaxCut;

  uniform bool      uHillshade;
  uniform float     uHillshadeAzimuth;
  uniform float     uHillshadeAltitude;
  uniform float     uHillshadeIntensity;
  uniform float     uHillshadeOpacity;
  uniform float     uHillshadeExaggeration;
  uniform vec3      uHillshadeHighlight;
  uniform vec3      uHillshadeShadow;

  uniform bool      uCastShadows;
  uniform sampler2D uHeightmapTex;
  uniform float     uHeightmapCols;
  uniform float     uHeightmapRows;
  uniform float     uShadowStepH;
  uniform int       uShadowSteps;
  uniform float     uShadowSoftness;
  uniform float     uShadowDarkness;

  uniform bool      uHillshadeMultiDir;
  uniform bool      uHillshadeLocal;
  uniform float     uHillshadeLocalTurn;

  uniform bool      uAO;
  uniform float     uAOStrength;
  uniform int       uAORays;

  uniform bool      uWaterFill;
  uniform float     uWaterLevel;
  uniform vec3      uWaterColor;
  uniform float     uWaterOpacity;

  uniform bool      uAspectMap;
  uniform float     uAspectMapOpacity;

  uniform bool      uSlopeShade;
  uniform float     uSlopeShadeOpacity;
  uniform vec3      uSlopeColorLow;
  uniform vec3      uSlopeColorHigh;
  uniform float     uSlopeShadeMax;
  uniform float     uSlopeShadeBand;
  uniform bool      uSlopeShadeTrue;
  uniform bool      uAspectBivariate;
  uniform float     uAspectFull;
  // True metres: the tangent of a slope as drawn, times this, is its tangent on
  // the ground. The drawn one carries the height slider; this takes it out.
  uniform float     uTrueK;

  // Fields computed on the main thread (surfaceFields.js): local relief,
  // curvature, texture shading, wetness in one texture, sun hours in the next.
  uniform sampler2D uFieldTex;
  uniform sampler2D uFieldTex2;
  uniform vec2      uFieldSize;
  uniform bool      uLocalRelief;
  uniform float     uLocalReliefGain;
  uniform float     uLocalReliefOpacity;
  uniform vec3      uLocalReliefLow;
  uniform vec3      uLocalReliefHigh;
  uniform bool      uCurvShade;
  uniform float     uCurvShadeGain;
  uniform float     uCurvShadeOpacity;
  uniform vec3      uCurvShadeConvex;
  uniform vec3      uCurvShadeConcave;
  uniform bool      uTexShade;
  uniform float     uTexShadeContrast;
  uniform float     uTexShadeOpacity;
  uniform bool      uWetness;
  uniform float     uWetnessFrom;
  uniform float     uWetnessOpacity;
  uniform vec3      uWetnessColor;
  uniform bool      uSunTint;
  uniform float     uSunTintOpacity;
  uniform vec3      uSunTintShade;
  uniform vec3      uSunTintSun;

  uniform bool      uOpenness;
  uniform bool      uOpennessRed;
  uniform float     uOpennessGain;
  uniform float     uOpennessOpacity;
  uniform int       uOpennessSteps;
  uniform float     uOpennessRedFull;

  uniform bool      uAerial;
  uniform float     uAerialStrength;
  uniform vec3      uAerialColor;
  uniform float     uAerialGamma;
  varying float     vBrightness;
  varying vec3      vNormal;
  varying vec2      vUv;

  vec3 hue2rgb(float h) {
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
  }
  vec3 hsl_s1(float h, float l) {
    vec3 rgb = hue2rgb(fract(h));
    return (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0)) + l;
  }
${TONE_GLSL}

  float computeSVF(vec2 uv) {
    float h0 = texture2D(uHeightmapTex, uv).r;
    float sumH = 0.0;
    float PI2 = 6.28318530;
    for (int i = 0; i < 32; i++) {
      if (i >= uAORays) break;
      float az = float(i) * PI2 / float(uAORays);
      vec2 dir = vec2(cos(az) / uHeightmapCols, sin(az) / uHeightmapRows);
      float maxH = 0.0;
      float acc  = 0.0;
      for (int s = 1; s <= 32; s++) {
        acc += 1.0 + float(s - 1) * 0.15;
        vec2 sUV = uv + dir * acc;
        if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) break;
        float dh = texture2D(uHeightmapTex, sUV).r - h0;
        if (dh > 0.0) {
          float ha = atan(dh / (acc * uShadowStepH)) / 1.5707963;
          if (ha > maxH) maxH = ha;
        }
      }
      sumH += maxH;
    }
    return 1.0 - sumH / float(uAORays);
  }

  // Positive and negative openness (Yokoyama et al., 2002), as 0…2 in units of
  // a right angle: how far the sky opens above a point, and how far the ground
  // opens below it, averaged over eight directions. The same march as the sky
  // view factor, keeping the steepest angle down as well as up.
  vec2 computeOpenness(vec2 uv) {
    float h0 = texture2D(uHeightmapTex, uv).r;
    float pos = 0.0, neg = 0.0;
    for (int i = 0; i < 8; i++) {
      float az = float(i) * 0.78539816;
      vec2 dir = vec2(cos(az) / uHeightmapCols, sin(az) / uHeightmapRows);
      float up = -1.5707963, down = -1.5707963, acc = 0.0;
      for (int s = 1; s <= 64; s++) {
        if (s > uOpennessSteps) break;
        acc += 1.0 + float(s - 1) * 0.12;
        vec2 sUV = uv + dir * acc;
        if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) break;
        float a = atan((texture2D(uHeightmapTex, sUV).r - h0) / (acc * uShadowStepH));
        up = max(up, a);
        down = max(down, -a);
      }
      pos += 1.5707963 - up;
      neg += 1.5707963 - down;
    }
    return vec2(pos, neg) / (8.0 * 1.5707963);
  }

  // The slope on the ground, in degrees, from the normal as drawn.
  float trueSlopeDeg(vec3 n) {
    float t = length(n.xz) / max(abs(n.y), 1e-4);
    return degrees(atan(t * uTrueK));
  }

  // A field texel for this fragment. The UVs run corner to corner and a
  // texel's centre is half a texel in, so this maps one onto the other.
  vec4 fieldAt(sampler2D tex) {
    vec2 uv = (vUv * (uFieldSize - 1.0) + 0.5) / uFieldSize;
    return texture2D(tex, uv);
  }

  // A signed field as a two-colour tint: toward lo below zero, hi above.
  vec3 diverge(vec3 base, float v, vec3 lo, vec3 hi, float opacity) {
    return mix(base, v < 0.0 ? lo : hi, opacity * clamp(abs(v), 0.0, 1.0));
  }

  void main() {
    // Elevation cut, measured the same way the line builders measure it:
    // normalised across the data's own range, not against raw 0…1. The two
    // agreed only for a heightmap spanning exactly 0…1 — for anything narrower
    // (any raster with Blur on, since that pulls both bounds inward) the fill
    // boundary and the lowest surviving contour sat at visibly different
    // heights. The bounds are already here for the raw view, and normElev
    // reduces to exactly this because elevScale cancels out of it.
    float cut = clamp((vBrightness - uRawMin) / max(uRawMax - uRawMin, 1e-5), 0.0, 1.0);
    if (cut < uElevMinCut / 100.0 || cut > uElevMaxCut / 100.0) {
      discard;
    }
    // Raw terrain view: the heightmap itself, flat and unlit — lowest point
    // black, highest white. Returning here is what hides everything else; every
    // overlay (gradient, texture, water, hillshade, AO, aspect, slope) lives
    // below this point and is skipped wholesale rather than switched off one by
    // one. It must also come before vNormal is touched: with raw view as the
    // only fill layer the geometry carries no normals, so normalize() there
    // would be NaN.
    //
    // The range is stretched across the data's actual bounds, so a heightmap
    // occupying only the middle of 0…1 still reads at full contrast.
    if (uRawTerrain) {
      float g = clamp((vBrightness - uRawMin) / max(uRawMax - uRawMin, 1e-5), 0.0, 1.0);
      gl_FragColor = vec4(g, g, g, 1.0);
      return;
    }

    vec3 n = normalize(vNormal);
    float b = vBrightness;

    if (uColorMode == 1) {
      b = clamp(1.0 - n.y, 0.0, 1.0);
    } else if (uColorMode == 2) {
      b = atan(n.z, n.x) / 3.14159265 * 0.5 + 0.5;
    }
    
    float lineMask = 0.0;

    if (uHypsometricBanded) {
      if (uColorMode == 0) {
        float elev = (vBrightness - 0.5) * 100.0 * uElevScale;
        if (uHypsoWeight > 0.0) {
          float fw = fwidth(elev);
          float dist = mod(elev + uContourInterval * 0.5, uContourInterval) - uContourInterval * 0.5;
          lineMask = 1.0 - smoothstep(uHypsoWeight * fw * 0.5, uHypsoWeight * fw * 1.5, abs(dist));
        }
        float quantizedElev = floor(elev / uContourInterval) * uContourInterval;
        b = (quantizedElev / (100.0 * uElevScale)) + 0.5;
      } else {
        float steps = 100.0 / uContourInterval; 
        if (uHypsoWeight > 0.0) {
          float fw = fwidth(b * steps);
          float dist = mod(b * (steps + 1e-5), 1.0) - 0.5;
          lineMask = 1.0 - smoothstep(uHypsoWeight * fw * 0.5, uHypsoWeight * fw * 1.5, abs(dist));
        }
        b = floor(b * steps) / steps;
      }
      b = clamp(b, 0.0, 1.0);
    }

    vec3 base = (uGradient || uHypsometricBanded)
      ? texture2D(uGradientTex, vec2(b, 0.5)).rgb
      : uFillColor;

    // The satellite drape, composited before the user's own texture overlay:
    // imagery is what the ground looks like, and a texture is something they
    // chose to put on top of it. It lands 1:1 on the raster, so it needs no
    // scale or offset of its own — plain vUv.
    if (uShowImagery) {
      vec4 sat = texture2D(uImageryTex, vUv);
      base = mix(base, toneImagery(sat.rgb), sat.a * uImageryOpacity);
    }

    if (uShowTexture) {
      vec2 uv = vUv * uTextureScale + uTextureOffset;
      vec4 texColor = texture2D(uOverlayTex, uv);
      vec3 tex = texColor.rgb;
      float alpha = texColor.a;
      vec3 blended;
      if (uTextureBlendMode == 1) {
        blended = base * tex;
      } else if (uTextureBlendMode == 2) {
        blended = 1.0 - (1.0 - base) * (1.0 - tex);
      } else if (uTextureBlendMode == 3) {
        blended = mix(2.0*base*tex, 1.0 - 2.0*(1.0-base)*(1.0-tex), step(0.5, base));
      } else if (uTextureBlendMode == 4) {
        vec3 a = base, t = tex;
        blended = mix(a - (1.0-2.0*t)*a*(1.0-a), a + (2.0*t-1.0)*(sqrt(a)-a), step(0.5, t));
      } else if (uTextureBlendMode == 5) {
        blended = clamp(base + tex, 0.0, 1.0);
      } else {
        blended = tex;
      }
      base = mix(base, blended, alpha * uTextureOpacity);
    }

    if (uHypsometricBanded && uHypsoWeight > 0.0) {
      base = mix(base, vec3(0.0), lineMask * 0.5);
    }

    // Water fill — runs before hillshade so water surface gets shaded
    if (uWaterFill && vBrightness < uWaterLevel) {
      float depth = clamp((uWaterLevel - vBrightness) / max(uWaterLevel, 0.001), 0.0, 1.0);
      base = mix(base, uWaterColor * (1.0 - depth * 0.6), uWaterOpacity);
    }

    // Colour tints for what the ground is like: wet, or sunny. Before the
    // hillshade, so the relief shades them like any other fill.
    if (uWetness) {
      float w = fieldAt(uFieldTex).a;
      base = mix(base, uWetnessColor, uWetnessOpacity * smoothstep(uWetnessFrom, 1.0, w));
    }
    if (uSunTint) {
      float sun = fieldAt(uFieldTex2).r;
      base = mix(base, mix(uSunTintShade, uSunTintSun, sun), uSunTintOpacity);
    }

    if (uHillshade) {
      float alt = uHillshadeAltitude * 3.14159265 / 180.0;
      vec3 exagNormal = normalize(vec3(n.x * uHillshadeExaggeration, n.y, n.z * uHillshadeExaggeration));
      float lambert;
      float shadowFactor = 1.0;

      if (uHillshadeMultiDir) {
        // Average Lambert over 8 equally-spaced azimuths — eliminates directional bias
        float sumL = 0.0;
        for (int d = 0; d < 8; d++) {
          float az = float(d) * 0.7853981634; // π/4 steps
          vec3 ldir = normalize(vec3(sin(az) * cos(alt), sin(alt), -cos(az) * cos(alt)));
          sumL += clamp(dot(exagNormal, ldir), 0.0, 1.0);
        }
        lambert = sumL / 8.0;
        // Cast shadows not applicable in multi-directional mode
      } else {
        // With Local light the bearing is the field's, turned at each place to
        // cross the ridges; the cast-shadow march below follows the same one.
        float azDeg = uHillshadeAzimuth;
        if (uHillshadeLocal) {
          // The ridge axis comes in as a doubled angle scaled by coherence; the
          // across-ridge bearing is half of it. The turn goes to the nearer end
          // of that axis, capped, and fades out in the last 15° before the end
          // it flips to, so neighbouring pixels never jump between the two.
          vec2 t = fieldAt(uFieldTex2).gb;
          float coh = length(t);
          float across = 90.0 - 0.5 * degrees(atan(t.y, t.x));
          float d = mod(across - azDeg + 75.0, 180.0) - 75.0;
          float fade = clamp(min((d + 75.0) / 15.0, (105.0 - d) / 15.0), 0.0, 1.0);
          azDeg += clamp(d, -uHillshadeLocalTurn, uHillshadeLocalTurn) * fade * coh;
        }
        float az = azDeg * 3.14159265 / 180.0;
        // A true bearing: 0° north, 90° east. East is +X and north is −Z.
        vec3 lightDir = normalize(vec3(sin(az) * cos(alt), sin(alt), -cos(az) * cos(alt)));
        lambert = clamp(dot(exagNormal, lightDir), 0.0, 1.0);

        // Cast shadow: ray-march in UV space toward the sun using progressive step
        // sizes (linear growth) for far-field reach, compared via horizon angle so
        // the penumbra is expressed in degrees rather than height units.
        if (uCastShadows) {
          float h0 = texture2D(uHeightmapTex, vUv).r;
          // UV displacement per one grid cell toward the light source.
          // sin(az) → +U (east); cos(az) → +V (north, V is flipped vs row index).
          vec2 uvStep = vec2(sin(az) / uHeightmapCols, cos(az) / uHeightmapRows);

          // Track the maximum horizon angle seen along the ray.
          // Shadow condition: maxHorizonAngle > sunAltitude.
          float maxHorizonAngle = -1.5708; // start at −π/2
          float accumN = 0.0;             // accumulated grid-cell steps

          for (int i = 1; i <= 128; i++) {
            if (i > uShadowSteps) break;
            // Progressive step: distant samples use larger strides so the ray
            // covers far-off ridges with the same step budget.
            float stepN = 1.0 + float(i - 1) * 0.1;
            accumN += stepN;

            vec2 sUV = vUv + uvStep * accumN;
            if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) break;

            float hTerrain = texture2D(uHeightmapTex, sUV).r;
            float elevDiff = hTerrain - h0;
            if (elevDiff > 0.0) {
              float horizAngle = atan(elevDiff / (accumN * uShadowStepH));
              if (horizAngle > maxHorizonAngle) maxHorizonAngle = horizAngle;
            }
          }

          // Soft penumbra expressed in degrees (1 unit ≈ 1° of arc).
          float penumbra = max(uShadowSoftness * 0.017453, 0.0001);
          shadowFactor = 1.0 - smoothstep(alt - penumbra, alt + penumbra, maxHorizonAngle);
        }
      }

      // Shadow floor: prevents shadows from going completely black.
      float effectiveShadow = max(shadowFactor, 1.0 - uShadowDarkness);
      float shade = clamp(lambert * effectiveShadow * uHillshadeIntensity, 0.0, 1.0);
      vec3 shadeColor = mix(uHillshadeShadow, uHillshadeHighlight, shade);
      base = mix(base, shadeColor, uHillshadeOpacity);
    }

    // Ambient occlusion (Sky View Factor)
    if (uAO) {
      base *= mix(1.0, computeSVF(vUv), uAOStrength);
    }

    // Light-free relief: the fields that show form with no sun at all.
    if (uTexShade) {
      float v = fieldAt(uFieldTex).b;
      base = mix(base, vec3(clamp(0.5 + 0.5 * v * uTexShadeContrast, 0.0, 1.0)), uTexShadeOpacity);
    }
    if (uLocalRelief) {
      base = diverge(base, fieldAt(uFieldTex).r * uLocalReliefGain, uLocalReliefLow, uLocalReliefHigh, uLocalReliefOpacity);
    }
    if (uCurvShade) {
      base = diverge(base, fieldAt(uFieldTex).g * uCurvShadeGain, uCurvShadeConcave, uCurvShadeConvex, uCurvShadeOpacity);
    }
    // Openness: bright where the ground is open to the sky, dark where it is
    // enclosed. The Red Relief Image Map (Chiba et al., 2008) adds red in
    // proportion to the slope, so steep ground reads red and flat ground grey.
    if (uOpenness) {
      vec2 o = computeOpenness(vUv);
      float g = clamp(0.5 + (o.x - o.y) * uOpennessGain, 0.0, 1.0);
      vec3 col = vec3(g);
      if (uOpennessRed) {
        float red = clamp(trueSlopeDeg(n) / max(uOpennessRedFull, 1.0), 0.0, 1.0);
        col = g * mix(vec3(1.0), vec3(1.0, 0.28, 0.18), red);
      }
      base = mix(base, col, uOpennessOpacity);
    }

    // Aspect: hue from the direction the ground faces. As a bivariate map
    // (Brewer and Marlow, 1993) the colour also fades to grey as the ground
    // flattens, because a level field faces nowhere and a loud hue there says
    // it faces somewhere.
    if (uAspectMap) {
      float asp = atan(n.z, n.x) / (2.0 * 3.14159265) + 0.5;
      vec3 hue = hsl_s1(asp, 0.65);
      if (uAspectBivariate) hue = mix(vec3(0.62), hue, clamp(trueSlopeDeg(n) / max(uAspectFull, 1.0), 0.0, 1.0));
      base = mix(base, hue, uAspectMapOpacity);
    }

    // Slope in true degrees, full colour at uSlopeShadeMax, optionally banded.
    // It used to read 1 − n.y of the drawn normal, which moved with the height
    // slider and could not say where the ground passes 30°.
    // With uSlopeShadeTrue off, the old reading, kept exactly for plates made
    // before it changed (see migrateShading in presetFile.js).
    if (uSlopeShade) {
      float t;
      if (uSlopeShadeTrue) {
        float d = trueSlopeDeg(n);
        if (uSlopeShadeBand > 0.0) d = floor(d / uSlopeShadeBand) * uSlopeShadeBand;
        t = clamp(d / max(uSlopeShadeMax, 1.0), 0.0, 1.0);
      } else {
        t = clamp(1.0 - n.y, 0.0, 1.0);
      }
      base = mix(base, mix(uSlopeColorLow, uSlopeColorHigh, t), uSlopeShadeOpacity * t);
    }

    // Aerial perspective, after Imhof: low ground fades into a haze, so the
    // summits stand in front. Last, because haze lies over everything.
    if (uAerial) {
      float haze = uAerialStrength * pow(1.0 - cut, uAerialGamma);
      base = mix(base, uAerialColor, clamp(haze, 0.0, 1.0));
    }

    gl_FragColor = vec4(base, 1.0);
  }
`

// ── Component ─────────────────────────────────────────────────────────────────
export function SurfaceMesh({ surfaceGeo, p, profileClickRef }) {
  const textureImage     = useStore(s => s.textureImage)
  const heightmapPixels  = useStore(s => s.heightmapPixels)
  const heightmapWidth   = useStore(s => s.heightmapWidth)
  const heightmapHeight  = useStore(s => s.heightmapHeight)

  // Color-reactivity telemetry — parsed by tests/benchmark.spec.js (Phase 3).
  useEffect(() => {
    if (p.showFill) console.log('[Benchmark] Color Updated: ' + Date.now())
  }, [p.fillColor, p.showFill])

  // Normals and UVs are computed in the geometry worker (buildSurfaceGeometry)
  // and transferred — running computeVertexNormals() here would stall the main
  // thread for megavertex meshes on every rebuild.
  const geometry = useMemo(() => {
    if (!surfaceGeo) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position',   new THREE.BufferAttribute(surfaceGeo.positions,    3))
    geo.setAttribute('brightness', new THREE.BufferAttribute(surfaceGeo.brightnessBuf, 1))
    // The worker omits normals/UVs when no fill layer is on (they exist only for
    // this shader). That is exactly when `surfaceActive` below is false and the
    // mesh is not drawn; switching a fill layer on rebuilds with them present.
    if (surfaceGeo.normals?.length) geo.setAttribute('normal', new THREE.BufferAttribute(surfaceGeo.normals, 3))
    if (surfaceGeo.uvs?.length)     geo.setAttribute('uv',     new THREE.BufferAttribute(surfaceGeo.uvs,     2))
    geo.setIndex(new THREE.BufferAttribute(surfaceGeo.indices, 1))
    // Measured in the worker — see sphereOf in geometry.worker.js.
    if (surfaceGeo.sphere) geo.boundingSphere = toSphere(surfaceGeo.sphere)
    return geo
  }, [surfaceGeo])

  useEffect(() => () => geometry?.dispose(), [geometry])

  const gradTexRef = useRef(null)
  const gradientTex = useMemo(() => {
    gradTexRef.current?.dispose()
    const tex = buildGradientTexture(
      p.fillHypsometric && p.gradientStops?.length > 1
        ? p.gradientStops
        : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#ffffff' }]
    )
    gradTexRef.current = tex
    return tex
  }, [p.fillHypsometric, p.gradientStops])

  /**
   * The satellite drape.
   *
   * Disposed on replacement rather than left to the collector: a fetch can be
   * repeated for a different scene, and each one is a full-resolution RGBA
   * texture the GPU is holding.
   */
  const imageryTexRef = useRef(null)
  const imageryTex = useMemo(() => {
    imageryTexRef.current?.dispose()
    if (!p.imagery?.url) { imageryTexRef.current = null; return null }
    const tex = new THREE.TextureLoader().load(p.imagery.url)
    tex.colorSpace = THREE.SRGBColorSpace
    imageryTexRef.current = tex
    return tex
  }, [p.imagery])

  const overlayTex = useMemo(() => {
    if (!textureImage) return null
    const loader = new THREE.TextureLoader()
    const tex = loader.load(textureImage)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  }, [textureImage])

  // Only the cast-shadow and AO branches sample the heightmap texture, and both
  // are off by default — so this used to hand the GPU a full-resolution R32F
  // copy of the raster (268 MB for an 8k GeoTIFF) that nothing ever read.
  const needsHeightmapTex = !!(p.hillshadeCastShadows || p.showAO || p.showOpenness)

  const hmTexRef = useRef(null)
  const heightmapTex = useMemo(() => {
    hmTexRef.current?.dispose()
    if (!needsHeightmapTex || !heightmapPixels || !heightmapWidth || !heightmapHeight) {
      hmTexRef.current = null
      return null
    }
    // Capped, because the consumers cannot resolve more: both ray-march at most
    // 128 steps with a stride that grows to ~14 cells, so detail past a couple of
    // thousand samples across is averaged away regardless. 2048² is a 16× cut at
    // 8k with no visible difference.
    const { pixels, width, height } = downsampleRaster(
      heightmapPixels, heightmapWidth, heightmapHeight, MAX_SHADOW_TEX
    )
    const tex = new THREE.DataTexture(
      pixels, width, height,
      THREE.RedFormat, THREE.FloatType
    )
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.flipY     = true
    tex.needsUpdate = true
    hmTexRef.current = tex
    return tex
  }, [needsHeightmapTex, heightmapPixels, heightmapWidth, heightmapHeight])

  // ── Surface fields ──────────────────────────────────────────────────────
  // Computed on the main thread, and only for the layers that are on. A new
  // surface arrives on many rebuilds that do not change the ground at all, so
  // each field is cached by a key of the grid's content and its own settings,
  // and a rebuild that only moved a line costs one scan of the grid.
  const localLight = !!(p.showHillshade && p.hillshadeLocal && !p.hillshadeMultiDir)
  const needFields = !!(p.showLocalRelief || p.showCurvShade || p.showTexShade || p.showWetness || p.showSunTint || localLight)
  const fieldCache = useRef(new Map())
  const fields = useMemo(() => {
    if (!needFields || !surfaceGeo) return null
    const g = fieldGrid(surfaceGeo, p.resolution ?? 1)
    if (!g) return null
    const key = gridKey(g), cache = fieldCache.current, used = new Set()
    const get = (name, params, fn) => {
      const k = `${name}|${key}|${params}`
      used.add(k)
      if (!cache.has(k)) cache.set(k, fn())
      return cache.get(k)
    }
    // Radii are in world units, like every spacing in the app; a field cell
    // spans `g.scl` of them.
    const cells = (w) => Math.max(1, (w ?? 1) / g.scl)
    const lat = latitudeFor({ ...p, latSunHours: p.hillshadeLat }).lat
    const a = [
      p.showLocalRelief ? get('relief', p.localReliefRadius, () => localReliefField(g, cells(p.localReliefRadius ?? 40))) : null,
      p.showCurvShade ? get('curv', p.curvShadeRadius, () => curvatureField(g, cells(p.curvShadeRadius ?? 8))) : null,
      p.showTexShade ? get('tex', p.texShadeDetail, () => textureShadeField(g, p.texShadeDetail ?? 0.8)) : null,
      p.showWetness ? get('wet', '', () => wetnessField(g)) : null,
    ]
    const sunKey = `${p.sunTintPeriod}|${p.hillshadeDate}|${lat}|${p.elevScale}`
    const b = [p.showSunTint ? get('sun', sunKey, () => sunHoursTint(g, {
      elevScale: p.elevScale || 1, lat, period: p.sunTintPeriod ?? 'year', date: p.hillshadeDate })) : null,
      ...(localLight ? get('light', p.hillshadeLocalRadius, () => localLightField(g, cells(p.hillshadeLocalRadius ?? 30))) : [null, null])]
    // Keep only what this build used: the cache holds one grid's fields, not a history.
    for (const k of cache.keys()) if (!used.has(k)) cache.delete(k)
    return { g, a: packFields(g, a), b: packFields(g, b) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needFields, surfaceGeo, p.resolution, p.showLocalRelief, p.localReliefRadius, p.showCurvShade,
      p.curvShadeRadius, p.showTexShade, p.texShadeDetail, p.showWetness, p.showSunTint,
      p.sunTintPeriod, p.hillshadeDate, p.hillshadeLat, p.elevScale, p.geoTiffBbox, p.geoTiffCRS,
      localLight, p.hillshadeLocalRadius])

  const fieldTexRef = useRef([null, null])
  const fieldTex = useMemo(() => {
    for (const t of fieldTexRef.current) t?.dispose()
    if (!fields) { fieldTexRef.current = [null, null]; return null }
    const make = (data) => {
      const t = new THREE.DataTexture(data, fields.g.cols, fields.g.rows, THREE.RGBAFormat, THREE.FloatType)
      t.minFilter = THREE.LinearFilter
      t.magFilter = THREE.LinearFilter
      t.needsUpdate = true
      return t
    }
    const pair = [make(fields.a), make(fields.b)]
    fieldTexRef.current = pair
    return pair
  }, [fields])
  useEffect(() => () => { for (const t of fieldTexRef.current) t?.dispose() }, [])

  // Built once, then driven by the uniform-sync effects below — see the note there
  // on why uniforms and render state are set rather than rebuilt.
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    side:           THREE.DoubleSide,
    depthWrite:     true,
    polygonOffset:       true,
    polygonOffsetFactor: p.occlusionBias ?? 2,
    polygonOffsetUnits:  p.occlusionBias ?? 2,
    uniforms: {
      uFillColor:         { value: new THREE.Vector3(1, 1, 1) },
      uGradient:          { value: false },
      uRawTerrain:        { value: false },
      uRawMin:            { value: 0 },
      uRawMax:            { value: 1 },
      uFlatten:           { value: false },
      uGradientTex:       { value: null },
      uHypsometricBanded: { value: false },
      uContourInterval:   { value: 1.0 },
      uHypsoWeight:       { value: 0.0 },
      uElevScale:         { value: 1.0 },
      uColorMode:         { value: 0 },
      uElevMinCut:        { value: 0.0 },
      uElevMaxCut:        { value: 100.0 },
      uOverlayTex:        { value: null },
      uShowTexture:         { value: false },
      uShowImagery:         { value: false },
      uImageryTex:          { value: null },
      uImageryOpacity:      { value: 0.85 },
      uImageryLo:           { value: new THREE.Vector3(0, 0, 0) },
      uImageryHi:           { value: new THREE.Vector3(255, 255, 255) },
      uImageryGamma:        { value: 1 },
      uImageryBrightness:   { value: 1 },
      uImageryContrast:     { value: 1 },
      uImagerySaturation:   { value: 1 },
      uTextureScale:        { value: 1.0 },
      uTextureOffset:       { value: new THREE.Vector2(0, 0) },
      uTextureBlendMode:    { value: 0 },
      uTextureOpacity:      { value: 1.0 },
      uHillshade:             { value: false },
      uHillshadeAzimuth:      { value: 315.0 },
      uHillshadeAltitude:     { value: 45.0 },
      uHillshadeIntensity:    { value: 1.0 },
      uHillshadeOpacity:      { value: 0.6 },
      uHillshadeExaggeration: { value: 2.0 },
      uHillshadeHighlight:    { value: new THREE.Vector3(1, 1, 1) },
      uHillshadeShadow:       { value: new THREE.Vector3(0, 0, 0) },
      uCastShadows:           { value: false },
      uHeightmapTex:          { value: null },
      uHeightmapCols:         { value: 256.0 },
      uHeightmapRows:         { value: 256.0 },
      uShadowStepH:           { value: 0.01 },
      uShadowSteps:           { value: 64 },
      uShadowSoftness:        { value: 1.5 },
      uShadowDarkness:        { value: 0.85 },
      uSlopeShade:            { value: false },
      uSlopeShadeOpacity:     { value: 0.75 },
      uSlopeColorLow:         { value: new THREE.Vector3(0.525, 0.937, 0.6) },
      uSlopeColorHigh:        { value: new THREE.Vector3(0.863, 0.149, 0.149) },
      uHillshadeMultiDir:     { value: false },
      uHillshadeLocal:        { value: false },
      uHillshadeLocalTurn:    { value: 45 },
      uAO:                    { value: false },
      uAOStrength:            { value: 0.7 },
      uAORays:                { value: 8 },
      uWaterFill:             { value: false },
      uWaterLevel:            { value: 0.3 },
      uWaterColor:            { value: new THREE.Vector3(0.102, 0.471, 0.761) },
      uWaterOpacity:          { value: 0.82 },
      uAspectMap:             { value: false },
      uAspectMapOpacity:      { value: 0.8 },
      uAspectBivariate:       { value: true },
      uAspectFull:            { value: 30 },
      uSlopeShadeMax:         { value: 45 },
      uSlopeShadeBand:        { value: 0 },
      uSlopeShadeTrue:        { value: true },
      uTrueK:                 { value: 1 },
      uFieldTex:              { value: null },
      uFieldTex2:             { value: null },
      uFieldSize:             { value: new THREE.Vector2(2, 2) },
      uLocalRelief:           { value: false },
      uLocalReliefGain:       { value: 1 },
      uLocalReliefOpacity:    { value: 0.8 },
      uLocalReliefLow:        { value: new THREE.Vector3(0.18, 0.36, 0.54) },
      uLocalReliefHigh:       { value: new THREE.Vector3(0.71, 0.28, 0.18) },
      uCurvShade:             { value: false },
      uCurvShadeGain:         { value: 1 },
      uCurvShadeOpacity:      { value: 0.8 },
      uCurvShadeConvex:       { value: new THREE.Vector3(0.75, 0.34, 0.1) },
      uCurvShadeConcave:      { value: new THREE.Vector3(0.18, 0.4, 0.56) },
      uTexShade:              { value: false },
      uTexShadeContrast:      { value: 1 },
      uTexShadeOpacity:       { value: 0.8 },
      uWetness:               { value: false },
      uWetnessFrom:           { value: 0.55 },
      uWetnessOpacity:        { value: 0.8 },
      uWetnessColor:          { value: new THREE.Vector3(0.12, 0.44, 0.71) },
      uSunTint:               { value: false },
      uSunTintOpacity:        { value: 0.7 },
      uSunTintShade:          { value: new THREE.Vector3(0.18, 0.29, 0.48) },
      uSunTintSun:            { value: new THREE.Vector3(0.94, 0.76, 0.29) },
      uOpenness:              { value: false },
      uOpennessRed:           { value: true },
      uOpennessGain:          { value: 1.5 },
      uOpennessOpacity:       { value: 0.85 },
      uOpennessSteps:         { value: 32 },
      uOpennessRedFull:       { value: 45 },
      uAerial:                { value: false },
      uAerialStrength:        { value: 0.6 },
      uAerialColor:           { value: new THREE.Vector3(0.44, 0.56, 0.69) },
      uAerialGamma:           { value: 1.6 },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    if (!surfMat) return
    const hasHypso = p.fillHypsometric
    const isBanded = hasHypso && p.fillBanded
    
    surfMat.uniforms.uFillColor.value.set(...hexToRgb(p.fillColor ?? '#ffffff'))
    surfMat.uniforms.uGradient.value = hasHypso && !isBanded
    const rawView = !!(p.showRawTerrain)
    surfMat.uniforms.uRawTerrain.value = rawView
    surfMat.uniforms.uFlatten.value    = rawView
    // Brightness bounds ride in with the geometry, so they already track the
    // resolution, blur and black/white point the grid was built with.
    surfMat.uniforms.uRawMin.value     = surfaceGeo?.metadata?.minB ?? 0
    surfMat.uniforms.uRawMax.value     = surfaceGeo?.metadata?.maxB ?? 1
    surfMat.uniforms.uHypsometricBanded.value = isBanded
    surfMat.uniforms.uContourInterval.value = p.fillHypsoInterval || 10.0
    surfMat.uniforms.uHypsoWeight.value = p.fillHypsoWeight || 0.0
    // The shader divides by this (banded hypsometric, and uShadowStepH below), so
    // 0 has no usable value and substituting 1 is the only sane answer — but it
    // has to be the SAME answer in both places. It was not: this line used `||`
    // (→ 1) and uShadowStepH used `??` (→ 0 → Infinity), 27 lines apart, so at
    // elevScale 0 cast shadows silently stopped while banding carried on at a
    // different scale. elevScale reaches exactly 0 in one drag.
    const elevScaleSafe = p.elevScale || 1.0
    surfMat.uniforms.uElevScale.value = elevScaleSafe
    surfMat.uniforms.uColorMode.value = { elevation: 0, slope: 1, aspect: 2 }[p.fillHypsoMode] ?? 0
    // These two, by contrast, take 0 as a real value — `||` here meant dragging
    // High cut to 0 fell back to 100, leaving the fill fully visible while
    // every line layer was culled.
    surfMat.uniforms.uElevMinCut.value = p.elevMinCut ?? 0.0
    surfMat.uniforms.uElevMaxCut.value = p.elevMaxCut ?? 100.0
    
    surfMat.uniforms.uShowImagery.value = !!(p.showImagery && imageryTex)
    if (imageryTex) surfMat.uniforms.uImageryTex.value = imageryTex
    surfMat.uniforms.uImageryOpacity.value = p.imageryOpacity ?? 0.85
    const tone = toneFor(p.imagery, p)
    surfMat.uniforms.uImageryLo.value.set(...tone.lo)
    surfMat.uniforms.uImageryHi.value.set(...tone.hi)
    surfMat.uniforms.uImageryGamma.value = tone.gamma
    surfMat.uniforms.uImageryBrightness.value = tone.brightness
    surfMat.uniforms.uImageryContrast.value = tone.contrast
    surfMat.uniforms.uImagerySaturation.value = tone.saturation
    surfMat.uniforms.uShowTexture.value = !!(p.showTexture && overlayTex)
    surfMat.uniforms.uOverlayTex.value = overlayTex
    surfMat.uniforms.uTextureScale.value = 1.0 / (p.textureScale || 1.0)
    surfMat.uniforms.uTextureOffset.value.set(p.textureShiftX || 0, p.textureShiftY || 0)
    surfMat.uniforms.uTextureBlendMode.value = { normal: 0, multiply: 1, screen: 2, overlay: 3, softlight: 4, add: 5 }[p.textureBlendMode] ?? 0
    surfMat.uniforms.uTextureOpacity.value = p.textureOpacity ?? 1.0

    surfMat.uniforms.uHillshade.value             = !!(p.showHillshade)
    surfMat.uniforms.uHillshadeAzimuth.value      = p.hillshadeAzimuth      ?? 315
    surfMat.uniforms.uHillshadeAltitude.value     = p.hillshadeAltitude     ?? 45
    surfMat.uniforms.uHillshadeIntensity.value    = p.hillshadeIntensity    ?? 1.0
    surfMat.uniforms.uHillshadeOpacity.value      = p.hillshadeOpacity      ?? 0.6
    surfMat.uniforms.uHillshadeExaggeration.value = p.hillshadeExaggeration ?? 2.0
    surfMat.uniforms.uHillshadeHighlight.value.set(...hexToRgb(p.hillshadeHighlightColor ?? '#ffffff'))
    surfMat.uniforms.uHillshadeShadow.value.set(...hexToRgb(p.hillshadeShadowColor   ?? '#000000'))

    const cols = surfaceGeo?.metadata?.cols ?? heightmapWidth ?? 256
    const rows = surfaceGeo?.metadata?.rows ?? heightmapHeight ?? 256
    surfMat.uniforms.uCastShadows.value    = !!(p.hillshadeCastShadows && heightmapTex)
    surfMat.uniforms.uHeightmapTex.value   = heightmapTex ?? null
    surfMat.uniforms.uHeightmapCols.value  = cols
    surfMat.uniforms.uHeightmapRows.value  = rows
    surfMat.uniforms.uShadowStepH.value    = (p.resolution ?? 1) / (elevScaleSafe * 100)
    surfMat.uniforms.uShadowSteps.value    = p.hillshadeShadowSteps   ?? 64
    surfMat.uniforms.uShadowSoftness.value = p.hillshadeShadowSoftness ?? 1.5
    surfMat.uniforms.uShadowDarkness.value = p.hillshadeShadowDarkness ?? 0.85

    surfMat.uniforms.uSlopeShade.value        = !!(p.showSlopeShade)
    surfMat.uniforms.uSlopeShadeOpacity.value = p.slopeShadeOpacity ?? 0.75
    surfMat.uniforms.uSlopeColorLow.value.set(...hexToRgb(p.slopeColorLow   ?? '#86efac'))
    surfMat.uniforms.uSlopeColorHigh.value.set(...hexToRgb(p.slopeColorHigh ?? '#dc2626'))

    surfMat.uniforms.uHillshadeMultiDir.value  = !!(p.hillshadeMultiDir)
    surfMat.uniforms.uHillshadeLocal.value     = !!(p.showHillshade && p.hillshadeLocal && fieldTex)
    surfMat.uniforms.uHillshadeLocalTurn.value = p.hillshadeLocalTurn ?? 45
    surfMat.uniforms.uAO.value                 = !!(p.showAO)
    surfMat.uniforms.uAOStrength.value         = p.aoStrength   ?? 0.7
    surfMat.uniforms.uAORays.value             = p.aoRays       ?? 8
    surfMat.uniforms.uWaterFill.value          = !!(p.showWaterFill)
    surfMat.uniforms.uWaterLevel.value         = p.waterLevel   ?? 0.3
    surfMat.uniforms.uWaterColor.value.set(...hexToRgb(p.waterColor ?? '#1a78c2'))
    surfMat.uniforms.uWaterOpacity.value       = p.waterOpacity ?? 0.82
    surfMat.uniforms.uAspectMap.value          = !!(p.showAspectMap)
    surfMat.uniforms.uAspectMapOpacity.value   = p.aspectMapOpacity ?? 0.8
    surfMat.uniforms.uAspectBivariate.value    = p.aspectMapBivariate !== false
    surfMat.uniforms.uAspectFull.value         = p.aspectMapFull ?? 30
    surfMat.uniforms.uSlopeShadeMax.value      = p.slopeShadeMax ?? 45
    surfMat.uniforms.uSlopeShadeBand.value     = p.slopeShadeBand ?? 0
    surfMat.uniforms.uSlopeShadeTrue.value     = p.slopeShadeTrue !== false

    // Metres per world unit, down and across. A GeoTIFF answers both itself; a
    // plain heightmap takes them from the panel, as the draw modes do.
    const px = p.geoTiffBbox && p.geoTiffCRS ? groundPixelMetres(p.geoTiffBbox, p.geoTiffCRS, p.imageWidth, p.imageHeight) : null
    const across = px ? (px.x + px.y) / 2 : (p.groundCellMetres ?? 10)
    const down = metresPerWorldUnit(p.geoTiffElevMin, p.geoTiffElevMax, elevScaleSafe, p.blackPoint, p.whitePoint)
      ?? (p.groundRelief ?? 1000) / (100 * Math.abs(elevScaleSafe))
    surfMat.uniforms.uTrueK.value = down / (across || 1)

    const [ta, tb] = fieldTex ?? [null, null]
    surfMat.uniforms.uFieldTex.value  = ta
    surfMat.uniforms.uFieldTex2.value = tb
    if (fields) surfMat.uniforms.uFieldSize.value.set(fields.g.cols, fields.g.rows)
    surfMat.uniforms.uLocalRelief.value        = !!(p.showLocalRelief && ta)
    surfMat.uniforms.uLocalReliefGain.value    = p.localReliefGain ?? 1
    surfMat.uniforms.uLocalReliefOpacity.value = p.localReliefOpacity ?? 0.8
    surfMat.uniforms.uLocalReliefLow.value.set(...hexToRgb(p.localReliefLow ?? '#2f5d8a'))
    surfMat.uniforms.uLocalReliefHigh.value.set(...hexToRgb(p.localReliefHigh ?? '#b5472d'))
    surfMat.uniforms.uCurvShade.value          = !!(p.showCurvShade && ta)
    surfMat.uniforms.uCurvShadeGain.value      = p.curvShadeGain ?? 1
    surfMat.uniforms.uCurvShadeOpacity.value   = p.curvShadeOpacity ?? 0.8
    surfMat.uniforms.uCurvShadeConvex.value.set(...hexToRgb(p.curvShadeConvex ?? '#c0561a'))
    surfMat.uniforms.uCurvShadeConcave.value.set(...hexToRgb(p.curvShadeConcave ?? '#2f6690'))
    surfMat.uniforms.uTexShade.value           = !!(p.showTexShade && ta)
    surfMat.uniforms.uTexShadeContrast.value   = p.texShadeContrast ?? 1.2
    surfMat.uniforms.uTexShadeOpacity.value    = p.texShadeOpacity ?? 0.8
    surfMat.uniforms.uWetness.value            = !!(p.showWetness && ta)
    surfMat.uniforms.uWetnessFrom.value        = p.wetnessFrom ?? 0.45
    surfMat.uniforms.uWetnessOpacity.value     = p.wetnessOpacity ?? 0.8
    surfMat.uniforms.uWetnessColor.value.set(...hexToRgb(p.wetnessColor ?? '#1f6fb5'))
    surfMat.uniforms.uSunTint.value            = !!(p.showSunTint && tb)
    surfMat.uniforms.uSunTintOpacity.value     = p.sunTintOpacity ?? 0.7
    surfMat.uniforms.uSunTintShade.value.set(...hexToRgb(p.sunTintShade ?? '#2d4a7a'))
    surfMat.uniforms.uSunTintSun.value.set(...hexToRgb(p.sunTintSun ?? '#f0c24b'))
    surfMat.uniforms.uOpenness.value           = !!(p.showOpenness && heightmapTex)
    surfMat.uniforms.uOpennessRed.value        = p.opennessRed !== false
    surfMat.uniforms.uOpennessGain.value       = p.opennessGain ?? 1.5
    surfMat.uniforms.uOpennessOpacity.value    = p.opennessOpacity ?? 0.85
    surfMat.uniforms.uOpennessSteps.value      = Math.round(p.opennessReach ?? 32)
    surfMat.uniforms.uOpennessRedFull.value    = p.opennessRedFull ?? 45
    surfMat.uniforms.uAerial.value             = !!(p.showAerial)
    surfMat.uniforms.uAerialStrength.value     = p.aerialStrength ?? 0.6
    surfMat.uniforms.uAerialColor.value.set(...hexToRgb(p.aerialColor ?? '#6f8fb0'))
    surfMat.uniforms.uAerialGamma.value        = p.aerialGamma ?? 1.6

    const anyFill = hasFillLayer(p)
    surfMat.colorWrite = anyFill
    surfMat.depthTest  = !!p.depthOcclusion
    surfMat.depthWrite = !!(p.depthOcclusion && anyFill)
    surfMat.polygonOffsetFactor = p.occlusionBias ?? 2
    surfMat.polygonOffsetUnits  = p.occlusionBias ?? 2
    // No needsUpdate: only uniform values and render-state flags change here,
    // neither requires a program rebuild — and this effect runs on every render
    // (p is a fresh object), so flagging it would re-validate the program per frame.
  }, [surfMat, p, imageryTex, overlayTex, heightmapTex, surfaceGeo, heightmapWidth, heightmapHeight, fieldTex, fields])

  useEffect(() => {
    if (!surfMat) return
    surfMat.uniforms.uGradientTex.value = gradientTex
  }, [surfMat, gradientTex])

  // One cleanup per resource, each keyed only on what it owns. Grouping these
  // disposed the (never-recreated) shader material and the heightmap DataTexture
  // every time the overlay texture changed — forcing a shader recompile and a
  // re-upload of the full float heightmap on a control that should touch neither.
  useEffect(() => () => surfMat?.dispose(), [surfMat])
  useEffect(() => () => overlayTex?.dispose(), [overlayTex])
  useEffect(() => () => hmTexRef.current?.dispose(), [])
  useEffect(() => () => gradTexRef.current?.dispose(), [])

  // Seed colour only; the effect below tracks p.meshColor.
  const wireMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:               new THREE.Color(p.meshColor ?? '#888888'),
    wireframe:           true,
    transparent:         true,
    opacity:             0.25,
    depthWrite:          false,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  1,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    if (wireMat) wireMat.color.set(p.meshColor ?? '#888888')
  }, [wireMat, p.meshColor])

  if (!geometry) return null

  // When no fill layer is active the surface pass writes neither color nor
  // depth (colorWrite=false; depthWrite requires anyFill) — rasterizing the
  // full mesh through the heavyweight fragment shader would be a per-frame
  // no-op. Skip it entirely, except in profile mode where the mesh must stay
  // visible as the raycast target for elevation-profile clicks.
  const surfaceActive = hasFillLayer(p) || !!p.profileMode

  // Profile picking raycasts the *geometry*, which raw view leaves at its real
  // elevation while drawing it flat — so a click would land somewhere other than
  // where it was aimed. Disable it rather than report a wrong elevation.
  const canPick = !!p.profileMode && !p.showRawTerrain

  return (
    <group>
      <mesh
        geometry={geometry}
        material={surfMat}
        visible={surfaceActive}
        onPointerDown={canPick ? (e) => { e.stopPropagation(); if (e.uv) profileClickRef?.current?.(e.uv) } : undefined}
      />
      {p.showMesh && !p.showRawTerrain && <mesh geometry={geometry} material={wireMat} />}
    </group>
  )
}

// ── The ground as an occluder ─────────────────────────────────────────────────

const GROUND_VERT = /* glsl */ `
  attribute float brightness;
  varying float vBrightness;
  void main() {
    vBrightness = brightness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
// Depth only, with the surface's own elevation cut: ground the cut has removed
// hides nothing, exactly as the fill would not.
const GROUND_FRAG = /* glsl */ `
  uniform float uRawMin;
  uniform float uRawMax;
  uniform float uElevMinCut;
  uniform float uElevMaxCut;
  varying float vBrightness;
  void main() {
    float cut = clamp((vBrightness - uRawMin) / max(uRawMax - uRawMin, 1e-5), 0.0, 1.0);
    if (cut < uElevMinCut / 100.0 || cut > uElevMaxCut / 100.0) discard;
    gl_FragColor = vec4(0.0);
  }
`

/** The order the ground's depth is written in: after the occluders (0) and the
 *  layers that live inside the ground, before every other layer (1 and up). */
export const GROUND_ORDER = 0.5

/**
 * Occlusion by the ground (*Occluder: Ground*).
 *
 * The terrain hides what is behind it whether or not a fill is shown: the
 * surface is drawn into the depth buffer only, with the skirt that closes it
 * into a solid at its edges (see `buildSkirt` in builders/surface.js). With a
 * fill on, the fill already writes the sheet's depth, so only the skirt is
 * drawn here. Transparent, and at `GROUND_ORDER`, so it lands after Pillars'
 * and Stems' lines, which live inside the ground and are drawn in a band below
 * it (HeightmapLines.jsx) — the ground must not hide them.
 *
 * Off with the camera underneath (tilt over 90°), as the curtains are, so the
 * lines can be seen from below.
 */
export function GroundOccluder({ surfaceGeo, p }) {
  const on = !!(p.depthOcclusion && p.occludeBy === 'ground' && !p.showRawTerrain &&
                (p.tilt == null || p.tilt <= 90))
  const sheet = on && !hasFillLayer(p)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    uniforms: {
      uRawMin: { value: 0 }, uRawMax: { value: 1 },
      uElevMinCut: { value: 0 }, uElevMaxCut: { value: 100 },
    },
  }), [])
  useEffect(() => {
    mat.uniforms.uRawMin.value = surfaceGeo?.metadata?.minB ?? 0
    mat.uniforms.uRawMax.value = surfaceGeo?.metadata?.maxB ?? 1
    mat.uniforms.uElevMinCut.value = p.elevMinCut ?? 0
    mat.uniforms.uElevMaxCut.value = p.elevMaxCut ?? 100
    // The same push back as the surface's, so a line on the ground wins the tie.
    mat.polygonOffsetFactor = p.occlusionBias ?? 1
    mat.polygonOffsetUnits = p.occlusionBias ?? 1
  }, [mat, surfaceGeo, p.elevMinCut, p.elevMaxCut, p.occlusionBias])
  useEffect(() => () => mat.dispose(), [mat])

  const meshOf = (src) => {
    if (!src?.positions?.length || !src.indices?.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(src.positions, 3))
    geo.setAttribute('brightness', new THREE.BufferAttribute(src.brightnessBuf, 1))
    geo.setIndex(new THREE.BufferAttribute(src.indices, 1))
    if (src.sphere) geo.boundingSphere = toSphere(src.sphere)
    return geo
  }
  const sheetGeo = useMemo(() => meshOf(surfaceGeo), [surfaceGeo])
  const skirtGeo = useMemo(() => meshOf(surfaceGeo?.skirt), [surfaceGeo])
  useEffect(() => () => sheetGeo?.dispose(), [sheetGeo])
  useEffect(() => () => skirtGeo?.dispose(), [skirtGeo])

  if (!on) return null
  return (
    <group>
      {sheet && sheetGeo && <mesh geometry={sheetGeo} material={mat} renderOrder={GROUND_ORDER} />}
      {skirtGeo && <mesh geometry={skirtGeo} material={mat} renderOrder={GROUND_ORDER} />}
    </group>
  )
}
