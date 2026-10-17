import type { ChromaKey } from '../model/types';

/**
 * Green/blue-screen keying on the GPU. One shared WebGL canvas processes a frame and is
 * immediately drawn by the caller, so it can be reused for the next clip.
 */
const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2((p.x + 1.0) / 2.0, 1.0 - (p.y + 1.0) / 2.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec3 keyColor;
uniform float similarity;
uniform float smoothness;
vec2 chroma(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
void main() {
  vec4 c = texture2D(tex, uv);
  float d = distance(chroma(c.rgb), chroma(keyColor));
  float a = smoothstep(similarity, similarity + smoothness, d);
  // Spill suppression: pull leftover key colour on edges towards grey.
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 rgb = mix(vec3(luma), c.rgb, clamp(a * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(rgb * a, a);
}`;

interface GL {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  uKey: WebGLUniformLocation;
  uSim: WebGLUniformLocation;
  uSmooth: WebGLUniformLocation;
}

let state: GL | null | undefined;

function init(): GL | null {
  if (state !== undefined) return state;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) return (state = null);
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    state = {
      canvas,
      gl,
      uKey: gl.getUniformLocation(prog, 'keyColor')!,
      uSim: gl.getUniformLocation(prog, 'similarity')!,
      uSmooth: gl.getUniformLocation(prog, 'smoothness')!,
    };
    return state;
  } catch (err) {
    console.warn('Chroma key unavailable', err);
    return (state = null);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 1, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Returns a canvas with the key colour made transparent, or null if WebGL is unavailable. */
export function applyChroma(
  src: TexImageSource,
  width: number,
  height: number,
  key: ChromaKey,
): HTMLCanvasElement | null {
  const s = init();
  if (!s) return null;
  const { gl, canvas } = s;
  // Cap the working size; keying a 4K frame at full size buys nothing on a 1080p canvas.
  const k = Math.min(1, 1920 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  } catch {
    return null;
  }
  gl.uniform3fv(s.uKey, hexToRgb(key.color));
  gl.uniform1f(s.uSim, key.similarity * 0.4);
  gl.uniform1f(s.uSmooth, Math.max(0.001, key.smoothness * 0.2));
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}
