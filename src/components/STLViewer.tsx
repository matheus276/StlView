import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";

type LandmarkKey = "A" | "P";

type LandmarkPoint = {
  label: LandmarkKey;
  marker: THREE.Object3D;
  point: THREE.Vector3;
};

type MeasurementState = {
  ap: number | null;
  ml: number | null;
  circumference: number | null;
  cephalicIndex: number | null;
  diagonalPlus30: number | null;
  diagonalMinus30: number | null;
  cvai: number | null;
};

const landmarkColors: Record<LandmarkKey, number> = {
  A: 0x2563eb,
  P: 0xf59e0b,
};

const initialMeasurements: MeasurementState = {
  ap: null,
  ml: null,
  circumference: null,
  cephalicIndex: null,
  diagonalPlus30: null,
  diagonalMinus30: null,
  cvai: null,
};

function disposeObject(object: THREE.Object3D | null) {
  if (!object) return;

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();

      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }
  });
}

function createMarker(point: THREE.Vector3, color: number) {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2, 24, 24),
    new THREE.MeshStandardMaterial({ color })
  );

  sphere.position.copy(point);
  return sphere;
}

function createMeasurementLine(from: THREE.Vector3, to: THREE.Vector3, color: number) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from, to]),
    new THREE.LineBasicMaterial({ color })
  );
}

function calculateMeasurements(points: Record<LandmarkKey, THREE.Vector3 | null>, mesh: THREE.Mesh | null): MeasurementState {
  console.log("calculateMeasurements");
  console.log("A", points.A);
  console.log("P", points.P);
  console.log("mesh", mesh);

  const a = points.A;
  const p = points.P;

  const ap = a && p ? a.distanceTo(p) : null;

  if (!a || !p || !mesh) {
    console.log({ ap, ml: null, circumference: null, cephalicIndex: null, diagonalPlus30: null, diagonalMinus30: null, cvai: null });
    return {
      ap,
      ml: null,
      circumference: null,
      cephalicIndex: null,
      diagonalPlus30: null,
      diagonalMinus30: null,
      cvai: null,
    };
  }

  const axisAP = p.clone().sub(a).normalize();
  const vertical = new THREE.Vector3(0, 0, 1);
  const axisLR = new THREE.Vector3().crossVectors(vertical, axisAP);

  if (axisLR.lengthSq() < 1e-6) {
    axisLR.set(1, 0, 0);
  } else {
    axisLR.normalize();
  }

  const axisZ = new THREE.Vector3().crossVectors(axisAP, axisLR).normalize();
  const center = new THREE.Vector3().addVectors(a, p).multiplyScalar(0.5);

  const geometry = mesh.geometry;
  if (!geometry.attributes.position) {
    return {
      ap,
      ml: null,
      circumference: null,
      cephalicIndex: null,
      diagonalPlus30: null,
      diagonalMinus30: null,
      cvai: null,
    };
  }

  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);

  const positions = geometry.attributes.position;
  const slicePoints: THREE.Vector3[] = [];
  const tolerance = 1;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i += 1) {
    vertex.set(
      positions.getX(i),
      positions.getY(i),
      positions.getZ(i)
    );

    vertex.applyMatrix4(mesh.matrixWorld);

    const distanceToPlane = axisZ.dot(vertex.clone().sub(center));

    if (Math.abs(distanceToPlane) < tolerance) {
      slicePoints.push(vertex.clone());
    }
  }

  if (slicePoints.length < 3) {
    return {
      ap,
      ml: null,
      circumference: null,
      cephalicIndex: null,
      diagonalPlus30: null,
      diagonalMinus30: null,
      cvai: null,
    };
  }

  let minAP = Infinity;
  let maxAP = -Infinity;
  let minLR = Infinity;
  let maxLR = -Infinity;

  for (const point of slicePoints) {
    const projectionAP = point.dot(axisAP);
    const projectionLR = point.dot(axisLR);

    if (projectionAP < minAP) minAP = projectionAP;
    if (projectionAP > maxAP) maxAP = projectionAP;
    if (projectionLR < minLR) minLR = projectionLR;
    if (projectionLR > maxLR) maxLR = projectionLR;
  }

  const aAuto = slicePoints.find((point) => point.dot(axisAP) === minAP) ?? slicePoints[0];
  const pAuto = slicePoints.find((point) => point.dot(axisAP) === maxAP) ?? slicePoints[0];
  const lAuto = slicePoints.find((point) => point.dot(axisLR) === minLR) ?? slicePoints[0];
  const rAuto = slicePoints.find((point) => point.dot(axisLR) === maxLR) ?? slicePoints[0];

  const ml = Math.max(1e-6, lAuto.distanceTo(rAuto));
  const apMeasured = Math.max(1e-6, aAuto.distanceTo(pAuto));

  const orderedSlicePoints = slicePoints
    .map((point) => ({ point, angle: Math.atan2(point.clone().sub(center).dot(axisLR), point.clone().sub(center).dot(axisAP)) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.point);

  let circumference = 0;
  for (let i = 1; i < orderedSlicePoints.length; i += 1) {
    circumference += orderedSlicePoints[i].distanceTo(orderedSlicePoints[i - 1]);
  }
  if (orderedSlicePoints.length > 1) {
    circumference += orderedSlicePoints[0].distanceTo(orderedSlicePoints[orderedSlicePoints.length - 1]);
  }

  const cephalicIndex = (ml / apMeasured) * 100;

  const theta = (30 * Math.PI) / 180;
  const direction30 = new THREE.Vector3()
    .copy(axisAP)
    .multiplyScalar(Math.cos(theta))
    .add(axisLR.clone().multiplyScalar(Math.sin(theta)));
  const directionMinus30 = new THREE.Vector3()
    .copy(axisAP)
    .multiplyScalar(Math.cos(theta))
    .sub(axisLR.clone().multiplyScalar(Math.sin(theta)));

  const raycaster = new THREE.Raycaster();
  const range = mesh.geometry.boundingSphere?.radius ? mesh.geometry.boundingSphere.radius * 4 : 1000;
  raycaster.near = 0;
  raycaster.far = range * 2;

  const start30 = center.clone().sub(direction30.clone().multiplyScalar(range));
  const end30 = center.clone().add(direction30.clone().multiplyScalar(range));
  raycaster.set(start30, end30.clone().sub(start30).normalize());
  const hits30 = raycaster.intersectObject(mesh, true).sort((a, b) => a.distance - b.distance);
  let diagonalPlus30: number | null = null;
  if (hits30.length >= 2) {
    diagonalPlus30 = hits30[0].point.distanceTo(hits30[hits30.length - 1].point);
  }

  const startMinus30 = center.clone().sub(directionMinus30.clone().multiplyScalar(range));
  const endMinus30 = center.clone().add(directionMinus30.clone().multiplyScalar(range));
  raycaster.set(startMinus30, endMinus30.clone().sub(startMinus30).normalize());
  const hitsMinus30 = raycaster.intersectObject(mesh, true).sort((a, b) => a.distance - b.distance);
  let diagonalMinus30: number | null = null;
  if (hitsMinus30.length >= 2) {
    diagonalMinus30 = hitsMinus30[0].point.distanceTo(hitsMinus30[hitsMinus30.length - 1].point);
  }

  const cvai = diagonalPlus30 && diagonalMinus30
    ? (Math.abs(diagonalPlus30 - diagonalMinus30) / Math.max(diagonalPlus30, diagonalMinus30)) * 100
    : null;

  console.log({ ap: apMeasured, ml, circumference, cephalicIndex, diagonalPlus30, diagonalMinus30, cvai, hits30: hits30.length, hitsMinus30: hitsMinus30.length });
  console.log("hits30 distances", hits30.map((hit) => hit.distance));
  console.log("hitsMinus30 distances", hitsMinus30.map((hit) => hit.distance));

  return {
    ap: apMeasured,
    ml,
    circumference,
    cephalicIndex,
    diagonalPlus30,
    diagonalMinus30,
    cvai,
  };
}

function formatMeasurement(value: number | null) {
  if (value === null) return "--";
  return value.toFixed(2);
}

function fitCameraToMesh(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera, controls: TrackballControls) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.radius;

  camera.position.copy(center.clone().add(new THREE.Vector3(0, 0, radius * 3)));
  camera.near = Math.max(radius / 100, 0.1);
  camera.far = Math.max(radius * 100, 1000);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(radius * 0.2, 1);
  controls.maxDistance = Math.max(radius * 20, 1000);
  controls.reset();
  controls.update();
}

export default function STLViewer() {
  const mountRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<TrackballControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const activeLandmarkRef = useRef<LandmarkKey>("A");

  const landmarkPointsRef = useRef<Record<LandmarkKey, LandmarkPoint | null>>({
    A: null,
    P: null,
  });
  const measurementLinesRef = useRef<THREE.Object3D[]>([]);

  const [loading, setLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [activeLandmark, setActiveLandmark] = useState<LandmarkKey>("A");
  const [measurements, setMeasurements] = useState<MeasurementState>(initialMeasurements);

  useEffect(() => {
    activeLandmarkRef.current = activeLandmark;
  }, [activeLandmark]);

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000000);
    camera.position.set(300, 300, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    container.appendChild(renderer.domElement);

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 8;
    controls.zoomSpeed = 3;
    controls.panSpeed = 2;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.2;

    scene.add(new THREE.AmbientLight(0xffffff, 2.5));

    const d1 = new THREE.DirectionalLight(0xffffff, 3);
    d1.position.set(300, 300, 300);
    scene.add(d1);

    const d2 = new THREE.DirectionalLight(0xffffff, 2);
    d2.position.set(-300, -300, -300);
    scene.add(d2);

    const updateMeasurementObjects = () => {
      const sceneToUpdate = sceneRef.current;
      if (!sceneToUpdate) return;

      measurementLinesRef.current.forEach((line) => {
        sceneToUpdate.remove(line);
        disposeObject(line);
      });

      measurementLinesRef.current = [];

      const aPoint = landmarkPointsRef.current.A?.point;
      const pPoint = landmarkPointsRef.current.P?.point;
      if (aPoint && pPoint) {
        const line = createMeasurementLine(aPoint, pPoint, 0xff0000);
        sceneToUpdate.add(line);
        measurementLinesRef.current.push(line);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const mesh = meshRef.current;
      if (!mesh) return;

      mesh.updateMatrixWorld(true);
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeBoundingBox();

      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const hits = raycasterRef.current.intersectObject(mesh, true);

      const label = activeLandmarkRef.current;
      console.log("Clique:", label);
      console.log("A atual:", landmarkPointsRef.current.A?.point);
      console.log("P atual:", landmarkPointsRef.current.P?.point);
      console.log("Hits:", hits.length);
      if (hits[0]) {
        console.log("Point:", hits[0].point);
      }

      if (hits.length === 0) return;

      const point = hits[0].point.clone();
      const previous = landmarkPointsRef.current[label];

      if (previous) {
        scene.remove(previous.marker);
        disposeObject(previous.marker);
      }

      const marker = createMarker(point, landmarkColors[label]);
      scene.add(marker);

      const nextPoint = {
        label,
        marker,
        point,
      };

      landmarkPointsRef.current[label] = nextPoint;

      if (label === "A") {
        setActiveLandmark("P");
        console.log("Mudou para P");
      }

      const points = {
        A: landmarkPointsRef.current.A?.point ?? null,
        P: landmarkPointsRef.current.P?.point ?? null,
      };

      const hasA = landmarkPointsRef.current.A?.point;
      const hasP = landmarkPointsRef.current.P?.point;

      if (hasA && hasP) {
        const nextMeasurements = calculateMeasurements(points, meshRef.current);
        console.log("MEDIDAS:", nextMeasurements);
        setMeasurements(nextMeasurements);
      }

      updateMeasurementObjects();
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!mountRef.current) return;

      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;

      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      controls.handleResize();
    };

    window.addEventListener("resize", handleResize);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      controls.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  const clearMeasurements = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    (Object.values(landmarkPointsRef.current) as Array<LandmarkPoint | null>).forEach((entry) => {
      if (entry) {
        scene.remove(entry.marker);
        disposeObject(entry.marker);
      }
    });

    measurementLinesRef.current.forEach((line) => {
      scene.remove(line);
      disposeObject(line);
    });

    landmarkPointsRef.current = {
      A: null,
      P: null,
    };
    measurementLinesRef.current = [];
    setMeasurements(initialMeasurements);
  };

  const loadFile = (file: File) => {
    const scene = sceneRef.current;
    if (!scene) return;

    setLoading(true);
    clearMeasurements();

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();

      if (Array.isArray(meshRef.current.material)) {
        meshRef.current.material.forEach((material) => material.dispose());
      } else if (meshRef.current.material) {
        meshRef.current.material.dispose();
      }
    }

    const loader = new STLLoader();
    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target?.result;

      if (!(buffer instanceof ArrayBuffer)) {
        setLoading(false);
        return;
      }

      const geometry = loader.parse(buffer);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (box) {
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 200 / maxDim;
        geometry.scale(scale, scale, scale);
      }

      geometry.computeVertexNormals();
      geometry.center();

      const material = new THREE.MeshPhysicalMaterial({
        color: 0xcfcfcf,
        roughness: 0.35,
        metalness: 0.1,
        clearcoat: 0.3,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      scene.add(mesh);

      const camera = cameraRef.current;
      const controls = controlsRef.current;

      if (camera && controls) {
        fitCameraToMesh(mesh, camera, controls);
      }

      meshRef.current = mesh;
      setLoading(false);
      setModelLoaded(true);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
      }}
    >
      <div
        style={{
          width: 320,
          background: "#202020",
          color: "#fff",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Medições</h2>
        <p style={{ color: "#cbd5e1", marginBottom: 12 }}>
          Marque A e P no modelo. O sistema calculará automaticamente M, L e as demais medidas.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {(["A", "P"] as LandmarkKey[]).map((label) => (
            <button
              key={label}
              onClick={() => setActiveLandmark(label)}
              style={{
                border: activeLandmark === label ? "1px solid #fff" : "1px solid #4b5563",
                background: activeLandmark === label ? "#374151" : "#111827",
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <strong>Ponto ativo:</strong> {activeLandmark}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <strong>A-P:</strong> {formatMeasurement(measurements.ap)} mm
          </div>
          <div>
            <strong>M-L:</strong> {formatMeasurement(measurements.ml)} mm
          </div>
          <div>
            <strong>Circunferência:</strong> {formatMeasurement(measurements.circumference)} mm
          </div>
          <div>
            <strong>Índice Cefálico:</strong> {formatMeasurement(measurements.cephalicIndex)} %
          </div>
          <div>
            <strong>Diagonal +30°:</strong> {formatMeasurement(measurements.diagonalPlus30)} mm
          </div>
          <div>
            <strong>Diagonal -30°:</strong> {formatMeasurement(measurements.diagonalMinus30)} mm
          </div>
          <div>
            <strong>CVAI:</strong> {formatMeasurement(measurements.cvai)} %
          </div>
        </div>

        <button onClick={clearMeasurements} style={{ marginTop: 16 }}>
          Limpar pontos
        </button>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        {!modelLoaded && (
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 20,
              zIndex: 100,
              background: "white",
              padding: 12,
              borderRadius: 8,
            }}
          >
            <input
              type="file"
              accept=".stl"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadFile(file);
              }}
            />

            {loading && <p>Carregando...</p>}
          </div>
        )}

        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}