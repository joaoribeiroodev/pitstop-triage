import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ZonaId, zonasCatalogo } from '@core/data/sintomas.catalog';

interface ZonaHotspot {
  id: ZonaId;
  label: string;
  icone: string;
  mesh: THREE.Mesh;
  labelEl?: HTMLElement;
  // anchor relativo ao centro do carro (para o label seguir)
  anchor: THREE.Vector3;
  // camera preset
  cameraTarget: THREE.Vector3;
  cameraPosition: THREE.Vector3;
}

// Paleta racing
const COLOR_BODY = 0x111b30;
const COLOR_BODY_TRIM = 0x1f2a44;
const COLOR_GLASS = 0x0d1424;
const COLOR_WHEEL = 0x070b14;
const COLOR_TIRE = 0x0a0f1c;
const COLOR_RIM = 0x94a3b8;
const COLOR_HEADLIGHT = 0xfdba74;
const COLOR_ACCENT = 0xfb923c;

const COLOR_ZONE_IDLE = 0xfb923c;

interface HotspotTemplate {
  id: ZonaId;
  label: string;
  icone: string;
  transform: string;
  opacity: number;
}

@Component({
  selector: 'app-car-3d',
  standalone: false,
  templateUrl: './car-3d.component.html',
  styleUrls: ['./car-3d.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Car3dComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() set selectedZone(z: string | null | undefined) {
    this.selected = (z || null) as ZonaId | null;
    if (this.ready) this.applySelection(true);
  }
  @Output() readonly zoneSelected = new EventEmitter<ZonaId>();

  selected: ZonaId | null = null;
  hovered: ZonaId | null = null;

  // Labels render via templated array (atualizado a cada frame)
  hotspotsForTemplate: HotspotTemplate[] = Object.values(zonasCatalogo).map((z) => ({
    id: z.id,
    label: z.label,
    icone: z.icone,
    transform: 'translate(-9999px, -9999px)',
    opacity: 0
  }));

  private THREE!: typeof THREE;
  private OrbitControlsCtor!: typeof OrbitControls;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private raycaster!: THREE.Raycaster;
  private pointer!: THREE.Vector2;
  private hotspots: ZonaHotspot[] = [];
  private rafId = 0;
  private resizeObs?: ResizeObserver;
  private cameraTargetPos!: THREE.Vector3;
  private cameraTargetLookAt!: THREE.Vector3;
  private cameraLerpAlpha = 1;
  private initialCamPos!: THREE.Vector3;
  private initialLookAt!: THREE.Vector3;
  private ready = false;
  private lastLabelCd = 0;

  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  async ngAfterViewInit(): Promise<void> {
    const [three, controlsMod] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js')
    ]);
    this.THREE = three;
    this.OrbitControlsCtor = controlsMod.OrbitControls;

    this.zone.runOutsideAngular(() => this.setupScene());
    this.ready = true;
    this.applySelection(false);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObs?.disconnect();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.scene) {
      this.scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    }
  }

  selectFromLabel(id: ZonaId): void {
    this.zone.run(() => {
      this.selected = id;
      this.applySelection(true);
      this.zoneSelected.emit(id);
    });
  }

  hoverFromLabel(id: ZonaId | null): void {
    this.hovered = id;
  }

  resetView(): void {
    if (!this.ready) return;
    this.cameraTargetPos = this.initialCamPos.clone();
    this.cameraTargetLookAt = this.initialLookAt.clone();
    this.cameraLerpAlpha = 0;
  }

  zoomBy(factor: number): void {
    if (!this.controls) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.multiplyScalar(factor);
    this.cameraTargetPos = this.controls.target.clone().add(dir);
    this.cameraTargetLookAt = this.controls.target.clone();
    this.cameraLerpAlpha = 0;
  }

  // ───────────── SCENE SETUP ─────────────
  private setupScene(): void {
    const T = this.THREE;
    const canvas = this.canvasRef.nativeElement;
    const host = this.hostRef.nativeElement;

    this.scene = new T.Scene();
    this.scene.fog = new T.Fog(0x050810, 14, 30);

    const { clientWidth: w, clientHeight: h } = host;
    this.camera = new T.PerspectiveCamera(38, Math.max(w / Math.max(h, 1), 0.01), 0.1, 100);
    this.initialCamPos = new T.Vector3(5.2, 3.4, 6.4);
    this.initialLookAt = new T.Vector3(0, 0.6, 0);
    this.camera.position.copy(this.initialCamPos);
    this.camera.lookAt(this.initialLookAt);
    this.cameraTargetPos = this.initialCamPos.clone();
    this.cameraTargetLookAt = this.initialLookAt.clone();

    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.setupLights();
    this.buildGround();
    this.buildCar();
    this.buildHotspots();

    this.controls = new this.OrbitControlsCtor(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 12;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.target.copy(this.initialLookAt);
    this.controls.enablePan = false;
    this.controls.update();

    this.raycaster = new T.Raycaster();
    this.pointer = new T.Vector2(-2, -2);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(host);

    this.animate();
  }

  private setupLights(): void {
    const T = this.THREE;
    const ambient = new T.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const key = new T.DirectionalLight(0xffffff, 1.2);
    key.position.set(6, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    this.scene.add(key);

    const rim = new T.DirectionalLight(0xfb923c, 0.6);
    rim.position.set(-6, 4, -5);
    this.scene.add(rim);

    const fill = new T.DirectionalLight(0x22d3ee, 0.3);
    fill.position.set(0, 3, -8);
    this.scene.add(fill);
  }

  private buildGround(): void {
    const T = this.THREE;
    const geo = new T.CircleGeometry(8, 64);
    const mat = new T.MeshStandardMaterial({
      color: 0x0a0f1c,
      metalness: 0.5,
      roughness: 0.55
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // grid sutil
    const grid = new T.GridHelper(16, 32, 0x1f2a44, 0x111b30);
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.001;
    this.scene.add(grid);
  }

  private buildCar(): void {
    const T = this.THREE;
    const car = new T.Group();
    car.name = 'car';

    const matBody = new T.MeshStandardMaterial({ color: COLOR_BODY, metalness: 0.55, roughness: 0.45 });
    const matTrim = new T.MeshStandardMaterial({ color: COLOR_BODY_TRIM, metalness: 0.7, roughness: 0.4 });
    const matGlass = new T.MeshStandardMaterial({
      color: COLOR_GLASS,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.85
    });
    const matWheel = new T.MeshStandardMaterial({ color: COLOR_WHEEL, metalness: 0.2, roughness: 0.8 });
    const matTire = new T.MeshStandardMaterial({ color: COLOR_TIRE, metalness: 0.05, roughness: 0.95 });
    const matRim = new T.MeshStandardMaterial({ color: COLOR_RIM, metalness: 0.9, roughness: 0.25 });
    const matHead = new T.MeshStandardMaterial({
      color: COLOR_HEADLIGHT,
      emissive: COLOR_HEADLIGHT,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.2
    });
    const matAccent = new T.MeshStandardMaterial({
      color: COLOR_ACCENT,
      emissive: COLOR_ACCENT,
      emissiveIntensity: 0.35,
      metalness: 0.3,
      roughness: 0.4
    });

    const mkBox = (w: number, h: number, d: number, mat: THREE.Material) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    // Chassi inferior
    const chassis = mkBox(4.4, 0.5, 1.9, matTrim);
    chassis.position.set(0, 0.45, 0);
    car.add(chassis);

    // Corpo principal
    const body = mkBox(4.2, 0.55, 1.85, matBody);
    body.position.set(0, 0.88, 0);
    car.add(body);

    // Capô (frente)
    const hood = mkBox(1.3, 0.42, 1.7, matBody);
    hood.position.set(-1.45, 1.15, 0);
    car.add(hood);

    // Porta-malas (traseira)
    const trunk = mkBox(1.0, 0.45, 1.7, matBody);
    trunk.position.set(1.6, 1.12, 0);
    car.add(trunk);

    // Cabine
    const cabin = mkBox(2.0, 0.85, 1.6, matBody);
    cabin.position.set(0.05, 1.65, 0);
    car.add(cabin);

    // Vidros (para-brisa e traseiro como planos)
    const winF = mkBox(0.7, 0.7, 1.55, matGlass);
    winF.position.set(-0.95, 1.5, 0);
    winF.rotation.z = Math.PI / 12;
    car.add(winF);
    const winR = mkBox(0.6, 0.7, 1.55, matGlass);
    winR.position.set(1.05, 1.5, 0);
    winR.rotation.z = -Math.PI / 12;
    car.add(winR);
    // Vidros laterais
    const winS1 = mkBox(1.9, 0.7, 0.02, matGlass);
    winS1.position.set(0.05, 1.65, 0.81);
    car.add(winS1);
    const winS2 = winS1.clone();
    winS2.position.z = -0.81;
    car.add(winS2);

    // Faróis (2)
    const head1 = mkBox(0.1, 0.18, 0.45, matHead);
    head1.position.set(-2.2, 0.95, 0.55);
    car.add(head1);
    const head2 = head1.clone();
    head2.position.z = -0.55;
    car.add(head2);

    // Lanternas traseiras (faixa accent)
    const tail = mkBox(0.08, 0.2, 1.4, matAccent);
    tail.position.set(2.15, 1.0, 0);
    car.add(tail);

    // Faixa lateral accent
    const stripe1 = mkBox(4.0, 0.06, 0.02, matAccent);
    stripe1.position.set(0, 0.78, 0.94);
    car.add(stripe1);
    const stripe2 = stripe1.clone();
    stripe2.position.z = -0.94;
    car.add(stripe2);

    // Rodas + pneus
    const wheelGeo = new T.CylinderGeometry(0.42, 0.42, 0.32, 24);
    const tireRing = (x: number, z: number) => {
      const tire = new T.Mesh(wheelGeo, matTire);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, 0.42, z);
      tire.castShadow = true;
      car.add(tire);
      const rim = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.34, 8), matRim);
      rim.rotation.x = Math.PI / 2;
      rim.position.copy(tire.position);
      car.add(rim);
      // disco de freio (visivel — usado tambem como hint para zona freios)
      const disc = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.04, 24), matWheel);
      disc.rotation.x = Math.PI / 2;
      disc.position.copy(tire.position);
      car.add(disc);
    };
    tireRing(-1.5, 0.78);
    tireRing(1.5, 0.78);
    tireRing(-1.5, -0.78);
    tireRing(1.5, -0.78);

    this.scene.add(car);
  }

  // ───────────── HOTSPOTS ─────────────
  private buildHotspots(): void {
    const T = this.THREE;
    // Cada zona: caixa transparente que cobre a regiao + label HTML
    interface ZoneDef {
      id: ZonaId;
      center: [number, number, number];
      size: [number, number, number];
      anchor: [number, number, number];
      camPos: [number, number, number];
      camTarget: [number, number, number];
    }

    const defs: ZoneDef[] = [
      {
        id: 'motor',
        center: [-1.55, 1.15, 0],
        size: [1.5, 0.65, 2.0],
        anchor: [-1.55, 1.45, 0],
        camPos: [-5.5, 2.8, 4.5],
        camTarget: [-1.5, 1.1, 0]
      },
      {
        id: 'arrefecimento',
        center: [-2.15, 0.95, 0],
        size: [0.3, 0.6, 1.4],
        anchor: [-2.35, 1.2, 0],
        camPos: [-6.5, 2.0, 0.5],
        camTarget: [-2.0, 1.0, 0]
      },
      {
        id: 'eletrica',
        center: [-0.6, 1.6, 0],
        size: [0.7, 0.6, 1.6],
        anchor: [-0.55, 2.05, 0],
        camPos: [-3.5, 4.8, 4.2],
        camTarget: [-0.4, 1.5, 0]
      },
      {
        id: 'transmissao',
        center: [0.4, 0.55, 0],
        size: [2.2, 0.3, 0.9],
        anchor: [0.4, 0.4, 0.95],
        camPos: [0.5, 1.2, 7.0],
        camTarget: [0.4, 0.6, 0]
      },
      {
        id: 'freios',
        center: [-1.5, 0.42, 0.78],
        size: [0.9, 0.9, 0.55],
        anchor: [-1.5, 0.65, 1.4],
        camPos: [-3.5, 1.6, 5.2],
        camTarget: [-1.5, 0.5, 0.78]
      },
      {
        id: 'suspensao',
        center: [1.5, 0.6, -0.78],
        size: [1.0, 0.55, 0.55],
        anchor: [1.5, 0.85, -1.45],
        camPos: [4.5, 2.0, -5.5],
        camTarget: [1.5, 0.7, -0.78]
      }
    ];

    for (const d of defs) {
      const meta = zonasCatalogo[d.id];
      const geo = new T.BoxGeometry(d.size[0], d.size[1], d.size[2]);
      const mat = new T.MeshStandardMaterial({
        color: COLOR_ZONE_IDLE,
        emissive: COLOR_ZONE_IDLE,
        emissiveIntensity: 0,
        metalness: 0.0,
        roughness: 0.4,
        transparent: true,
        opacity: 0
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(d.center[0], d.center[1], d.center[2]);
      mesh.userData['zonaId'] = d.id;
      this.scene.add(mesh);

      this.hotspots.push({
        id: d.id,
        label: meta.label,
        icone: meta.icone,
        mesh,
        anchor: new T.Vector3(d.anchor[0], d.anchor[1], d.anchor[2]),
        cameraPosition: new T.Vector3(d.camPos[0], d.camPos[1], d.camPos[2]),
        cameraTarget: new T.Vector3(d.camTarget[0], d.camTarget[1], d.camTarget[2])
      });
    }
  }

  private onPointerMove = (ev: PointerEvent): void => {
    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    const hit = this.pickHotspot();
    const newHover = hit ? (hit.userData['zonaId'] as ZonaId) : null;
    if (newHover !== this.hovered) {
      this.zone.run(() => (this.hovered = newHover));
      this.canvasRef.nativeElement.style.cursor = newHover ? 'pointer' : 'grab';
    }
  };

  private onPointerLeave = (): void => {
    if (this.hovered !== null) this.zone.run(() => (this.hovered = null));
    this.canvasRef.nativeElement.style.cursor = '';
  };

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.pickHotspot();
    if (hit) {
      const id = hit.userData['zonaId'] as ZonaId;
      this.zone.run(() => {
        this.selected = id;
        this.applySelection(true);
        this.zoneSelected.emit(id);
      });
    }
  };

  private pickHotspot(): THREE.Object3D | null {
    if (!this.raycaster) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objs = this.hotspots.map((h) => h.mesh);
    const hits = this.raycaster.intersectObjects(objs, false);
    return hits.length ? hits[0].object : null;
  }

  private applySelection(animateCamera: boolean): void {
    for (const h of this.hotspots) {
      const mat = h.mesh.material as THREE.MeshStandardMaterial;
      const isSel = this.selected === h.id;
      mat.opacity = isSel ? 0.32 : 0;
      mat.emissiveIntensity = isSel ? 0.85 : 0;
      mat.needsUpdate = true;
    }
    if (animateCamera && this.selected) {
      const h = this.hotspots.find((x) => x.id === this.selected);
      if (h) {
        this.cameraTargetPos = h.cameraPosition.clone();
        this.cameraTargetLookAt = h.cameraTarget.clone();
        this.cameraLerpAlpha = 0;
      }
    }
  }

  private handleResize(): void {
    if (!this.renderer || !this.camera) return;
    const host = this.hostRef.nativeElement;
    const w = host.clientWidth;
    const h = host.clientHeight;
    this.camera.aspect = Math.max(w / Math.max(h, 1), 0.01);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);

    // Lerp camera quando ha alvo
    if (this.cameraLerpAlpha < 1) {
      this.cameraLerpAlpha = Math.min(1, this.cameraLerpAlpha + 0.045);
      const t = this.easeInOutCubic(this.cameraLerpAlpha);
      this.camera.position.lerp(this.cameraTargetPos, t * 0.18 + 0.02);
      this.controls.target.lerp(this.cameraTargetLookAt, t * 0.18 + 0.02);
    }

    // Pulso suave do hotspot selecionado
    if (this.selected) {
      const h = this.hotspots.find((x) => x.id === this.selected);
      if (h) {
        const mat = h.mesh.material as THREE.MeshStandardMaterial;
        const t = performance.now() / 600;
        mat.emissiveIntensity = 0.55 + Math.sin(t) * 0.3;
      }
    }

    // Hover destaque
    for (const h of this.hotspots) {
      if (h.id === this.selected) continue;
      const mat = h.mesh.material as THREE.MeshStandardMaterial;
      const target = this.hovered === h.id ? 0.18 : 0;
      mat.opacity += (target - mat.opacity) * 0.15;
      mat.emissiveIntensity = this.hovered === h.id ? 0.35 : 0;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  };

  private easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  private updateLabels(): void {
    const host = this.hostRef.nativeElement;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const proj = new this.THREE.Vector3();
    const camPos = this.camera.position;

    let changed = false;
    for (const hs of this.hotspots) {
      proj.copy(hs.anchor);
      proj.project(this.camera);
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      const facing = proj.z < 1;
      // Fade por dist e profundidade
      const dist = camPos.distanceTo(hs.anchor);
      const distOpacity = this.THREE.MathUtils.clamp((12 - dist) / 6, 0.15, 1);
      const opacity = facing ? distOpacity : 0;

      const tpl = this.hotspotsForTemplate.find((t) => t.id === hs.id);
      if (!tpl) continue;
      const newTransform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
      if (tpl.transform !== newTransform || tpl.opacity !== opacity) {
        tpl.transform = newTransform;
        tpl.opacity = opacity;
        changed = true;
      }
    }
    if (changed) {
      const now = performance.now();
      if (now - this.lastLabelCd < 32) return;
      this.lastLabelCd = now;
      this.zone.run(() => this.cdr.markForCheck());
    }
  }
}
