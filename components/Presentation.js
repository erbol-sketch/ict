'use client';
import { Suspense, useEffect, useState, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Html, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { slides, cameraPoints, paintingPoint, cloudPoints, cloudEntry } from './slides';

const SKY = '#a9d0f0';
const FLY_MS = 1900;   // сколько камера летит к картине перед переходом
const VEIL_MS = 1200;  // длительность белой вспышки (CSS transition)

// индекс первого облачного слайда (6-й)
const cloudStart = slides.findIndex((s) => s.scene === 'clouds');
const sceneOf = (n) => slides[n].scene || 'room';

function Room({ visible }) {
  const { scene } = useGLTF('/room.glb');
  return <primitive object={scene} visible={visible} />;
}

function Clouds({ visible }) {
  const { scene } = useGLTF('/cloudy_mountain.glb');
  return (
    <group visible={visible}>
      <ambientLight intensity={1.4} color="#ffffff" />
      <directionalLight position={[160, 90, 60]} intensity={2.2} color="#fff3df" />
      <primitive object={scene} />
    </group>
  );
}

// from — откуда камера стартует при входе в сцену; pose — куда летит; sway — лёгкое покачивание
function Rig({ pose, from, rate = 1.6, sway = 0 }) {
  const { camera } = useThree();
  const base = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const init = useRef(false);

  useFrame((state, dt) => {
    const target = new THREE.Vector3(...pose.pos);
    const lt = new THREE.Vector3(...pose.look);
    if (!init.current) {
      const f = from || pose;
      base.current.set(...f.pos);
      look.current.set(...f.look);
      init.current = true;
    }
    // плавное, "киношное" движение (экспоненциальное затухание)
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
  return <Html center><div style={{ color: '#fff', whiteSpace: 'nowrap' }}>Загрузка комнаты… {progress.toFixed(0)}%</div></Html>;
}

function Panel({ s, active }) {
  if (s.layout === 'empty') return null;
  const cls = `panel ${s.layout === 'center' ? 'center' : ''} ${s.scene === 'clouds' ? 'sky' : ''} ${active ? '' : 'hidden'}`;
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
          <ul>{s.items.map(([b, t]) => <li key={b}><b>{b}:</b> {t}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export default function Presentation() {
  const [i, setI] = useState(0);
  const [debug, setDebug] = useState(null);
  const [scene, setScene] = useState('room'); // какая сцена показана сейчас
  const [veil, setVeil] = useState(false);    // белая вспышка между сценами
  const [busy, setBusy] = useState(false);    // идёт переход между сценами
  const [entry, setEntry] = useState(null);     // откуда вылетает камера при возврате в комнату
  const [rewinding, setRewinding] = useState(false); // автоперемотка к 1-му слайду
  const rewindingRef = useRef(false);
  const iRef = useRef(0);
  iRef.current = i;
  const sceneRef = useRef('room');
  const last = slides.length - 1;
  const go = (n) => {
    if (rewindingRef.current) return;
    setI((c) => Math.max(0, Math.min(last, typeof n === 'function' ? n(c) : n)));
  };
  const back = () => {
    if (rewindingRef.current) return;
    if (iRef.current === last) { rewindingRef.current = true; setRewinding(true); } // с последнего слайда — перемотка
    else go((c) => c - 1);
  };

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('cam')) {
      setDebug({ pos: q.get('cam').split(',').map(Number), look: q.get('look').split(',').map(Number) });
      const sc = q.get('scene') === 'clouds' ? 'clouds' : 'room';
      sceneRef.current = sc;
      setScene(sc);
    }
    const onKey = (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go((c) => c + 1); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Переход между сценами: room → (камера влетает в картину) → вспышка → облака, и обратно
  const want = sceneOf(i);
  useEffect(() => {
    if (debug) return;
    if (want === sceneRef.current) { setVeil(false); setBusy(false); return; }
    setBusy(true);
    const fly = FLY_MS;
    const t1 = setTimeout(() => setVeil(true), fly);
    const t2 = setTimeout(() => { sceneRef.current = want; setEntry(want === 'room' ? paintingPoint : null); setScene(want); }, fly + VEIL_MS + 100);
    const t3 = setTimeout(() => setVeil(false), fly + VEIL_MS + 250);
    const t4 = setTimeout(() => setBusy(false), fly + VEIL_MS * 2 + 400);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, [want, debug]);

  // Автоперемотка: раз в секунду шаг назад; на смене сцены ждём окончания перехода
  useEffect(() => {
    if (!rewinding || busy) return;
    if (i === 0) { rewindingRef.current = false; setRewinding(false); return; }
    const t = setTimeout(() => setI((c) => c - 1), 600);
    return () => clearTimeout(t);
  }, [rewinding, busy, i]);

  // Куда сейчас смотрит камера
  let pose, from, rate = 3, sway = 0;
  if (debug) {
    pose = debug;
  } else if (scene === 'room') {
    pose = want === 'room' ? cameraPoints[i] : paintingPoint; // к 6-му слайду — летим в картину
    from = entry || undefined;                                 // возврат из облаков: вылетаем из картины
  } else {
    pose = want === 'clouds' ? cloudPoints[i - cloudStart] : cloudEntry;
    from = cloudEntry;
    rate = 1.1;
    sway = 0.5;
  }
  // у каждой сцены свой Rig: при смене сцены камера стартует с нужной точки
  const inClouds = scene === 'clouds';

  return (
    <>
      <div className="stage">
        <Canvas camera={{ fov: 62, near: 0.1, far: 260, position: [0, 0, 5] }} dpr={[1, 1.5]} gl={{ antialias: true, preserveDrawingBuffer: !!debug }}>
          {inClouds ? <color attach="background" args={[SKY]} /> : <color attach="background" args={['#000000']} />}
          {inClouds && <fog attach="fog" args={[SKY, 70, 200]} />}
          <Suspense fallback={<Loader />}>
            <Room visible={!inClouds} />
          </Suspense>
          <Suspense fallback={null}>
            <Clouds visible={inClouds} />
          </Suspense>
          <Rig key={scene} pose={pose} from={from} rate={rate} sway={debug ? 0 : sway} />
        </Canvas>
      </div>
      <div className={`veil ${veil ? 'on' : ''}`} />
      {!debug && slides.map((s, n) => <Panel key={n} s={s} active={n === i && !busy && !rewinding} />)}
      {!debug && (
        <div className="nav">
          <button onClick={back} disabled={i === 0 || rewinding}>←</button>
          <div className="dots">{slides.map((_, n) => <div key={n} className={`dot ${n === i ? 'on' : ''}`} onClick={() => go(n)} />)}</div>
          <button onClick={() => go(i + 1)} disabled={i === last}>→</button>
        </div>
      )}
    </>
  );
}

useGLTF.preload('/room.glb');
useGLTF.preload('/cloudy_mountain.glb');