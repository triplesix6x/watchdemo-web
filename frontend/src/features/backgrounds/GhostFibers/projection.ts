// GhostFibers by React Bits: https://github.com/DavidHDev/react-bits
// MIT + Commons Clause; full terms are distributed at /licenses/react-bits.txt.
// Column-major projection math shared by rendering and pointer hit testing.
// Keep operation order and ordinary number arrays: uniforms round only at WebGL upload.
export const frustum = (fov: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
};

export const multiply = (a: number[], b: number[]) => {
  const out: number[] = new Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
};

export const orientation = (yaw: number, pitch: number, roll: number) => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]) => {
    const out: number[] = new Array(9);
    for (let col = 0; col < 3; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        out[col * 3 + row] = a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
      }
    }
    return out;
  };
  return mul(rz, mul(rx, ry));
};

export const applyMat3 = (m: number[], v: number[]) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2]
];
