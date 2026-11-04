import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const SCREEN_FRAME = '/new_design/PHOTOBOOTH-FRAME-NEW-OLD.png'; // 1080x1920 for kiosk screen
const PRINT_FRAME = '/new_design/energya_4x6_1200x1800.png';    // 1200x1800 for 4x6 print paper & QR
const SCREENSAVER_BG = '/new_design/screensaver_bg.jpg';         // Exhibition kiosk background
const LOGO = '/new_design/logo.svg';
const STAGE = { width: 1080, height: 1920 };

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      resolve(img);
      return;
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
  });
  imageCache.set(src, p);
  return p;
}

type Screen = 'screensaver' | 'idle' | 'countdown' | 'flash' | 'review' | 'printing' | 'qr' | 'error';
type StorageMode = 'local' | 'r2' | 'both';

type Config = {
  countdownSeconds: number;
  idleTimeoutSeconds: number;
  printEnabled: boolean;
  soundEnabled: boolean;
  storageMode: StorageMode;
  mirrorPhoto: boolean;
  baseUrl: string;
  camera?: { deviceId?: string; width?: number; height?: number };
  r2?: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
    publicUrl?: string;
  };
  local?: {
    host: string;
    port: number;
  };
  detectedIp?: string;
  activeLocalIp?: string;
  savedPhotosCount?: number;
};

type PhotoSaveResult = {
  id: string;
  storageMode: StorageMode;
  localUrl: string;
  r2Url: string | null;
  activeUrl: string;
  isCloud: boolean;
  r2Error?: string | null;
};

const defaultConfig: Config = {
  countdownSeconds: 3,
  idleTimeoutSeconds: 45,
  printEnabled: true,
  soundEnabled: true,
  storageMode: 'both',
  mirrorPhoto: false,
  baseUrl: '',
  camera: { width: 1080, height: 1920 },
  r2: {
    accountId: '6689d1626b5ab6e9f9e69e886af37e97',
    bucket: 'energya',
    accessKeyId: 'f70845223a670a720b673a7c2d7f9ed6',
    secretAccessKey: '4502e1038bcccc4f1dd7788ca88acc4d9d9625fcdc6ca7c3fca3ec4f0d04d3a5',
    endpoint: 'https://6689d1626b5ab6e9f9e69e886af37e97.r2.cloudflarestorage.com',
    publicUrl: '',
  },
  local: {
    host: '',
    port: 3000,
  },
};

function cropCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mirror: boolean = false
) {
  const sourceRatio = sw / sh;
  const targetRatio = dw / dh;
  let cropW = sw;
  let cropH = sh;
  let cropX = 0;
  let cropY = 0;
  if (sourceRatio > targetRatio) {
    cropW = sh * targetRatio;
    cropX = (sw - cropW) / 2;
  } else {
    cropH = sw / targetRatio;
    cropY = (sh - cropH) / 2;
  }

  if (mirror) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(source, cropX, cropY, cropW, cropH, dx, dy, dw, dh);
  }
}

async function waitForVideoFrame(video: HTMLVideoElement) {
  await Promise.race([
    video.requestVideoFrameCallback
      ? new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()))
      : new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())),
    new Promise<void>(resolve => window.setTimeout(resolve, 250)),
  ]);
}

async function snapshotCamera(video: HTMLVideoElement, stream: MediaStream | null) {
  const snapshot = document.createElement('canvas');
  const track = stream?.getVideoTracks()[0];
  const ImageCaptureCtor = (
    window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }
  ).ImageCapture;

  if (track && ImageCaptureCtor) {
    try {
      const bitmap = await new ImageCaptureCtor(track).grabFrame();
      snapshot.width = bitmap.width;
      snapshot.height = bitmap.height;
      snapshot.getContext('2d')?.drawImage(bitmap, 0, 0, snapshot.width, snapshot.height);
      bitmap.close();
      return snapshot;
    } catch {
      // Fallback
    }
  }

  snapshot.width = video.videoWidth || STAGE.width;
  snapshot.height = video.videoHeight || STAGE.height;
  const context = snapshot.getContext('2d');
  if (!context) throw new Error('snapshot');
  context.drawImage(video, 0, 0, snapshot.width, snapshot.height);
  return snapshot;
}

function Stage({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const handleResize = () => {
      const s = Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);
      setScale(s);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      className="stage"
      style={{
        width: `${STAGE.width}px`,
        height: `${STAGE.height}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </div>
  );
}

function CameraIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PrinterIcon({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function QrIcon({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
      <rect x="18" y="14" width="3" height="1" />
      <rect x="14" y="18" width="1" height="3" />
      <rect x="6" y="6" width="1" height="1" />
      <rect x="17" y="6" width="1" height="1" />
      <rect x="6" y="17" width="1" height="1" />
    </svg>
  );
}

function RetakeIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function Button({
  children,
  onClick,
  secondary = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`booth-button ${secondary ? 'secondary' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function App() {
  const initialScreen = (new URLSearchParams(window.location.search).get('screen') as Screen) || 'screensaver';
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [countdown, setCountdown] = useState<number | null>(initialScreen === 'countdown' ? 3 : null);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
  const [screenPhoto, setScreenPhoto] = useState<string | null>(
    initialScreen === 'review' ? SCREEN_FRAME : null
  );
  const [printPhotoData, setPrintPhotoData] = useState<string | null>(
    initialScreen === 'review' ? PRINT_FRAME : null
  );
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoSaveResult | null>(null);
  const [qrSeconds, setQrSeconds] = useState(30);
  const [adminOpen, setAdminOpen] = useState(
    new URLSearchParams(window.location.search).get('admin') === 'true'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [printStage, setPrintStage] = useState(0);
  const [showQrModal, setShowQrModal] = useState(
    new URLSearchParams(window.location.search).get('qr') === 'true'
  );
  const [printToast, setPrintToast] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Admin form state
  const [adminStorageMode, setAdminStorageMode] = useState<StorageMode>('both');
  const [adminMirrorPhoto, setAdminMirrorPhoto] = useState<boolean>(false);
  const [adminCountdown, setAdminCountdown] = useState<number>(3);
  const [adminPrintEnabled, setAdminPrintEnabled] = useState<boolean>(true);
  const [r2TestStatus, setR2TestStatus] = useState<string | null>(null);
  const [r2Testing, setR2Testing] = useState(false);
  const [adminSaveStatus, setAdminSaveStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const printImageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logoPressRef = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);

  // Fetch full config from server
  const fetchConfig = useCallback(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((c: Config) => {
        setConfig(prev => ({ ...prev, ...c }));
        setAdminStorageMode(c.storageMode || 'both');
        setAdminMirrorPhoto(Boolean(c.mirrorPhoto));
        setAdminCountdown(c.countdownSeconds ?? 3);
        setAdminPrintEnabled(c.printEnabled !== false);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Continuous Camera Stream with Native 1080p 30fps Landscape negotiation (Logitech C920 hardware accelerated)
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera');

      if (
        streamRef.current &&
        streamRef.current.active &&
        streamRef.current.getVideoTracks().some(t => t.readyState === 'live')
      ) {
        if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
        setCameraError('');
        return;
      }

      // Fast, native webcam resolution (1080p landscape 30fps) - avoids Windows DirectShow 5fps throttle on USB cameras
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 30, min: 24 },
          facingMode: 'user',
          ...(config.camera?.deviceId ? { deviceId: { exact: config.camera.deviceId } } : {}),
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      setCameraError('');
    } catch {
      try {
        // High-speed fallback for older or bandwidth-limited USB ports
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
        setCameraError('');
      } catch {
        setCameraReady(false);
        setCameraError('Camera unavailable');
      }
    }
  }, [config.camera?.deviceId]);

  // Keep camera warm and streaming continuously (instant 0ms switch from screensaver)
  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  // Re-verify video element attachment when switching to idle or countdown
  useEffect(() => {
    if ((screen === 'idle' || screen === 'countdown') && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [screen]);

  // Idle timeout
  const resetToSaver = useCallback(() => {
    setScreen('screensaver');
    setScreenPhoto(null);
    setPrintPhotoData(null);
    setPhotoId(null);
    setPhotoResult(null);
    setCountdown(null);
    setQrSeconds(30);
    setShowQrModal(false);
    setPrintToast(null);
    setIsPrinting(false);
    setErrorMessage('');
  }, []);

  useEffect(() => {
    if (screen !== 'screensaver') {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(resetToSaver, config.idleTimeoutSeconds * 1000);
    }
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [screen, config.idleTimeoutSeconds, resetToSaver]);

  // Audio feedback
  const beep = useCallback(
    (frequency = 660, duration = 0.12) => {
      if (!config.soundEnabled) return;
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.05;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
      } catch {
        /* optional sound */
      }
    },
    [config.soundEnabled]
  );

  // Compose captured photo into both:
  // 1. screenPhoto: 1080x1920 with SCREEN_FRAME (PHOTOBOOTH-FRAME-NEW-OLD.png) for kiosk display
  // 2. printPhoto: 1200x1800 with PRINT_FRAME (energya_4x6_1200x1800.png) for 4x6 printer & QR download
  const compose = useCallback(
    async (source: HTMLCanvasElement) => {
      const [screenFrameImg, printFrameImg] = await Promise.all([
        loadImage(SCREEN_FRAME),
        loadImage(PRINT_FRAME),
      ]);

      // 1. Kiosk Screen Display (1080x1920)
      const screenCanvas = document.createElement('canvas');
      screenCanvas.width = 1080;
      screenCanvas.height = 1920;
      const sCtx = screenCanvas.getContext('2d');
      if (!sCtx) throw new Error('canvas');
      cropCover(
        sCtx,
        source,
        source.width,
        source.height,
        0,
        0,
        1080,
        1920,
        Boolean(config.mirrorPhoto)
      );
      sCtx.drawImage(screenFrameImg, 0, 0, 1080, 1920);
      const screenPhotoResult = screenCanvas.toDataURL('image/jpeg', 0.95);

      // 2. Physical 4x6 Photo Print (1200x1800 at 300 DPI)
      const printCanvas = document.createElement('canvas');
      printCanvas.width = 1200;
      printCanvas.height = 1800;
      const pCtx = printCanvas.getContext('2d');
      if (!pCtx) throw new Error('canvas');
      pCtx.imageSmoothingEnabled = true;
      pCtx.imageSmoothingQuality = 'high';
      cropCover(
        pCtx,
        source,
        source.width,
        source.height,
        0,
        0,
        1200,
        1800,
        Boolean(config.mirrorPhoto)
      );
      pCtx.drawImage(printFrameImg, 0, 0, 1200, 1800);
      const printPhotoResult = printCanvas.toDataURL('image/jpeg', 1.0);

      return { screenPhoto: screenPhotoResult, printPhoto: printPhotoResult };
    },
    [config.mirrorPhoto]
  );

  // Persist photo to server
  const persistPhoto = useCallback(async (data: string): Promise<PhotoSaveResult> => {
    const response = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: data }),
    });
    if (!response.ok) throw new Error('save');
    const result: PhotoSaveResult = await response.json();
    return result;
  }, []);

  // Capture flow with continuous preview
  const capture = useCallback(() => {
    const source = videoRef.current;
    if (!source || !cameraReady || source.readyState < 2 || !source.videoWidth || !source.videoHeight) {
      setErrorMessage('Camera unavailable');
      setScreen('error');
      return;
    }

    const seconds = Math.max(1, config.countdownSeconds);
    setScreen('countdown');
    setCountdown(seconds);
    beep(700, 0.15);

    let value = seconds;
    const timer = window.setInterval(() => {
      value -= 1;
      if (value > 0) {
        setCountdown(value);
        beep(580, 0.12);
        return;
      }

      window.clearInterval(timer);
      setCountdown(null);
      beep(920, 0.25);

      void (async () => {
        try {
          await waitForVideoFrame(source);
          const snapshot = await snapshotCamera(source, streamRef.current);
          setScreen('flash');
          window.setTimeout(async () => {
            try {
              const { screenPhoto: sData, printPhoto: pData } = await compose(snapshot);
              setScreenPhoto(sData);
              setPrintPhotoData(pData);
              setScreen('review');
              // Pre-persist 4x6 print photo in background for instant QR & archive
              persistPhoto(pData)
                .then(result => {
                  setPhotoId(result.id);
                  setPhotoResult(result);
                })
                .catch(err => {
                  console.warn('Background photo persist error:', err);
                });
            } catch {
              setErrorMessage('Photo composition failed');
              setScreen('error');
            }
          }, 320);
        } catch {
          setErrorMessage('Camera capture failed');
          setScreen('error');
        }
      })();
    }, 1000);
  }, [cameraReady, config.countdownSeconds, compose, beep, persistPhoto]);

  const printPhoto = useCallback(async () => {
    const photoToPrint = printPhotoData || screenPhoto;
    if (!photoToPrint || isPrinting) return;
    setIsPrinting(true);
    setPrintToast('Sending photo to printer... 🖨️');

    if (!photoId) {
      try {
        const result = await persistPhoto(photoToPrint);
        setPhotoId(result.id);
        setPhotoResult(result);
      } catch {
        /* proceed anyway */
      }
    }

    try {
      const electronAPI = (window as unknown as { electronAPI?: { silentPrint?: (data?: string) => void } }).electronAPI;
      if (electronAPI?.silentPrint) {
        electronAPI.silentPrint(photoToPrint);
      } else {
        window.requestAnimationFrame(() => window.print());
      }
      setPrintToast('Photo sent to printer! 🖨️✨');
    } catch {
      setPrintToast('Print error - check printer connection');
    } finally {
      window.setTimeout(() => {
        setPrintToast(null);
        setIsPrinting(false);
      }, 3500);
    }
  }, [printPhotoData, screenPhoto, isPrinting, photoId, persistPhoto]);

  // QR timer
  useEffect(() => {
    if (screen !== 'qr') return;
    const timer = window.setInterval(() => setQrSeconds(value => (value <= 1 ? 0 : value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen === 'qr' && qrSeconds === 0) resetToSaver();
  }, [screen, qrSeconds, resetToSaver]);

  // Staff admin panel toggle (3 seconds press on Energya logo)
  const holdLogo = () => {
    logoPressRef.current = window.setTimeout(() => {
      fetchConfig();
      setAdminOpen(true);
    }, 3000);
  };
  const releaseLogo = () => {
    if (logoPressRef.current) window.clearTimeout(logoPressRef.current);
  };

  // Test Cloudflare R2 Connection from Admin Panel
  const testR2 = async () => {
    setR2Testing(true);
    setR2TestStatus(null);
    try {
      const res = await fetch('/api/r2/test');
      const data = await res.json();
      if (data.ok) {
        setR2TestStatus(`Connected! Bucket "${data.bucket}" active.`);
      } else {
        setR2TestStatus(`Error: ${data.error || 'Connection failed (offline)'}`);
      }
    } catch {
      setR2TestStatus('Server unreachable');
    } finally {
      setR2Testing(false);
    }
  };

  // Open Photos Folder in Windows Explorer
  const openPhotosFolder = async () => {
    try {
      await fetch('/api/photos/open-folder', { method: 'POST' });
    } catch {
      /* ignore */
    }
  };

  // Bulk Sync local photos to Cloudflare R2
  const syncToR2 = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const res = await fetch('/api/photos/sync-r2', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSyncStatus(`Uploaded ${data.synced} of ${data.total} photos to R2!`);
      } else {
        setSyncStatus(`Sync failed: ${data.error}`);
      }
    } catch {
      setSyncStatus('Sync request failed');
    } finally {
      setSyncing(false);
      fetchConfig();
    }
  };

  // Save Admin settings
  const saveAdminSettings = async () => {
    try {
      const payload = {
        storageMode: adminStorageMode,
        mirrorPhoto: adminMirrorPhoto,
        countdownSeconds: adminCountdown,
        printEnabled: adminPrintEnabled,
      };
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setConfig(prev => ({ ...prev, ...updated }));
        setAdminSaveStatus('Settings saved successfully!');
        window.setTimeout(() => setAdminSaveStatus(null), 3000);
      }
    } catch {
      setAdminSaveStatus('Failed to save settings');
    }
  };

  const LogoMark = ({ large = false }: { large?: boolean }) => (
    <div
      className={`logo-plaque ${large ? 'logo-plaque-large' : ''}`}
      onPointerDown={holdLogo}
      onPointerUp={releaseLogo}
      onPointerLeave={releaseLogo}
    >
      <div className="plaque-sheen" />
      <img src={LOGO} className="logo" alt="Energya Industries" />
    </div>
  );

  // Single QR code value for 1-scan mobile download
  const qrDownloadUrl =
    photoResult?.activeUrl ||
    (photoId ? `http://${config.detectedIp || '127.0.0.1'}:3000/photo/${photoId}` : `${window.location.origin}/photo/demo`);

  const isCloudQr = Boolean(photoResult?.isCloud || photoResult?.r2Url);

  return (
    <main className="kiosk" onContextMenu={event => event.preventDefault()}>
      <Stage>
        {/* Secret Admin Trigger - Top Right Corner (Invisible to guests) */}
        <button
          type="button"
          className="secret-admin-trigger"
          onClick={() => {
            fetchConfig();
            setAdminOpen(true);
          }}
          title="Staff Settings"
          aria-label="Staff Settings"
        />

        {/* 1. SCREENSAVER SCREEN */}
        {screen === 'screensaver' && (
          <section className="saver-content" onClick={() => setScreen('idle')}>
            {/* Ambient Background & Grid */}
            {/* Real Background Graphic from Exhibition Kiosk */}
            <img
              src={SCREENSAVER_BG}
              className="saver-background-image"
              alt="Screensaver Background"
            />

            {/* Subtle Center Energy Aura & Pulse Rings */}
            <div className="saver-energy-backdrop">
              {/* Radial center glow */}
              <div className="saver-center-glow" />

              {/* Bokeh circles */}
              <div className="saver-bokeh bokeh-1" />
              <div className="saver-bokeh bokeh-2" />
              <div className="saver-bokeh bokeh-3" />
              <div className="saver-bokeh bokeh-4" />

              {/* Connected constellation / energy circuit traces */}
              <svg className="saver-circuit-svg" viewBox="0 0 1080 1920" preserveAspectRatio="none">
                <defs>
                  <filter id="circuit-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <linearGradient id="trace-grad-1" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.2" />
                    <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.75" />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.95" />
                  </linearGradient>
                  <linearGradient id="trace-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.7" />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.15" />
                  </linearGradient>
                </defs>

                {/* Circuit lines matching the booth screen photo */}
                <g filter="url(#circuit-glow)">
                  <line x1="160" y1="1400" x2="280" y2="1280" stroke="url(#trace-grad-1)" strokeWidth="2.5" />
                  <line x1="280" y1="1280" x2="380" y2="1320" stroke="url(#trace-grad-1)" strokeWidth="2" />
                  <line x1="280" y1="1280" x2="360" y2="1160" stroke="url(#trace-grad-1)" strokeWidth="2.5" />
                  <line x1="360" y1="1160" x2="520" y2="1140" stroke="url(#trace-grad-1)" strokeWidth="3" />
                  <line x1="360" y1="1160" x2="310" y2="1020" stroke="url(#trace-grad-1)" strokeWidth="2" />
                  <line x1="520" y1="1140" x2="680" y2="1260" stroke="url(#trace-grad-2)" strokeWidth="2" />
                  <line x1="380" y1="1320" x2="490" y2="1420" stroke="url(#trace-grad-1)" strokeWidth="2" />
                  <line x1="490" y1="1420" x2="580" y2="1350" stroke="url(#trace-grad-1)" strokeWidth="1.5" />
                  <line x1="220" y1="1100" x2="360" y2="1160" stroke="url(#trace-grad-1)" strokeWidth="2" />
                  <line x1="180" y1="1220" x2="280" y2="1280" stroke="url(#trace-grad-1)" strokeWidth="2" />
                  <line x1="680" y1="1260" x2="780" y2="1200" stroke="url(#trace-grad-2)" strokeWidth="1.5" />

                  {/* Upper subtle branches */}
                  <line x1="520" y1="1140" x2="540" y2="920" stroke="url(#trace-grad-1)" strokeWidth="1.5" strokeDasharray="4 6" />
                  <line x1="310" y1="1020" x2="420" y2="880" stroke="url(#trace-grad-1)" strokeWidth="1.5" />

                  {/* Glowing node dots */}
                  <circle cx="160" cy="1400" r="5" fill="#38bdf8" />
                  <circle cx="280" cy="1280" r="7" fill="#67e8f9" />
                  <circle cx="380" cy="1320" r="6" fill="#38bdf8" />
                  <circle cx="360" cy="1160" r="8" fill="#ffffff" />
                  <circle cx="520" cy="1140" r="9" fill="#ffffff" />
                  <circle cx="680" cy="1260" r="6" fill="#38bdf8" />
                  <circle cx="780" cy="1200" r="5" fill="#0284c7" />
                  <circle cx="490" cy="1420" r="6" fill="#38bdf8" />
                  <circle cx="580" cy="1350" r="5" fill="#0284c7" />
                  <circle cx="310" cy="1020" r="6" fill="#38bdf8" />
                  <circle cx="220" cy="1100" r="5" fill="#38bdf8" />
                  <circle cx="180" cy="1220" r="5" fill="#0284c7" />
                  <circle cx="420" cy="880" r="5" fill="#38bdf8" />
                </g>
              </svg>

              {/* Pulsing Sonar Ring around the button */}
              <div className="energy-pulse-ring ring-1" />
              <div className="energy-pulse-ring ring-2" />
            </div>

            {/* Glossy 3D Red TAKE PHOTO Button */}
            <div className="saver-take-photo-container">
              <button
                type="button"
                className="saver-take-photo-btn"
                onClick={e => {
                  e.stopPropagation();
                  setScreen('idle');
                }}
              >
                TAKE PHOTO
              </button>
            </div>

            {/* Branded 1080x1920 Frame Overlay with Energya Logo, Hieroglyphics, Tower & Reel */}
            <img
              src={SCREEN_FRAME}
              className="fullscreen-frame-overlay"
              alt="Energya Screen Frame"
            />
          </section>
        )}

        {/* 2 & 3. FULLSCREEN CAMERA BOOTH VIEW (ALWAYS WARMED UP IN BACKGROUND) */}
        <div className={`fullscreen-booth-view ${(screen === 'idle' || screen === 'countdown') ? 'is-active' : 'is-background'}`}>
          {/* Live Camera Feed behind frame - Always streaming with zero delay */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`fullscreen-camera-video ${cameraReady ? 'is-ready' : 'is-loading'}`}
          />

          {!cameraReady && (screen === 'idle' || screen === 'countdown') && (
            <div className="camera-loading-overlay">
              <div className="loading-orbit" />
              <span>{cameraError || 'Starting camera...'}</span>
            </div>
          )}

          {/* Branded 1080x1920 Full-Screen Frame Overlay (Kiosk Screen) */}
          {(screen === 'idle' || screen === 'countdown') && (
            <img
              src={SCREEN_FRAME}
              className="fullscreen-frame-overlay"
              alt="Energya Screen Frame"
            />
          )}

          {/* Shutter Button with White Camera Icon (Only in Idle mode) */}
          {screen === 'idle' && (
            <div className="shutter-button-container">
              <button
                type="button"
                className="shutter-camera-btn"
                onClick={capture}
                title="Take photo"
                aria-label="Take photo"
              >
                <img
                  src="/new_design/camera_white.png"
                  className="shutter-camera-img"
                  alt="Take photo"
                />
              </button>
            </div>
          )}

          {/* Dynamic Countdown Overlay (Centered with pop number & smile prompt) */}
          {screen === 'countdown' && countdown !== null && (
            <div className="fullscreen-countdown-overlay">
              <div className="countdown-ring-box">
                <svg viewBox="0 0 200 200" className="countdown-svg">
                  <circle cx="100" cy="100" r="88" className="ring-bg" />
                  <circle
                    className="ring-progress"
                    cx="100"
                    cy="100"
                    r="88"
                    style={{
                      strokeDashoffset: `${((config.countdownSeconds - countdown) / config.countdownSeconds) * 553}`,
                    }}
                  />
                </svg>
                <span className="countdown-number" key={countdown}>
                  {countdown}
                </span>
              </div>
              <div className="countdown-smile-banner">Smile! 😊</div>
            </div>
          )}
        </div>

        {/* 4. FLASH EFFECT */}
        {screen === 'flash' && <div className="flash-screen" aria-label="Camera shutter flash" />}

        {/* 5. FULLSCREEN REVIEW SCREEN */}
        {screen === 'review' && screenPhoto && (
          <div className="fullscreen-review-view">
            {/* Fullscreen Photo on Screen (1080x1920) */}
            <img src={screenPhoto} className="fullscreen-review-photo" alt="Framed Photo" />

            {/* Hidden 4x6 print image container for standard browser print */}
            <div className="print-only">
              <img ref={printImageRef} src={printPhotoData || ''} alt="Print output" />
            </div>

            {/* Floating Action Bar at Bottom */}
            <div className="review-floating-bar">
              {/* Retake Button */}
              <button
                type="button"
                className="review-action-btn btn-retake-subtle"
                onClick={() => {
                  setScreenPhoto(null);
                  setPrintPhotoData(null);
                  setShowQrModal(false);
                  setScreen('idle');
                }}
                title="Retake photo"
              >
                <RetakeIcon className="action-btn-icon" />
                <span>Retake</span>
              </button>

              {/* Print Button with Printer Logo */}
              <button
                type="button"
                className={`review-action-btn btn-print-glow ${isPrinting ? 'is-printing' : ''}`}
                onClick={printPhoto}
                disabled={isPrinting}
                title="Print photo"
              >
                <PrinterIcon className="action-btn-icon" />
                <span className="action-btn-text">
                  {isPrinting ? 'Printing...' : 'Print'}
                </span>
              </button>

              {/* QR Button with QR Logo */}
              <button
                type="button"
                className="review-action-btn btn-qr-glow"
                onClick={() => setShowQrModal(true)}
                title="Get on phone with QR"
              >
                <QrIcon className="action-btn-icon" />
                <span className="action-btn-text">QR Code</span>
              </button>
            </div>

            {/* Printing Toast */}
            {printToast && (
              <div className="review-print-toast">
                <span className="toast-icon">🖨️</span>
                <span>{printToast}</span>
              </div>
            )}

            {/* QR Modal Overlay */}
            {showQrModal && (
              <div className="qr-modal-overlay" onClick={() => setShowQrModal(false)}>
                <div className="qr-modal-card" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="qr-modal-close-btn"
                    onClick={() => setShowQrModal(false)}
                    aria-label="Close QR Modal"
                  >
                    ✕
                  </button>

                  <div className="qr-modal-header">
                    <div className="qr-modal-eyebrow">ENERGYA PHOTOBOOTH</div>
                    <h2 className="qr-modal-title">Scan to Download</h2>
                    <p className="qr-modal-subhead">Point your phone camera to download your photo</p>
                  </div>

                  <div className="qr-modal-code-wrapper">
                    <QRCodeSVG
                      value={qrDownloadUrl}
                      size={360}
                      bgColor="#ffffff"
                      fgColor="#0B4DA2"
                      level="M"
                    />
                  </div>

                  <div className="qr-modal-status-badge">
                    {isCloudQr ? (
                      <span className="badge-cloud">
                        <span className="cloud-dot" /> Uploaded to <strong>Cloudflare R2</strong>
                      </span>
                    ) : (
                      <span className="badge-local">
                        <span className="local-dot" /> Saved on Kiosk Storage
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="qr-modal-back-btn"
                    onClick={() => setShowQrModal(false)}
                  >
                    Back to photo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. ERROR SCREEN */}
        {screen === 'error' && (
          <section className="screen-content simple-content error-screen">
            <div className="error-mark">!</div>
            <div className="header-text-block">
              <div className="eyebrow">ONE MOMENT</div>
              <h2>{errorMessage || 'Something went wrong'}</h2>
            </div>
            <Button onClick={resetToSaver}>Back to start</Button>
          </section>
        )}

        {/* Staff Admin Panel (3 seconds press on Energya logo) */}
        {adminOpen && (
          <div className="admin-overlay" onClick={() => setAdminOpen(false)}>
            <div className="admin-card" onClick={e => e.stopPropagation()}>
              <div className="admin-header">
                <div>
                  <div className="eyebrow">STAFF PANEL</div>
                  <h2>Kiosk & Storage Controls</h2>
                </div>
                <button
                  type="button"
                  className="admin-close-btn"
                  onClick={() => setAdminOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="admin-body">
                {/* 1. Storage Mode Selector */}
                <div className="admin-section">
                  <div className="admin-label">Storage Mode (Photo Saving & QR):</div>
                  <div className="admin-mode-selector">
                    <button
                      type="button"
                      className={`mode-btn ${adminStorageMode === 'both' ? 'active' : ''}`}
                      onClick={() => setAdminStorageMode('both')}
                    >
                      <span className="mode-icon">🔄</span>
                      <div className="mode-title">Both (Local + R2) [Recommended]</div>
                      <div className="mode-desc">
                        Saves a local backup on the PC AND uploads to Cloudflare R2 for instant 1-scan mobile downloads.
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${adminStorageMode === 'r2' ? 'active' : ''}`}
                      onClick={() => setAdminStorageMode('r2')}
                    >
                      <span className="mode-icon">☁️</span>
                      <div className="mode-title">Cloudflare R2 Only</div>
                      <div className="mode-desc">
                        Direct upload to Cloudflare R2. Guests scan once using their phone's cellular data.
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${adminStorageMode === 'local' ? 'active' : ''}`}
                      onClick={() => setAdminStorageMode('local')}
                    >
                      <span className="mode-icon">💾</span>
                      <div className="mode-title">Local Only (PC Disk)</div>
                      <div className="mode-desc">
                        Saves to PC hard drive only (for offline archives or copying to USB flash drive).
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. Photo Mirroring (Flip Captured Photo) */}
                <div className="admin-section">
                  <div className="admin-label">Photo Mirroring (Captured Photo):</div>
                  <div className="admin-mirror-selector">
                    <button
                      type="button"
                      className={`mode-btn ${!adminMirrorPhoto ? 'active' : ''}`}
                      onClick={() => setAdminMirrorPhoto(false)}
                    >
                      <span className="mode-icon">📷</span>
                      <div className="mode-title">Normal View (Unmirrored)</div>
                      <div className="mode-desc">
                        Captures photo like a real camera. Logos, badges, and text on shirts remain readable left-to-right.
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${adminMirrorPhoto ? 'active' : ''}`}
                      onClick={() => setAdminMirrorPhoto(true)}
                    >
                      <span className="mode-icon">🪞</span>
                      <div className="mode-title">Mirrored (Selfie Mode)</div>
                      <div className="mode-desc">
                        Flips the photo horizontally so it exactly matches what the guest saw in the mirror screen preview.
                      </div>
                    </button>
                  </div>
                </div>

                {/* 3. Kiosk Operation & Timing */}
                <div className="admin-section">
                  <div className="admin-label">Kiosk Operation & Timing:</div>
                  <div className="admin-grid-two">
                    <div className="setting-subgroup">
                      <div className="subgroup-title">⏱️ Countdown Timer:</div>
                      <div className="toggle-pill-group">
                        <button
                          type="button"
                          className={`toggle-pill ${adminCountdown === 3 ? 'active' : ''}`}
                          onClick={() => setAdminCountdown(3)}
                        >
                          3 Seconds (Fast)
                        </button>
                        <button
                          type="button"
                          className={`toggle-pill ${adminCountdown === 5 ? 'active' : ''}`}
                          onClick={() => setAdminCountdown(5)}
                        >
                          5 Seconds (Standard)
                        </button>
                      </div>
                    </div>

                    <div className="setting-subgroup">
                      <div className="subgroup-title">🖨️ Physical 4x6 Printing:</div>
                      <div className="toggle-pill-group">
                        <button
                          type="button"
                          className={`toggle-pill ${adminPrintEnabled ? 'active' : ''}`}
                          onClick={() => setAdminPrintEnabled(true)}
                        >
                          Enabled (Active)
                        </button>
                        <button
                          type="button"
                          className={`toggle-pill ${!adminPrintEnabled ? 'active' : ''}`}
                          onClick={() => setAdminPrintEnabled(false)}
                        >
                          Disabled (QR Only)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Photo Storage on PC & USB Export */}
                <div className="admin-section">
                  <div className="admin-label">Local PC Storage & USB Export:</div>
                  <div className="admin-actions-bar">
                    <div className="photos-count-info">
                      Photos saved on this PC: <strong>{config.savedPhotosCount ?? 0}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn-admin-action"
                      onClick={openPhotosFolder}
                    >
                      📂 Open Photos Folder on PC
                    </button>
                    <button
                      type="button"
                      className="btn-admin-action btn-sync"
                      onClick={syncToR2}
                      disabled={syncing}
                    >
                      {syncing ? 'Syncing...' : '☁️ Sync All Photos to R2'}
                    </button>
                  </div>
                  {syncStatus && <div className="admin-status-toast">{syncStatus}</div>}
                </div>

                {/* 3. Cloudflare R2 Connection Test */}
                <div className="admin-section">
                  <div className="admin-label">Cloudflare R2 Integration:</div>
                  <div className="r2-info-row">
                    <div>
                      Bucket: <strong>energya</strong> · Account: <code>6689d1626...</code>
                    </div>
                    <button
                      type="button"
                      className="btn-test-r2"
                      onClick={testR2}
                      disabled={r2Testing}
                    >
                      {r2Testing ? 'Testing...' : '⚡ Test R2 Connection'}
                    </button>
                  </div>
                  {r2TestStatus && (
                    <div
                      className={`r2-test-pill ${
                        r2TestStatus.includes('Connected') ? 'success' : 'fail'
                      }`}
                    >
                      {r2TestStatus}
                    </div>
                  )}
                </div>

                {/* Save message */}
                {adminSaveStatus && (
                  <div className="admin-status-toast">{adminSaveStatus}</div>
                )}
              </div>

              <div className="admin-footer-row">
                <Button onClick={saveAdminSettings} className="btn-save-admin">
                  Save Configuration
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    const electronAPI = (window as unknown as { electronAPI?: { silentPrint?: (data?: string) => void } }).electronAPI;
                    if (electronAPI?.silentPrint) {
                      electronAPI.silentPrint();
                    } else {
                      window.print();
                    }
                  }}
                >
                  Test print
                </Button>
                <Button secondary onClick={() => setAdminOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden-canvas" />
      </Stage>

      {/* Print-only media container */}
      <div className="print-only">
        {printPhotoData && <img ref={printImageRef} src={printPhotoData} alt="Energya 4x6 photo for printing" />}
      </div>
    </main>
  );
}
