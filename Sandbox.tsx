import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import * as CANNON from 'cannon-es';
import { db } from './lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function Sandbox() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [currentTool, setCurrentTool] = useState('Physics Gun');
  const [currency, setCurrency] = useState(100);
  const [gunPower, setGunPower] = useState(1);
  const [showShop, setShowShop] = useState(false);
  const [customUIs, setCustomUIs] = useState<Record<string, {html: string, style?: any}>>({});
  const [activeModNames, setActiveModNames] = useState<string[]>([]);
  const [gunMode, setGunMode] = useState('Grab'); // Grab, Repel, Attract
  const [scaleAxis, setScaleAxis] = useState('All'); // All, X, Y, Z
  const [showSpawnMenu, setShowSpawnMenu] = useState(false);
  const [showMaterialUI, setShowMaterialUI] = useState(false);
  const gunModeRef = useRef('Grab');
  useEffect(() => { gunModeRef.current = gunMode; }, [gunMode]);
  const scaleAxisRef = useRef('All');
  useEffect(() => { scaleAxisRef.current = scaleAxis; }, [scaleAxis]);
  const gunPowerRef = useRef(1);
  useEffect(() => { gunPowerRef.current = gunPower; }, [gunPower]);
  const [skyColorUI, setSkyColorUI] = useState('#87CEEB');


  useEffect(() => {
    if (!containerRef.current) return;

    // --- Configuration ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.add(camera);
    
    // View model (Gun)
    const gunGroup = new THREE.Group();
    const gunMaterial = new THREE.MeshStandardMaterial({color: 0x333333, metalness: 0.8, roughness: 0.2});
    const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 16), gunMaterial);
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position.set(0.3, -0.3, -0.5);
    const gunTip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({color: 0x00ffff}));
    gunTip.position.set(0, 0.3, 0);
    gunBarrel.add(gunTip);
    gunGroup.add(gunBarrel);
    camera.add(gunGroup);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    
    // Attach to DOM
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Remove previous elements if any
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }
    containerRef.current.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // Physics World
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -20, 0),
    });
    
    let isNight = false;
    let isGridSnapping = false;
    let currentHoveredRef = { current: null as THREE.Mesh | null };
    world.broadphase = new CANNON.NaiveBroadphase();
    (world.solver as CANNON.GSSolver).iterations = 10;

    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.4 }),
    ];

    const physicsMaterial = new CANNON.Material("standard");
    const physicsContactMaterial = new CANNON.ContactMaterial(
      physicsMaterial, physicsMaterial, 
      { friction: 0.3, restitution: 0.2 }
    );
    world.addContactMaterial(physicsContactMaterial);
    
    const customMaterials: Record<string, CANNON.Material> = {};

    const objectsToUpdate: { mesh: THREE.Mesh, body: CANNON.Body }[] = [];
    const interactableMeshes: THREE.Mesh[] = [];

    // Floor
    const floorTexture = new THREE.CanvasTexture((() => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ccc'; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#999'; ctx.fillRect(0, 0, 128, 128); ctx.fillRect(128, 128, 128, 128);
      return canvas;
    })());
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(50, 50);

    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8, metalness: 0.1 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
    floorBody.addShape(floorShape);
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(floorBody);

    // Player
    const playerRadius = 1;
    const playerShape = new CANNON.Sphere(playerRadius);
    const playerBody = new CANNON.Body({ 
      mass: 5, 
      material: physicsMaterial,
      fixedRotation: true,
      linearDamping: 0.9
    });
    playerBody.addShape(playerShape);
    playerBody.position.set(0, 5, 10);
    world.addBody(playerBody);

    let canJump = false;
    playerBody.addEventListener("collide", (e: any) => {
      const contact = e.contact;
      if (contact.ni.y > 0.5) canJump = true;
    });

    // Controls
    const controls = new PointerLockControls(camera, document.body);
    const onLock = () => setControlsLocked(true);
    const onUnlock = () => setControlsLocked(false);
    const onError = () => {
      console.warn("PointerLockAPI error: Unable to use Pointer Lock API or pointer lock disabled.");
      // Just visually alert or log it without crashing.
    };
    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);
    document.addEventListener('pointerlockerror', onError);

    const checkLock = () => controls.isLocked;

    // Keys
    const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false, Space: false, KeyE: false };
    
    // Player Properties
    const playerProps = {
      speed: 15,
      jumpVelocity: 10,
      health: 100,
    };
    let isNoclip = false;
    
    const onKeyDown = (e: KeyboardEvent) => {
      if (keys.hasOwnProperty(e.code)) (keys as any)[e.code] = true;
      if (e.code === 'Escape') {
          setShowSpawnMenu(false);
      }
      if (e.code === 'Digit1') spawnProp('box');
      if (e.code === 'Digit2') spawnProp('sphere');
      if (e.code === 'Digit3') spawnProp('cylinder');
      if (e.code === 'Digit4') spawnRagdoll();
      if (e.code === 'KeyQ') {
        const nextMode = gunModeRef.current === 'Grab' ? 'Repel' : gunModeRef.current === 'Repel' ? 'Attract' : (gunModeRef.current === 'Attract' ? 'Damage' : 'Grab');
        setGunMode(nextMode);
        gunTip.material.color.setHex(nextMode === 'Grab' ? 0x00ffff : nextMode === 'Repel' ? 0xff0000 : nextMode === 'Attract' ? 0x0000ff : 0xffa500);
        setCurrentTool(`Physics Gun (${nextMode})`);
      }
      if (e.code === 'KeyK') {
         if (gunModeRef.current === 'Scale') {
             const nextAxis = scaleAxisRef.current === 'All' ? 'X' : (scaleAxisRef.current === 'X' ? 'Y' : (scaleAxisRef.current === 'Y' ? 'Z' : 'All'));
             setScaleAxis(nextAxis);
             api.showMessage(`Scale Mode: ${nextAxis}-Axis`);
             setCurrentTool(`Scale Tool (${nextAxis} Axis)`);
         } else {
             setGunMode('Scale');
             gunTip.material.color.setHex(0x00ff00);
             setCurrentTool(`Scale Tool (${scaleAxisRef.current} Axis)`);
         }
      }
      if (e.code === 'KeyV') {
        isNoclip = !isNoclip;
        if (isNoclip) {
           playerBody.type = CANNON.Body.KINEMATIC;
           playerBody.collisionFilterMask = 0;
        } else {
           playerBody.type = CANNON.Body.DYNAMIC;
           playerBody.collisionFilterMask = 1;
           playerBody.wakeUp();
        }
        api.showMessage(isNoclip ? "Noclip Enabled" : "Noclip Disabled");
      }
      if (e.code === 'KeyE') {
        if (grabbedBody) {
          (grabbedBody as any).invertedGravity = !(grabbedBody as any).invertedGravity;
          api.showMessage((grabbedBody as any).invertedGravity ? "Gravity Inverted for Object" : "Gravity Restored");
        }
      }
      if (e.code === 'KeyP') {
         isNight = !isNight;
         if (isNight) {
            scene.background = new THREE.Color(0x050510);
            scene.fog!.color = new THREE.Color(0x050510);
            dirLight.intensity = 0.1;
            ambientLight.intensity = 0.1;
         } else {
            scene.background = new THREE.Color((window as any).currentSkyColor || 0x87CEEB);
            scene.fog!.color = new THREE.Color((window as any).currentSkyColor || 0x87CEEB);
            dirLight.intensity = 0.8;
            ambientLight.intensity = 0.6;
         }
         api.showMessage(isNight ? "Night Mode" : "Day Mode");
      }
      if (e.code === 'KeyN') {
         const obj = spawnProp('box', undefined, { mass: 5 });
         // Attach isNPC flag
         if (objectsToUpdate.length > 0) {
            (objectsToUpdate[objectsToUpdate.length - 1] as any).isNPC = true;
         }
         api.showMessage("NPC Spawned");
      }
      if (e.code === 'Backspace' || e.code === 'KeyX') {
         if (currentHoveredRef.current) {
            const currentHovered = currentHoveredRef.current;
            const body = currentHovered.userData.physicsBody as CANNON.Body;
            if (jointConstraint && grabbedBody === body) {
              world.removeConstraint(jointConstraint);
              jointConstraint = null;
              grabbedBody = null;
            }
            world.removeBody(body);
            scene.remove(currentHovered);
            objectsToUpdate.splice(objectsToUpdate.findIndex(o => o.mesh === currentHovered), 1);
            interactableMeshes.splice(interactableMeshes.indexOf(currentHovered), 1);
            currentHoveredRef.current = null;
            api.showMessage("Object Deleted");
         }
      }
      if (e.code === 'KeyC') {
         const targetHover = currentHoveredRef.current;
         if (targetHover) {
             const body = targetHover.userData.physicsBody as CANNON.Body;
             const type = (targetHover as any).propType || 'box';
             // Spawn duplicate slightly above the original
             spawnProp(type, { x: body.position.x, y: body.position.y + 2, z: body.position.z }, { mass: body.mass, materialName: body.material?.name });
             api.showMessage("Object Duplicated");
         }
      }
      if (e.code === 'KeyG') {
         isGridSnapping = !isGridSnapping;
         api.showMessage(isGridSnapping ? "Grid Snapping: ON" : "Grid Snapping: OFF");
      }
      if (e.code === 'F1') {
         e.preventDefault();
         setShowSpawnMenu(prev => {
             if (!prev) {
                 document.exitPointerLock();
             } else {
                 (window as any).lockControls?.();
             }
             return !prev;
         });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keys.hasOwnProperty(e.code)) (keys as any)[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Physics Gun logic
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(0, 0);
    let jointConstraint: CANNON.PointToPointConstraint | null = null;
    let grabbedBody: CANNON.Body | null = null;
    let grabDistance = 0;

    const jointBody = new CANNON.Body({ mass: 0 });
    jointBody.collisionFilterGroup = 0;
    jointBody.collisionFilterMask = 0;
    world.addBody(jointBody);

    const spawnProp = (type: string, pos?: { x: number, y: number, z: number }, options?: { mass?: number, materialName?: string }) => {
      let spawnPos = pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null;
      if (!spawnPos) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        spawnPos = camera.position.clone().add(dir.multiplyScalar(5));
        spawnPos.y += 2;
      }
      
      let mesh, shape;
      const mass = options?.mass !== undefined ? options.mass : 5;
      const material = materials[Math.floor(Math.random() * materials.length)];

      if (type === 'box') {
        const size = 1 + Math.random() * 1;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
        shape = new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2));
      } else if (type === 'sphere') {
        const radius = 0.5 + Math.random() * 0.8;
        mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), material);
        shape = new CANNON.Sphere(radius);
      } else {
        const radius = 0.5 + Math.random() * 0.5;
        const height = 1 + Math.random() * 1.5;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32), material);
        shape = new CANNON.Cylinder(radius, radius, height, 32);
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const bodyMat = options?.materialName && customMaterials[options.materialName] 
        ? customMaterials[options.materialName] : physicsMaterial;

      const body = new CANNON.Body({ mass, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), material: bodyMat });
      (mesh as any).propType = type;
      (mesh as any).health = options?.health !== undefined ? options.health : 100;
      
      if (type === 'cylinder') {
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(1,0,0), Math.PI/2);
        body.addShape(shape, new CANNON.Vec3(), q);
      } else {
        body.addShape(shape);
      }
      
      body.quaternion.setFromEuler(Math.random()*Math.PI, Math.random()*Math.PI, 0);
      world.addBody(body);

      mesh.userData.physicsBody = body;
      (body as any).originalMass = mass;
      (body as any).materialName = options?.materialName;

      objectsToUpdate.push({ mesh, body });
      interactableMeshes.push(mesh);
      
      setCurrency(c => c + 1); // Gain 1 currency per spawn
      emitEvent('object_spawned', { type, mass, position: spawnPos, health: (mesh as any).health });
    };

    const scaleObject = (mesh: THREE.Object3D, body: CANNON.Body, m: number) => {
        if (scaleAxisRef.current === 'All') {
            mesh.scale.multiplyScalar(m);
        } else if (scaleAxisRef.current === 'X') {
            mesh.scale.x *= m;
        } else if (scaleAxisRef.current === 'Y') {
            mesh.scale.y *= m;
        } else if (scaleAxisRef.current === 'Z') {
            mesh.scale.z *= m;
        }
        
        // Update CANNON shape if it's a box
        if (body.shapes && body.shapes[0] && body.shapes[0].type === CANNON.Shape.types.BOX) {
            const box = body.shapes[0] as CANNON.Box;
            if (scaleAxisRef.current === 'All') {
                box.halfExtents.set(box.halfExtents.x * m, box.halfExtents.y * m, box.halfExtents.z * m);
            } else if (scaleAxisRef.current === 'X') {
                box.halfExtents.x *= m;
            } else if (scaleAxisRef.current === 'Y') {
                box.halfExtents.y *= m;
            } else if (scaleAxisRef.current === 'Z') {
                box.halfExtents.z *= m;
            }
            box.updateConvexPolyhedronRepresentation();
            body.updateBoundingRadius();
        }
        
        api.showMessage(`Scaled Object (${scaleAxisRef.current} Axis)`);
    };

    const playGunEffect = (type: string, position: THREE.Vector3) => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            
            if (type === 'Repel') {
                osc.frequency.setValueAtTime(400, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
            } else if (type === 'Attract') {
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.2);
            } else if (type === 'Damage') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(150, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.1);
            } else if (type === 'Grab') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
            }
            
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.2);
        } catch(e) {}
        
        if (type === 'Grab') {
            // Draw a temporary beam
            const beamGeo = new THREE.BufferGeometry().setFromPoints([camera.position.clone().add(new THREE.Vector3(0,-0.5,0)), position]);
            const beamMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 });
            const beam = new THREE.Line(beamGeo, beamMat);
            scene.add(beam);
            setTimeout(() => { scene.remove(beam); beamGeo.dispose(); beamMat.dispose(); }, 150);
            return;
        }

        const particleGeo = new THREE.BufferGeometry();
        const particlesCount = type === 'Damage' ? 60 : 30;
        const posArray = new Float32Array(particlesCount * 3);
        const velArray = [];
        for(let i=0; i<particlesCount; i++) {
            posArray[i*3] = position.x;
            posArray[i*3+1] = position.y;
            posArray[i*3+2] = position.z;
            velArray.push((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15);
        }
        particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const color = type === 'Repel' ? 0xff0000 : type === 'Attract' ? 0x0000ff : 0xffa500;
        const particleMat = new THREE.PointsMaterial({ size: 0.15, color });
        const particleMesh = new THREE.Points(particleGeo, particleMat);
        scene.add(particleMesh);
        
        let start = performance.now();
        const animateParticles = () => {
             const now = performance.now();
             const delta = (now - start) / 1000;
             if (delta > 0.3) {
                 scene.remove(particleMesh);
                 particleGeo.dispose();
                 particleMat.dispose();
                 return;
             }
             const pos = particleMesh.geometry.attributes.position.array as Float32Array;
             for(let i=0; i<particlesCount; i++) {
                 pos[i*3] += velArray[i*3] * 0.016;
                 pos[i*3+1] += velArray[i*3+1] * 0.016;
                 pos[i*3+2] += velArray[i*3+2] * 0.016;
             }
             particleMesh.geometry.attributes.position.needsUpdate = true;
             requestAnimationFrame(animateParticles);
        };
        requestAnimationFrame(animateParticles);
    };

    const spawnRagdoll = (pos?: { x: number, y: number, z: number }) => {
        let spawnPos = pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null;
        if (!spawnPos) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          spawnPos = camera.position.clone().add(dir.multiplyScalar(5));
          spawnPos.y += 3;
        }

        const material = materials[Math.floor(Math.random() * materials.length)];
        
        // Torso
        const torsoSize = new CANNON.Vec3(0.5, 1, 0.25);
        const torsoBody = new CANNON.Body({ mass: 5, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), material: physicsMaterial });
        torsoBody.addShape(new CANNON.Box(torsoSize));
        const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), material);
        torsoMesh.castShadow = true; scene.add(torsoMesh); world.addBody(torsoBody);
        objectsToUpdate.push({ mesh: torsoMesh, body: torsoBody });
        interactableMeshes.push(torsoMesh);
        (torsoMesh as any).propType = 'ragdoll';
        torsoMesh.userData.physicsBody = torsoBody;

        // Head
        const headRadius = 0.4;
        const headBody = new CANNON.Body({ mass: 2, position: new CANNON.Vec3(spawnPos.x, spawnPos.y + 1.6, spawnPos.z), material: physicsMaterial });
        headBody.addShape(new CANNON.Sphere(headRadius));
        const headMesh = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 16), material);
        headMesh.castShadow = true; scene.add(headMesh); world.addBody(headBody);
        objectsToUpdate.push({ mesh: headMesh, body: headBody });
        interactableMeshes.push(headMesh);
        (headMesh as any).propType = 'ragdoll-head';
        headMesh.userData.physicsBody = headBody;

        // Neck Joint
        const neckConstraint = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(0, 1.2, 0), headBody, new CANNON.Vec3(0, -0.6, 0));
        world.addConstraint(neckConstraint);

        api.showMessage("Ragdoll Dummy Spawned");
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!controls.isLocked) return;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactableMeshes);
      
      if (intersects.length > 0) {
        const hit = intersects[0];
        const mesh = hit.object;
        const body = mesh.userData.physicsBody as CANNON.Body;

        if (e.button === 0) { // Left Click
          if (gunModeRef.current === 'Repel') {
             const dir = new THREE.Vector3();
             camera.getWorldDirection(dir);
             body.wakeUp();
             body.applyImpulse(new CANNON.Vec3(dir.x * 200 * gunPowerRef.current, dir.y * 200 * gunPowerRef.current, dir.z * 200 * gunPowerRef.current), body.position);
             playGunEffect('Repel', mesh.position);
             return;
          } else if (gunModeRef.current === 'Attract') {
             const dir = new THREE.Vector3();
             dir.subVectors(camera.position, mesh.position).normalize();
             body.wakeUp();
             body.applyImpulse(new CANNON.Vec3(dir.x * 200 * gunPowerRef.current, dir.y * 200 * gunPowerRef.current, dir.z * 200 * gunPowerRef.current), body.position);
             playGunEffect('Attract', mesh.position);
             return;
          } else if (gunModeRef.current === 'Damage') {
             if ((mesh as any).health !== undefined) {
                 (mesh as any).health -= 25 * gunPowerRef.current;
                 playGunEffect('Damage', mesh.position);
                 if ((mesh as any).health <= 0) {
                     // Destroy object
                     if (jointConstraint && grabbedBody === body) {
                       world.removeConstraint(jointConstraint);
                       jointConstraint = null;
                       grabbedBody = null;
                     }
                     world.removeBody(body);
                     scene.remove(mesh);
                     objectsToUpdate.splice(objectsToUpdate.findIndex(o => o.mesh === mesh), 1);
                     interactableMeshes.splice(interactableMeshes.indexOf(mesh as any), 1);
                     if (currentHoveredRef.current === mesh) currentHoveredRef.current = null;
                     api.showMessage("Object Destroyed!");
                 } else {
                     api.showMessage(`Damaged Object! Health: ${(mesh as any).health}`);
                 }
             }
             return;
          } else if (gunModeRef.current === 'Scale') {
             const m = 1.2;
             scaleObject(mesh, body, m);
             return;
          }

          if (body.mass === 0) {
            body.mass = (body as any).originalMass;
            body.type = CANNON.Body.DYNAMIC;
            body.updateMassProperties();
            (mesh as THREE.Mesh).material = materials[0]; // Reset highlight simply
          }

          grabbedBody = body;
          playGunEffect('Grab', mesh.position);
          grabDistance = hit.distance;

          const hitPoint = new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z);
          const localPivot = new CANNON.Vec3();
          body.pointToLocalFrame(hitPoint, localPivot);

          jointBody.position.copy(hitPoint);
          jointConstraint = new CANNON.PointToPointConstraint(jointBody, new CANNON.Vec3(0,0,0), body, localPivot);
          world.addConstraint(jointConstraint);
        } else if (e.button === 2) { // Right Click
           if (gunModeRef.current === 'Scale') {
               const m = 0.8;
               scaleObject(mesh, body, m);
               return;
           }
           if (body.mass > 0) {
             body.mass = 0;
             body.type = CANNON.Body.STATIC;
             body.velocity.set(0,0,0);
             body.angularVelocity.set(0,0,0);
             body.updateMassProperties();
           } else {
             body.mass = (body as any).originalMass;
             body.type = CANNON.Body.DYNAMIC;
             body.updateMassProperties();
             body.wakeUp();
           }
        }
      }
    };
    
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0 && jointConstraint) {
        world.removeConstraint(jointConstraint);
        jointConstraint = null;
        grabbedBody = null;
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    
    // API logic for mods
    const modEvents: Record<string, Function[]> = {
      'update': [],
      'start': [],
      'object_spawned': [],
      'player_damaged': [],
      'mod_loaded': []
    };

    const emitEvent = (event: string, data?: any) => {
      if (modEvents[event]) {
        modEvents[event].forEach(cb => {
          try { cb(data); } catch(e) {}
        });
      }
    };

    const api = {
      spawnProp,
      on: (event: string, callback: Function) => {
        if (!modEvents[event]) modEvents[event] = [];
        modEvents[event].push(callback);
      },
      emit: emitEvent,
      showMessage: (text: string) => {
        const msg = document.createElement('div');
        msg.innerText = text;
        msg.className = "absolute top-20 right-4 bg-blue-600 px-4 py-2 rounded shadow text-white font-mono z-50 pointer-events-none fade-out";
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 4000);
      },
      // Player API
      setPlayerSpeed: (speed: number) => { playerProps.speed = speed; },
      setPlayerJump: (vel: number) => { playerProps.jumpVelocity = vel; },
      damagePlayer: (amount: number) => { 
        playerProps.health -= amount; 
        emitEvent('player_damaged', { amount, health: playerProps.health }); 
      },
      getPlayerPos: () => ({ x: playerBody.position.x, y: playerBody.position.y, z: playerBody.position.z }),
      // Environment API
      registerPhysicsMaterial: (name: string, friction: number, restitution: number) => {
          const mat = new CANNON.Material(name);
          customMaterials[name] = mat;
          const contactMat = new CANNON.ContactMaterial(physicsMaterial, mat, { friction, restitution });
          world.addContactMaterial(contactMat);
          const selfContactMat = new CANNON.ContactMaterial(mat, mat, { friction, restitution });
          world.addContactMaterial(selfContactMat);
      },
      setSkyColor: (hex: number) => {
        scene.background = new THREE.Color(hex);
        if (scene.fog) scene.fog.color = new THREE.Color(hex);
      },
      setTimeOfDay: (time: number) => {
         // time 0-24
         const intensity = Math.max(0.1, Math.sin((time / 24) * Math.PI));
         dirLight.intensity = intensity * 0.8;
         ambientLight.intensity = intensity * 0.6;
         dirLight.position.x = Math.cos((time / 24) * Math.PI * 2) * 50;
         dirLight.position.y = Math.sin((time / 24) * Math.PI) * 100;
      },
      setFloorColor: (hex: number) => {
         floorMat.color.setHex(hex);
      },
      setWeather: (type: string) => {
         // Dummy for weather hook
         emitEvent('weather_changed', { type });
      },
      setGravity: (y: number) => { world.gravity.set(0, y, 0); },
      clearObjects: () => {
         objectsToUpdate.forEach(obj => {
           scene.remove(obj.mesh);
           world.removeBody(obj.body);
         });
         objectsToUpdate.length = 0;
         interactableMeshes.length = 0;
      },
      // UI API
      addUI: (id: string, html: string, style?: any) => setCustomUIs(prev => ({ ...prev, [id]: { html, style } })),
      removeUI: (id: string) => setCustomUIs(prev => { const n = {...prev}; delete n[id]; return n; }),
      // State
      addCurrency: (amount: number) => setCurrency(c => c + amount),
      scene,
      world,
      player: playerBody
    };

    (window as any).setSkyBoxColorUI = (color: string) => {
        scene.background = new THREE.Color(color);
        if (scene.fog) scene.fog.color = new THREE.Color(color);
        setSkyColorUI(color);
    };

    (window as any).setFloorColor = (color: number) => {
        floorMat.color.setHex(color);
    };

    (window as any).setGravityUI = (grav: number) => {
        world.gravity.set(0, grav, 0);
    };

    (window as any).saveSandboxUI = () => {
        const state = objectsToUpdate.map(obj => ({
            type: (obj.mesh as any).propType || 'box',
            position: obj.body.position,
            quaternion: obj.body.quaternion,
            scale: { x: obj.mesh.scale.x, y: obj.mesh.scale.y, z: obj.mesh.scale.z },
            mass: (obj.body as any).originalMass,
            invertedGravity: (obj.body as any).invertedGravity || false,
            health: (obj.mesh as any).health,
            materialName: (obj.body as any).materialName
        }));
        localStorage.setItem('sandbox_save', JSON.stringify(state));
        api.showMessage("Sandbox saved!");
    };

    (window as any).loadSandboxUI = () => {
        const saved = localStorage.getItem('sandbox_save');
        if (saved) {
            objectsToUpdate.forEach(obj => {
                scene.remove(obj.mesh);
                world.removeBody(obj.body);
            });
            objectsToUpdate.length = 0;
            interactableMeshes.length = 0;
            
            const state = JSON.parse(saved);
            state.forEach((s: any) => {
                spawnProp(s.type, s.position, { mass: s.mass, health: s.health, materialName: s.materialName });
                const lastObj = objectsToUpdate[objectsToUpdate.length - 1];
                lastObj.body.quaternion.set(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
                if (s.scale) {
                    lastObj.mesh.scale.set(s.scale.x, s.scale.y, s.scale.z);
                    // attempt to resize shape (if box)
                    if (lastObj.body.shapes && lastObj.body.shapes[0] && lastObj.body.shapes[0].type === CANNON.Shape.types.BOX) {
                        const box = lastObj.body.shapes[0] as CANNON.Box;
                        box.halfExtents.set(
                            s.scale.x / (lastObj.mesh.geometry as THREE.BoxGeometry).parameters.width,
                            s.scale.y / (lastObj.mesh.geometry as THREE.BoxGeometry).parameters.height,
                            s.scale.z / (lastObj.mesh.geometry as THREE.BoxGeometry).parameters.depth
                        );
                        box.updateConvexPolyhedronRepresentation();
                        lastObj.body.updateBoundingRadius();
                    }
                }
                (lastObj.body as any).invertedGravity = s.invertedGravity;
                lastObj.body.wakeUp();
            });
            api.showMessage("Sandbox loaded!");
        } else {
            api.showMessage("No saved sandbox found!");
        }
    };

    // Load active mods
    const loadMods = async () => {
      const activeModsStr = localStorage.getItem('activeMods') || '[]';
      const activeMods = JSON.parse(activeModsStr) as string[];
      
      for (const modId of activeMods) {
        try {
          const docSnap = await getDoc(doc(db, 'mods', modId));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const modFunction = new Function('api', 'THREE', 'CANNON', data.code);
            modFunction(api, THREE, CANNON);
            setActiveModNames(prev => [...prev, data.name]);
            api.showMessage(`Loaded mod: ${data.name}`);
            emitEvent('mod_loaded', { id: modId, name: data.name });

          }
        } catch(e: any) {
          console.error("Error loading mod", e);
          api.showMessage(`Failed to load mod. ${e.message}`);
        }
      }

      modEvents['start'].forEach(cb => cb());
    };
    loadMods();

    // Lock function exposed to UI hook
    (window as any).lockControls = () => {
      try {
        controls.lock();
      } catch (e: any) {
        console.error("PointerLock error:", e);
        api.showMessage("Pointer lock failed! Try again or open in a new window.");
      }
    };

    // Animation Loop
    let prevTime = performance.now();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const time = performance.now();
      const delta = (time - prevTime) / 1000;
      prevTime = time;

      if (controls.isLocked) {
        world.step(1/60, delta, 3);

        if (isNoclip) {
           const speed = playerProps.speed * 1.5;
           const dir = new THREE.Vector3();
           const camDir = new THREE.Vector3();
           camera.getWorldDirection(camDir);
           const right = new THREE.Vector3().crossVectors(camDir, camera.up).normalize();

           if (keys.KeyW) dir.add(camDir);
           if (keys.KeyS) dir.sub(camDir);
           if (keys.KeyA) dir.sub(right);
           if (keys.KeyD) dir.add(right);
           if (keys.Space) dir.add(camera.up);

           if (dir.lengthSq() > 0) {
               dir.normalize().multiplyScalar(speed * delta);
           }
           
           playerBody.position.x += dir.x;
           playerBody.position.y += dir.y;
           playerBody.position.z += dir.z;
           playerBody.velocity.set(0,0,0);
        } else {
           const front = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
           front.y = 0; front.normalize();
           
           const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
           right.y = 0; right.normalize();

           let tx = 0, tz = 0;
           if (keys.KeyW) { tx += front.x; tz += front.z; }
           if (keys.KeyS) { tx -= front.x; tz -= front.z; }
           if (keys.KeyA) { tx -= right.x; tz -= right.z; }
           if (keys.KeyD) { tx += right.x; tz += right.z; }

           if (tx !== 0 || tz !== 0) {
             const l = Math.sqrt(tx*tx + tz*tz);
             playerBody.velocity.x = (tx/l) * playerProps.speed;
             playerBody.velocity.z = (tz/l) * playerProps.speed;
           }

           if (keys.Space && canJump) {
             playerBody.velocity.y = playerProps.jumpVelocity;
             canJump = false;
           }
        }

        camera.position.copy(playerBody.position as any);
        camera.position.y += 1.5;
        
        // Hover tooltip update
        const toolTipEl = document.getElementById('hover-tooltip');
        const crosshairEl = document.getElementById('crosshair-container');
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(interactableMeshes);
        
        let newHovered = null;
        if (intersects.length > 0) {
            newHovered = intersects[0].object as THREE.Mesh;
        }

        if (newHovered !== currentHoveredRef.current) {
            if (currentHoveredRef.current && (currentHoveredRef.current.material as THREE.MeshStandardMaterial).emissive) {
                (currentHoveredRef.current.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
            }
            currentHoveredRef.current = newHovered;
            if (currentHoveredRef.current && (currentHoveredRef.current.material as THREE.MeshStandardMaterial).emissive) {
                (currentHoveredRef.current.material as THREE.MeshStandardMaterial).emissive.setHex(0x222222);
            }
            if (crosshairEl) {
                if (newHovered) {
                    crosshairEl.classList.add('scale-150', 'bg-cyan-300');
                } else {
                    crosshairEl.classList.remove('scale-150', 'bg-cyan-300');
                }
            }
        }
        
        if (newHovered) {
            const bodyInfo = newHovered.userData.physicsBody as CANNON.Body;
            if (toolTipEl) {
                const matName = bodyInfo.material?.name || 'standard';
                let bgColor = 'rgba(0,0,0,0.8)';
                if (matName === 'bouncy') bgColor = 'rgba(200, 100, 0, 0.8)';
                else if (matName === 'ice') bgColor = 'rgba(0, 150, 255, 0.8)';

                toolTipEl.style.display = 'block';
                toolTipEl.style.backgroundColor = bgColor;
                const massText = bodyInfo?.mass !== undefined ? bodyInfo.mass.toFixed(1) : '0.0';
                toolTipEl.innerHTML = `Type: ${(newHovered as any).propType || 'unknown'}<br/>Health: ${(newHovered as any).health || 100}<br/>Mass: ${massText}<br/>Material: ${matName}`;
            }
        } else {
            if (toolTipEl) toolTipEl.style.display = 'none';
        }

        // Gun bobbing animation
        if (gunGroup) {
            gunGroup.position.y = Math.sin(time / 200) * 0.02 * (isNoclip ? 0 : playerBody.velocity.length() / 10);
            gunGroup.position.x = Math.cos(time / 400) * 0.02 * (isNoclip ? 0 : playerBody.velocity.length() / 10);
        }

        if (jointConstraint && grabbedBody) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          const target = camera.position.clone().add(dir.multiplyScalar(Math.min(grabDistance, 50 * gunPowerRef.current))); // Modified max grab distance based on power
          
          if (isGridSnapping) {
              target.x = Math.round(target.x * 2) / 2;
              target.y = Math.round(target.y * 2) / 2;
              target.z = Math.round(target.z * 2) / 2;
          }
          
          grabbedBody.wakeUp();
          jointBody.position.set(target.x, target.y, target.z);
          // Apply extra damping/force based on power
          grabbedBody.velocity.scale(1 - (0.05 * gunPowerRef.current), grabbedBody.velocity);
          grabbedBody.angularVelocity.scale(1 - (0.05 * gunPowerRef.current), grabbedBody.angularVelocity);
          
          // Apply highlight if grabbed
          const grabbedMesh = objectsToUpdate.find(o => o.body === grabbedBody)?.mesh;
          if (grabbedMesh && (grabbedMesh.material as THREE.MeshStandardMaterial).emissive) {
              (grabbedMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x555555);
          }
        }

        objectsToUpdate.forEach(obj => {
          if ((obj as any).isNPC) {
              // Minimal NPC behavior: jump randomly
              if (Math.random() < 0.02 && Math.abs(obj.body.velocity.y) < 0.1) {
                  obj.body.velocity.y = 10;
                  obj.body.applyImpulse(new CANNON.Vec3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10), obj.body.position);
              }
          }
          if ((obj.body as any).invertedGravity) {
             // Fight gravity for inverted objects! (world.gravity is (-20 y), so we push up with 2 * 20 = 40)
             obj.body.applyForce(new CANNON.Vec3(0, Math.abs(world.gravity.y) * 2 * obj.body.mass, 0), obj.body.position);
          }
          obj.mesh.position.copy(obj.body.position as any);
          obj.mesh.quaternion.copy(obj.body.quaternion as any);
        });

        // Fire Mod updates
        emitEvent('update', delta);
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      document.removeEventListener('pointerlockerror', onError);
      controls.dispose();
      renderer.dispose();
      delete (window as any).lockControls;
      delete (window as any).saveSandboxUI;
      delete (window as any).loadSandboxUI;
      delete (window as any).setSkyBoxColorUI;
    }
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* UI Overlay */}
      {!controlsLocked && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 font-sans p-4">
          <div className="bg-neutral-900/90 backdrop-blur-md p-8 rounded-xl border border-neutral-700 shadow-2xl w-full max-w-2xl flex gap-8">
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Web-Mod Sandbox</h1>
              
              {!showShop ? (
                <>
                  <div className="space-y-3 text-left text-neutral-300 text-sm">
                    <p title="Use standard FPS controls"><strong>Movement:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">WASD</span> | <strong>Jump:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">Space</span></p>
                    <p title="Toggle to fly through the world"><strong>Noclip/Fly:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">V</span> (Space to rise)</p>
                    <p title="Cycle between Grab, Repel, and Attract"><strong>Gun Mode:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">Q</span> (Current: {gunMode})</p>
                    <p title="Aim at an object and interact"><strong>Gun Action:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">L-Click</span> Use | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">R-Click</span> Freeze</p>
                    <p title="Misc Gun mode"><strong>Misc Gun:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">E</span> Invert Grav | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">X</span>/<span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">Bksp</span> Delete | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">C</span> Copy/Dup | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">K</span> Scale Axis</p>
                    <p title="Toggle grid snapping for placement"><strong>Grid Snapping:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">G</span> Toggle</p>
                    <p title="Spawn primitives instantly"><strong>Spawn Props:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">1</span> Box | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">2</span> Sphere | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">3</span> Cylinder | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">4</span> Ragdoll | <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">N</span> NPC</p>
                    <p title="Open Spawn Menu"><strong>Spawn Menu:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">F1</span></p>
                    <p title="Toggle environment settings"><strong>Environment:</strong> <span className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">P</span> Day/Night</p>
                  </div>
                  
                  <div className="mt-4 flex items-center justify-between border-t border-neutral-700 pt-4">
                    <label className="text-white text-sm font-bold flex items-center gap-2" title="Change the background sky color">
                      Sky Color:
                      <input 
                        type="color" 
                        value={skyColorUI} 
                        onChange={e => (window as any).setSkyBoxColorUI?.(e.target.value)}
                        className="bg-neutral-800 rounded outline-none h-8 w-14 cursor-pointer"
                      />
                    </label>
                    <div className="flex gap-2">
                        <button onClick={() => (window as any).saveSandboxUI?.()} className="bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 rounded text-sm font-medium text-white transition-colors" title="Save objects and positions">Save State</button>
                        <button onClick={() => (window as any).loadSandboxUI?.()} className="bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 rounded text-sm font-medium text-white transition-colors" title="Load saved sandbox state">Load State</button>
                    </div>
                  </div>

                  <div className="mt-6 flex gap-4">
                    <button 
                      onClick={() => (window as any).lockControls?.()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold py-3 px-8 rounded-lg shadow-lg hover:shadow-blue-500/25 transition-all transform hover:scale-105"
                    >
                      Play
                    </button>
                    <button 
                      onClick={() => setShowShop(true)}
                      className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-lg font-bold py-3 px-8 rounded-lg shadow-lg hover:shadow-purple-500/25 transition-all transform hover:scale-105 inline-flex items-center justify-center gap-2"
                    >
                      Upgrades
                    </button>
                    <button 
                      onClick={() => setShowMaterialUI(true)}
                      className="flex-1 bg-amber-600 hover:bg-amber-500 text-white text-lg font-bold py-3 px-8 rounded-lg shadow-lg hover:shadow-amber-500/25 transition-all transform hover:scale-105 inline-flex items-center justify-center gap-2"
                    >
                      Materials
                    </button>
                  </div>
                </>
              ) : showShop ? (
                <div className="text-left">
                  <h2 className="text-2xl font-bold text-white mb-4">Physics Gun Upgrades</h2>
                  <div className="bg-neutral-800 p-4 rounded-lg mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-white font-semibold">Tractor Beam Power</span>
                      <span className="text-purple-400 font-mono text-sm border border-purple-500/30 px-2 py-1 rounded bg-purple-500/10">Level {gunPower}</span>
                    </div>
                    <p className="text-neutral-400 text-sm mb-4">Increases grabbing force, stability, and maximum distance.</p>
                    <button 
                      onClick={() => {
                        if (currency >= 50 * gunPower) {
                          setCurrency(c => c - 50 * gunPower);
                          setGunPower(p => p + 1);
                        }
                      }}
                      disabled={currency < 50 * gunPower}
                      className="w-full bg-emerald-600 disabled:bg-neutral-700 disabled:text-neutral-500 hover:bg-emerald-500 text-white font-bold py-2 rounded-md transition-colors"
                    >
                      Upgrade Component (Cost: {50 * gunPower} 🪙)
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowShop(false)}
                    className="w-full bg-neutral-700 hover:bg-neutral-600 border border-neutral-600 text-white font-bold py-2 px-8 rounded-lg transition-colors"
                  >
                    Back to Menu
                  </button>
                </div>
              ) : (
                <div className="text-left">
                  <h2 className="text-2xl font-bold text-white mb-4">Custom Physics Materials</h2>
                  <div className="bg-neutral-800 p-4 rounded-lg mb-4">
                    <p className="text-neutral-400 text-sm mb-4">Select an object with the physics gun, then apply a new material to it!</p>
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        const name = data.get('name') as string;
                        const fric = parseFloat(data.get('friction') as string);
                        const rest = parseFloat(data.get('restitution') as string);
                        
                        if (name) {
                            (window as any).registerPhysicsMaterial?.(name, fric, rest);
                        }
                    }} className="flex flex-col gap-3">
                        <input name="name" placeholder="Material Name (e.g. rubber)" required className="bg-neutral-700 text-white px-3 py-2 rounded border border-neutral-600" />
                        <div className="flex gap-4">
                            <label className="flex-1 text-sm text-neutral-300">Friction
                                <input name="friction" type="number" step="0.1" defaultValue="0.3" required className="w-full bg-neutral-700 text-white px-3 py-1 mt-1 rounded border border-neutral-600" />
                            </label>
                            <label className="flex-1 text-sm text-neutral-300">Restitution (Bounciness)
                                <input name="restitution" type="number" step="0.1" defaultValue="0.2" required className="w-full bg-neutral-700 text-white px-3 py-1 mt-1 rounded border border-neutral-600" />
                            </label>
                        </div>
                        <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 mt-2 rounded transition-colors">Create Material</button>
                    </form>
                  </div>
                  <button 
                    onClick={() => setShowMaterialUI(false)}
                    className="w-full bg-neutral-700 hover:bg-neutral-600 border border-neutral-600 text-white font-bold py-2 px-8 rounded-lg transition-colors"
                  >
                    Back to Menu
                  </button>
                </div>
              )}
            </div>

            {/* Active Mods Sidebar */}
            <div className="w-64 bg-neutral-800/50 p-4 rounded-lg border border-neutral-700 backdrop-blur shrink-0 flex flex-col">
              <h3 className="text-white font-bold mb-3 border-b border-neutral-700 pb-2">Active Mods ({activeModNames.length})</h3>
              <div className="flex-1 overflow-y-auto space-y-2">
                {activeModNames.length === 0 ? (
                  <p className="text-neutral-500 text-sm text-center py-4">No mods loaded</p>
                ) : (
                  activeModNames.map((name, i) => (
                    <div key={i} className="text-sm bg-neutral-900 border border-neutral-700 px-3 py-2 rounded text-neutral-300 flex items-center justify-between">
                      <span className="truncate">{name}</span>
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crosshair */}
      {controlsLocked && (
        <>
          {Object.entries(customUIs).map(([id, ui]) => (
            <div 
              key={id} 
              id={id} 
              className="absolute pointer-events-none z-20"
              style={(ui as any).style}
              dangerouslySetInnerHTML={{ __html: (ui as any).html }}
            />
          ))}

          <div id="crosshair-container" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none z-10 flex items-center justify-center transition-transform duration-200 ease-out">
            <div className={`w-[2px] h-full shadow-sm absolute transition-colors ${gunMode === 'Grab' ? 'bg-cyan-400' : gunMode === 'Repel' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
            <div className={`h-[2px] w-full shadow-sm absolute transition-colors ${gunMode === 'Grab' ? 'bg-cyan-400' : gunMode === 'Repel' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
          </div>
          
          <div id="hover-tooltip" className="absolute top-1/2 left-1/2 ml-4 mt-4 bg-black/80 text-white text-xs font-mono p-2 rounded pointer-events-none z-10 border border-neutral-700/50 transition-colors duration-300" style={{display: 'none'}}></div>

          {/* Spawn Menu (Mod Inventory) */}
          {showSpawnMenu && (
             <div className="absolute inset-20 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 p-6 rounded-xl flex flex-col z-30 shadow-2xl">
                 <div className="flex justify-between items-center mb-6">
                     <h2 className="text-2xl font-bold text-white">Spawn Menu & Mods</h2>
                     <button onClick={() => setShowSpawnMenu(false)} className="text-neutral-400 hover:text-white px-3 py-1 bg-neutral-800 rounded">Close (Esc)</button>
                 </div>
                 <div className="flex flex-1 gap-6 overflow-hidden">
                     {/* Left Sidebar: Categories */}
                     <div className="w-48 flex flex-col gap-2 border-r border-neutral-700 pr-4">
                         <div className="bg-blue-600/20 text-blue-400 font-bold px-3 py-2 rounded cursor-pointer ring-1 ring-blue-500">Props</div>
                         
                         <div className="mt-4 border-t border-neutral-700 pt-4 text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Maps</div>
                         {['Grassland', 'Moon', 'Mars', 'Void'].map(mapName => (
                             <div key={mapName} className="text-amber-400 text-sm px-3 py-1 truncate cursor-pointer hover:bg-neutral-800 rounded" onClick={() => {
                                 let bg = 0x87CEEB; let floor = 0x7cfc00; let grav = -20;
                                 if (mapName === 'Moon') { bg = 0x000000; floor = 0x999999; grav = -3; }
                                 if (mapName === 'Mars') { bg = 0x8b4513; floor = 0xd35400; grav = -7; }
                                 if (mapName === 'Void') { bg = 0x050510; floor = 0x111111; grav = -15; }
                                 (window as any).setSkyBoxColorUI?.('#'+bg.toString(16).padStart(6,'0'));
                                 (window as any).setFloorColor?.(floor);
                                 (window as any).setGravityUI?.(grav);
                                 api.showMessage(`Map changed to ${mapName}`);
                             }}>• {mapName}</div>
                         ))}

                         <div className="mt-4 border-t border-neutral-700 pt-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">Active Mods</div>
                         {activeModNames.map((name, i) => (
                             <div key={i} className="text-emerald-400 text-sm px-3 py-1 truncate cursor-pointer hover:bg-neutral-800 rounded" title={name + " (Click to move to top of load order)"} onClick={() => {
                                 const activeModsStr = localStorage.getItem('activeMods') || '[]';
                                 let mods = JSON.parse(activeModsStr) as string[];
                                 if (i > 0) {
                                     const tmp = mods[i]; mods.splice(i, 1); mods.unshift(tmp);
                                     localStorage.setItem('activeMods', JSON.stringify(mods));
                                     window.location.reload();
                                 }
                             }}>• {name}</div>
                         ))}
                         {activeModNames.length === 0 && <div className="text-neutral-500 text-sm italic px-3">No mods active</div>}
                     </div>
                     {/* Right Content: Grid */}
                     <div className="flex-1 overflow-y-auto grid grid-cols-4 lg:grid-cols-6 gap-4 content-start relative">
                         {['Box', 'Sphere', 'Cylinder'].map((item) => (
                             <div 
                                key={item} 
                                onClick={() => { 
                                    (window as any).lockControls?.();
                                    setShowSpawnMenu(false);
                                    window.dispatchEvent(new KeyboardEvent('keydown', { code: item === 'Box' ? 'Digit1' : item === 'Sphere' ? 'Digit2' : 'Digit3' }));
                                }}
                                className="bg-neutral-800 hover:bg-neutral-700 hover:ring-2 ring-cyan-500 aspect-square rounded flex flex-col items-center justify-center cursor-pointer transition-all shadow-md group"
                             >
                                 <div className="text-4xl mb-2 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-transform">
                                    {item === 'Box' ? '📦' : item === 'Sphere' ? '🏀' : '🛢️'}
                                 </div>
                                 <div className="text-sm font-medium text-neutral-300">{item}</div>
                             </div>
                         ))}
                         <div 
                             onClick={() => { 
                                 (window as any).lockControls?.();
                                 setShowSpawnMenu(false);
                                 window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4' }));
                             }}
                             className="bg-neutral-800 hover:bg-neutral-700 hover:ring-2 ring-red-500 aspect-square rounded flex flex-col items-center justify-center cursor-pointer transition-all shadow-md group"
                          >
                              <div className="text-4xl mb-2 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-transform">🤖</div>
                              <div className="text-sm font-medium text-neutral-300">Ragdoll Dummy</div>
                          </div>
                     </div>
                 </div>
             </div>
          )}

          {/* HUD left */}
          <div className="absolute bottom-6 left-6 text-white font-mono text-xl drop-shadow-md z-10 pointer-events-none flex flex-col gap-2">
            <div>🔧 Tool: {currentTool} (Pwr Lv.{gunPower})</div>
            {activeModNames.length > 0 && (
              <div className="text-sm text-emerald-400 mt-2">Active Mods: {activeModNames.length}</div>
            )}
          </div>

          {/* HUD right */}
          <div className="absolute top-20 right-6 text-white font-mono text-xl drop-shadow-md z-10 pointer-events-none flex items-center gap-2 bg-neutral-900/80 px-4 py-2 rounded-lg border border-yellow-500/30">
            <span className="text-yellow-400">🪙 {currency}</span>
          </div>
        </>
      )}
    </div>
  );
}
