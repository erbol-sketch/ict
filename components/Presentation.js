'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Html, useProgress } from '@react-three/drei';
import * as THREE from 'three';

// slides.js находится в корневой папке проекта
import {
  slides,
  cameraPoints,
  paintingPoint,
  cloudPoints,
  cloudEntry
} from '../slides';

const SKY = '#a9d0f0';
const FLY_MS = 1900;
const VEIL_MS = 1200;

const cloudStart = slides.findIndex((s) => s.scene === 'clouds');

const sceneOf = (n) => slides[n]?.scene || 'room';

function Room({ visible }) {
  const { scene } = useGLTF('/room.glb');

  return <primitive object={scene} visible={visible} />;
}

function Clouds({ visible }) {
  const { scene } = useGLTF('/cloudy_mountain.glb');

  return (
    <group visible={visible}>
      <ambientLight intensity={1.4} color="#ffffff" />

      <directionalLight
        position={[160, 90, 60]}
        intensity={2.2}
        color="#fff3df"
      />

      <primitive object={scene} />
    </group>
  );
}

function Rig({ pose, from, rate = 1.6, sway = 0 }) {
  const { camera } = useThree();

  const base = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const init = useRef(false);

  useFrame((state, dt) => {
    if (!pose?.pos || !pose?.look) return;

    const target = new THREE.Vector3(...pose.pos);
    const lt = new THREE.Vector3(...pose.look);

    if (!init.current) {
      const f = from || pose;

      base.current.set(...f.pos);
      look.current.set(...f.look);

      init.current = true;
    }

    const k = 1 - Math.exp(-dt * rate);

    base.current.lerp(target, k);
    look.current.lerp(lt, k);

    camera.position.copy(base.current);

    if (sway) {
      const t = state.clock.elapsedTime;

      camera.position.x += Math.sin(t * 0.31) * sway;
      camera.position.y += Math.sin(t * 0.47) * sway * 0.6;
      camera.position.z += Math.cos(t * 0.27) * sway;
    }

    camera.lookAt(look.current);
  });

  return null;
}

function Loader() {
  const { progress } = useProgress();

  return (
    <Html center>
      <div style={{ color: '#fff', whiteSpace: 'nowrap' }}>
        Загрузка комнаты… {progress.toFixed(0)}%
      </div>
    </Html>
  );
}

function Panel({ s, active }) {
  if (s.layout === 'empty') return null;

  const cls = `panel ${
    s.layout === 'center' ? 'center' : ''
  } ${
    s.scene === 'clouds' ? 'sky' : ''
  } ${
    active ? '' : 'hidden'
  }`;

  return (
    <div className={cls}>
      {s.layout === 'center' ? (
        <>
          <h1>{s.title}</h1>
          <p className="sub">{s.subtitle}</p>
          <p className="key">{s.key}</p>
        </>
      ) : (
        <>
          {s.era && <div className="era">{s.era}</div>}

          <h2>{s.title}</h2>

          <ul>
            {(s.items || []).map(([b, t]) => (
              <li key={b}>
                <b>{b}:</b> {t}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Presentation() {
  const [i, setI] = useState(0);
  const [debug, setDebug] = useState(null);
  const [scene, setScene] = useState('room');
  const [veil, setVeil] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState(null);
  const [rewinding, setRewinding] = useState(false);

  const rewindingRef = useRef(false);
  const iRef = useRef(0);
  const sceneRef = useRef('room');

  iRef.current = i;

  const last = slides.length - 1;

  const go = (n) => {
    if (rewindingRef.current) return;

    setI((current) => {
      const next = typeof n === 'function' ? n(current) : n;
      return Math.max(0, Math.min(last, next));
    });
  };

  const back = () => {
    if (rewindingRef.current) return;

    if (iRef.current === last) {
      rewindingRef.current = true;
      setRewinding(true);
    } else {
      go((current) => current - 1);
    }
  };

  // Debug camera и управление клавиатурой
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);

    if (q.get('cam')) {
      const lookValue = q.get('look');

      if (lookValue) {
        setDebug({
          pos: q.get('cam').split(',').map(Number),
          look: lookValue.split(',').map(Number)
        });
      }

      const sc = q.get('scene') === 'clouds' ? 'clouds' : 'room';

      sceneRef.current = sc;
      setScene(sc);
    }

    const onKey = (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go((current) => current + 1);
      }

      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        back();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const want = sceneOf(i);

  // Переход между комнатой и облаками
  useEffect(() => {
    if (debug) return;

    if (want === sceneRef.current) {
      setVeil(false);
      setBusy(false);
      return;
    }

    setBusy(true);

    const t1 = setTimeout(() => {
      setVeil(true);
    }, FLY_MS);

    const t2 = setTimeout(() => {
      sceneRef.current = want;
      setEntry(want === 'room' ? paintingPoint : null);
      setScene(want);
    }, FLY_MS + VEIL_MS + 100);

    const t3 = setTimeout(() => {
      setVeil(false);
    }, FLY_MS + VEIL_MS + 250);

    const t4 = setTimeout(() => {
      setBusy(false);
    }, FLY_MS + VEIL_MS * 2 + 400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [want, debug]);

  // Автоматическая перемотка к первому слайду
  useEffect(() => {
    if (!rewinding || busy) return;

    if (i === 0) {
      rewindingRef.current = false;
      setRewinding(false);
      return;
    }

    const timer = setTimeout(() => {
      setI((current) => current - 1);
    }, 600);

    return () => clearTimeout(timer);
  }, [rewinding, busy, i]);

  // Положение камеры
  let pose;
  let from;
  let rate = 3;
  let sway = 0;

  if (debug) {
    pose = debug;
  } else if (scene === 'room') {
    pose = want === 'room'
      ? cameraPoints[i]
      : paintingPoint;

    from = entry || undefined;
  } else {
    pose = want === 'clouds'
      ? cloudPoints[i - cloudStart]
      : cloudEntry;

    from = cloudEntry;
    rate = 1.1;
    sway = 0.5;
  }

  const inClouds = scene === 'clouds';

  return (
    <>
      <div className="stage">
        <Canvas
          camera={{
            fov: 62,
            near: 0.1,
            far: 260,
            position: [0, 0, 5]
          }}
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            preserveDrawingBuffer: !!debug
          }}
        >
          {inClouds ? (
            <color attach="background" args={[SKY]} />
          ) : (
            <color attach="background" args={['#000000']} />
          )}

          {inClouds && (
            <fog attach="fog" args={[SKY, 70, 200]} />
          )}

          <Suspense fallback={<Loader />}>
            <Room visible={!inClouds} />
          </Suspense>

          <Suspense fallback={null}>
            <Clouds visible={inClouds} />
          </Suspense>

          <Rig
            key={scene}
            pose={pose}
            from={from}
            rate={rate}
            sway={debug ? 0 : sway}
          />
        </Canvas>
      </div>

      <div className={`veil ${veil ? 'on' : ''}`} />

      {!debug &&
        slides.map((s, n) => (
          <Panel
            key={n}
            s={s}
            active={n === i && !busy && !rewinding}
          />
        ))}

      {!debug && (
        <div className="nav">
          <button
            onClick={back}
            disabled={i === 0 || rewinding}
          >
            ←
          </button>

          <div className="dots">
            {slides.map((_, n) => (
              <div
                key={n}
                className={`dot ${n === i ? 'on' : ''}`}
                onClick={() => go(n)}
              />
            ))}
          </div>

          <button
            onClick={() => go(i + 1)}
            disabled={i === last}
          >
            →
          </button>
        </div>
      )}
    </>
  );
}

useGLTF.preload('/room.glb');
useGLTF.preload('/cloudy_mountain.glb');