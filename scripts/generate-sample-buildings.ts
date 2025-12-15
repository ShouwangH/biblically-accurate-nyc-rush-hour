/**
 * Generate a sample glTF building model for testing.
 *
 * Creates a few simple box buildings in the local coordinate system.
 * Run with: npx tsx scripts/generate-sample-buildings.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple glTF 2.0 structure with box geometries
interface GltfBuffer {
  uri: string;
  byteLength: number;
}

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface GltfAccessor {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: string;
  max?: number[];
  min?: number[];
}

interface GltfMesh {
  name: string;
  primitives: Array<{
    attributes: { POSITION: number; NORMAL: number };
    indices: number;
  }>;
}

interface GltfNode {
  name: string;
  mesh: number;
  translation?: [number, number, number];
  scale?: [number, number, number];
}

interface Gltf {
  asset: { version: string; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: GltfNode[];
  meshes: GltfMesh[];
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  buffers: GltfBuffer[];
}

// Box geometry data (unit cube centered at origin)
const boxPositions = new Float32Array([
  // Front face
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  // Back face
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  // Top face
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
  // Bottom face
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  // Right face
  0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
  // Left face
  -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
]);

const boxNormals = new Float32Array([
  // Front
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  // Back
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  // Top
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  // Bottom
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
  // Right
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  // Left
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
]);

const boxIndices = new Uint16Array([
  0, 1, 2, 0, 2, 3, // front
  4, 5, 6, 4, 6, 7, // back
  8, 9, 10, 8, 10, 11, // top
  12, 13, 14, 12, 14, 15, // bottom
  16, 17, 18, 16, 18, 19, // right
  20, 21, 22, 20, 22, 23, // left
]);

// Sample building positions and sizes (in local coordinate system)
// These represent a small cluster of buildings around lower Manhattan
const buildings = [
  { name: 'Building_1', x: 1200, z: 800, width: 50, depth: 50, height: 150 },
  { name: 'Building_2', x: 1300, z: 750, width: 40, depth: 60, height: 200 },
  { name: 'Building_3', x: 1150, z: 900, width: 80, depth: 40, height: 100 },
  { name: 'Building_4', x: 1400, z: 850, width: 60, depth: 60, height: 250 },
  { name: 'Building_5', x: 1250, z: 700, width: 45, depth: 45, height: 180 },
];

function generateGltf(): { gltf: Gltf; binData: Buffer } {
  // Combine all binary data
  const positionBytes = Buffer.from(boxPositions.buffer);
  const normalBytes = Buffer.from(boxNormals.buffer);
  const indexBytes = Buffer.from(boxIndices.buffer);

  const binData = Buffer.concat([positionBytes, normalBytes, indexBytes]);

  const positionByteLength = positionBytes.length;
  const normalByteLength = normalBytes.length;
  const indexByteLength = indexBytes.length;

  const gltf: Gltf = {
    asset: {
      version: '2.0',
      generator: 'NYC Rush Hour Building Generator',
    },
    scene: 0,
    scenes: [{ nodes: buildings.map((_, i) => i) }],
    nodes: buildings.map((b, i) => ({
      name: b.name,
      mesh: 0, // All use the same box mesh
      translation: [b.x, b.height / 2, b.z] as [number, number, number], // Center vertically
      scale: [b.width, b.height, b.depth] as [number, number, number],
    })),
    meshes: [
      {
        name: 'Box',
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
            },
            indices: 2,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: 'VEC3',
        max: [0.5, 0.5, 0.5],
        min: [-0.5, -0.5, -0.5],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: 36,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: positionByteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: positionByteLength,
        byteLength: normalByteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: positionByteLength + normalByteLength,
        byteLength: indexByteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      },
    ],
    buffers: [
      {
        uri: 'buildings.bin',
        byteLength: binData.length,
      },
    ],
  };

  return { gltf, binData };
}

// Main
const outputDir = path.join(__dirname, '..', 'public', 'assets');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const { gltf, binData } = generateGltf();

// Write .gltf JSON
fs.writeFileSync(
  path.join(outputDir, 'buildings.sample.gltf'),
  JSON.stringify(gltf, null, 2)
);

// Write .bin data
fs.writeFileSync(path.join(outputDir, 'buildings.bin'), binData);

console.log('Generated sample building files:');
console.log(`  - ${path.join(outputDir, 'buildings.sample.gltf')}`);
console.log(`  - ${path.join(outputDir, 'buildings.bin')}`);
console.log(`  - ${buildings.length} buildings created`);
