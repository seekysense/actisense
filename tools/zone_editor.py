#!/usr/bin/env python3
"""
Editor grafico zone ROI — VisionSemanticAgent.
Avvia un server HTTP locale e apre il browser automaticamente.
Nessuna dipendenza aggiuntiva oltre a opencv, yaml e Pillow già nel progetto.

Utilizzo:
    python tools/zone_editor.py --video VIDEO.mp4 --camera config/cameras/CAM.yaml
    python tools/zone_editor.py --video VIDEO.mp4 --camera config/cameras/CAM.yaml --port 8765
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

# ---------------------------------------------------------------------------
# Server state
# ---------------------------------------------------------------------------

class EditorState:
    def __init__(self, video_path: str, yaml_path: str) -> None:
        self.yaml_path = Path(yaml_path)
        self.cap = cv2.VideoCapture(video_path)
        if not self.cap.isOpened():
            raise ValueError(f"Impossibile aprire video: {video_path}")
        self.total_frames = max(1, int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        self.native_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.native_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        with open(yaml_path) as f:
            self.cam_data = yaml.safe_load(f)

        roi = (self.cam_data.get("preprocessing") or {}).get("roi") or {}
        self.zones: list[dict] = [copy.deepcopy(z) for z in (roi.get("zones") or [])]
        self._cache: dict[int, np.ndarray] = {}

    def _native_frame(self, idx: int) -> np.ndarray | None:
        if idx not in self._cache:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = self.cap.read()
            if not ok:
                return None
            self._cache[idx] = frame
            if len(self._cache) > 30:
                del self._cache[min(self._cache)]
        return self._cache[idx]

    def frame_b64(self, idx: int) -> str:
        frame = self._native_frame(idx)
        if frame is None:
            return ""
        disp = cv2.resize(frame, (960, 540), interpolation=cv2.INTER_AREA)
        _, buf = cv2.imencode(".jpg", disp, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return base64.b64encode(buf.tobytes()).decode()

    def preview_b64(self, zone: dict, frame_idx: int,
                    persp_handles: list | None = None) -> str:
        frame = self._native_frame(frame_idx)
        if frame is None:
            return ""
        try:
            from engine.preprocessing.roi import crop_zone
            z = copy.deepcopy(zone)
            if persp_handles and len(persp_handles) == 4:
                z["perspective_quad"] = [[int(p[0]), int(p[1])] for p in persp_handles]
            excl = [z2 for z2 in self.zones if z2.get("exclude", False)]
            crop = crop_zone(frame, z, exclude_zones=excl)
            if crop.size == 0:
                return ""
            preview = cv2.resize(crop, (280, 280), interpolation=cv2.INTER_AREA)
            _, buf = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return base64.b64encode(buf.tobytes()).decode()
        except Exception:
            return ""

    def save(self, zones: list[dict]) -> None:
        cam = copy.deepcopy(self.cam_data)
        if "preprocessing" not in cam:
            cam["preprocessing"] = {}
        if not isinstance(cam["preprocessing"].get("roi"), dict):
            cam["preprocessing"]["roi"] = {"enabled": True}
        cam["preprocessing"]["roi"]["zones"] = zones
        with open(self.yaml_path, "w") as f:
            yaml.dump(cam, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        self.zones = zones

    def info(self) -> dict:
        return {
            "total_frames": self.total_frames,
            "native_w": self.native_w,
            "native_h": self.native_h,
            "zones": self.zones,
        }


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

_STATE: EditorState | None = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._html(HTML)
        elif path == "/api/info":
            self._json(_STATE.info())  # type: ignore[union-attr]
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body: dict = json.loads(self.rfile.read(length)) if length else {}
        path = urlparse(self.path).path

        if path == "/api/frame":
            img = _STATE.frame_b64(int(body.get("idx", 0)))  # type: ignore[union-attr]
            self._json({"image": img})
        elif path == "/api/preview":
            img = _STATE.preview_b64(  # type: ignore[union-attr]
                body.get("zone", {}),
                int(body.get("frame_idx", 0)),
                body.get("persp_handles"),
            )
            self._json({"image": img})
        elif path == "/api/save":
            _STATE.save(body.get("zones", []))  # type: ignore[union-attr]
            self._json({"ok": True})
        else:
            self.send_error(404)

    def _html(self, content: str) -> None:
        b = content.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(b))
        self.end_headers()
        self.wfile.write(b)

    def _json(self, data: dict) -> None:
        b = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(b))
        self.end_headers()
        self.wfile.write(b)


# ---------------------------------------------------------------------------
# HTML + JS (embedded)
# ---------------------------------------------------------------------------

HTML = r"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Zone Editor — VisionSemanticAgent</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#1a1a2e;color:#e0e0e0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
#header{background:#16213e;padding:7px 14px;font-size:12px;color:#8a9abd;border-bottom:1px solid #333;flex-shrink:0}
#app{display:flex;flex:1;overflow:hidden}
#left{display:flex;flex-direction:column;flex-shrink:0}
#modebar{background:#0f3460;padding:5px 10px;font-size:12px;min-height:26px;flex-shrink:0;color:#cce}
canvas{display:block;cursor:crosshair;flex-shrink:0}
#nav{padding:5px 8px;background:#16213e;display:flex;align-items:center;gap:8px;font-size:12px;flex-shrink:0}
#fslider{width:730px;accent-color:#3a8a7a}
#sidebar{width:304px;background:#16213e;border-left:1px solid #2a2a4a;padding:10px 10px 6px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;flex-shrink:0}
h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6a9abd;margin-bottom:3px}
hr{border:none;border-top:1px solid #2a2a4a;margin:2px 0}
#zlist{list-style:none;max-height:130px;overflow-y:auto;border:1px solid #2a2a4a;border-radius:3px}
#zlist li{padding:4px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid #1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#zlist li:hover{background:#1e3050}
#zlist li.sel{background:#0f3460;color:#7ad4c8}
.row{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
button{padding:4px 9px;border:none;border-radius:3px;cursor:pointer;font-size:11px}
.bp{background:#2a5a8a;color:#fff}.bd{background:#7a2a2a;color:#fff}
.bg{background:#2a5a3a;color:#fff}.by{background:#5a4a1a;color:#ffd}.bn{background:#333;color:#bbb}
.pr{display:flex;align-items:center;gap:6px;font-size:12px;margin-top:3px}
.pr label{width:62px;color:#888;flex-shrink:0}
.pr input[type=text]{flex:1;background:#1a2a3a;border:1px solid #444;color:#e0e0e0;padding:2px 6px;border-radius:3px;font-size:12px}
.pr input[type=checkbox]{accent-color:#3a8a7a;width:14px;height:14px}
#rslider{width:100%;accent-color:#3a8a7a;margin-top:2px}
#prev{width:280px;height:280px;object-fit:contain;border:1px solid #2a2a4a;background:#111;display:block}
#status{font-size:11px;color:#6aaa88;min-height:18px;margin-top:2px}
#bsave{background:#1a5a2a;color:#fff;padding:9px;font-size:13px;font-weight:bold;border-radius:5px;width:100%;margin-top:auto;letter-spacing:.5px}
#bsave:hover{background:#2a7a3a}
</style>
</head>
<body>
<div id="header">Zone Editor — VisionSemanticAgent &nbsp;|&nbsp; doppio-click: chiudi poligono &nbsp;|&nbsp; tasto destro: cancella punto &nbsp;|&nbsp; ESC: annulla</div>
<div id="app">
 <div id="left">
  <div id="modebar">Modalità: seleziona zona</div>
  <canvas id="cv" width="960" height="540"></canvas>
  <div id="nav">
   <span>Frame:</span>
   <input type="range" id="fslider" min="0" max="0" value="0">
   <span id="flabel">0 / 0</span>
  </div>
 </div>
 <div id="sidebar">
  <div>
   <h3>Zone</h3>
   <ul id="zlist"></ul>
   <div class="row">
    <button class="bp" id="badd">+ Aggiungi</button>
    <button class="bd" id="bdel">✕ Elimina</button>
    <button class="bn" id="bcanc">⎋ Annulla</button>
   </div>
  </div>
  <hr>
  <div>
   <h3>Proprietà zona</h3>
   <div class="pr"><label>Nome</label><input type="text" id="pname" placeholder="zona_X"></div>
   <div class="pr" style="margin-top:5px"><label>Escludi</label><input type="checkbox" id="pexcl"></div>
   <div style="margin-top:7px;font-size:12px;color:#888">Rotazione: <span id="rval">0.0°</span></div>
   <input type="range" id="rslider" min="-45" max="45" step="0.5" value="0">
  </div>
  <hr>
  <div>
   <h3>Correzione prospettica</h3>
   <p style="font-size:11px;color:#666;margin-bottom:5px">Trascina i 4 vertici rossi sugli angoli reali del rettangolo nella scena</p>
   <div class="row">
    <button class="bg" id="bpersp">Modifica prospettiva</button>
    <button class="bd" id="bpreset">Reset</button>
   </div>
  </div>
  <hr>
  <div>
   <h3>Preview crop</h3>
   <img id="prev" alt="preview">
  </div>
  <div id="status"></div>
  <button id="bsave">💾 &nbsp;Salva YAML</button>
 </div>
</div>
<script>
const COLORS=['#e84444','#44aaff','#44dd88','#ffaa33','#cc44ff','#ffdd33'];
const HR=10, DW=960, DH=540;
let info={native_w:1920,native_h:1080,total_frames:1,zones:[]};
let zones=[], selIdx=null, frameIdx=0;
let mode='idle'; // idle|drawing|perspective
let drawPts=[], perspH=null, dragH=null, mpos={x:0,y:0};
let frameImg=new Image(), prevTimer=null;
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');

const toN=(x,y)=>[Math.round(x*info.native_w/DW),Math.round(y*info.native_h/DH)];
const toD=(nx,ny)=>[nx*DW/info.native_w,ny*DH/info.native_h];
const d2=(ax,ay,bx,by)=>(ax-bx)**2+(ay-by)**2;

async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}

async function loadFrame(idx){
  const d=await post('/api/frame',{idx});
  if(!d.image)return;
  frameImg=new Image();
  frameImg.onload=render;
  frameImg.src='data:image/jpeg;base64,'+d.image;
  document.getElementById('flabel').textContent=`${idx}/${info.total_frames-1}`;
}

function schedPreview(){
  clearTimeout(prevTimer);
  prevTimer=setTimeout(doPreview,180);
}

async function doPreview(){
  if(selIdx===null||selIdx>=zones.length){document.getElementById('prev').src='';return;}
  const z=zones[selIdx];
  if(!z.polygon||z.exclude)return;
  const d=await post('/api/preview',{zone:z,frame_idx:frameIdx,persp_handles:mode==='perspective'?perspH:null});
  if(d.image)document.getElementById('prev').src='data:image/jpeg;base64,'+d.image;
}

function setStatus(m){document.getElementById('status').textContent=m;}

// ── Render ──────────────────────────────────────────────────────────────────

function render(){
  ctx.clearRect(0,0,DW,DH);
  if(frameImg.complete&&frameImg.src)ctx.drawImage(frameImg,0,0,DW,DH);

  zones.forEach((z,i)=>{
    if(!z.polygon||z.polygon.length<2)return;
    const col=COLORS[i%COLORS.length], pts=z.polygon.map(([x,y])=>toD(x,y)), sel=i===selIdx;
    ctx.beginPath();ctx.moveTo(...pts[0]);pts.slice(1).forEach(p=>ctx.lineTo(...p));ctx.closePath();
    ctx.fillStyle=z.exclude?'rgba(255,136,0,.18)':col+'33';ctx.fill();
    ctx.strokeStyle=col;ctx.lineWidth=sel?3:2;ctx.stroke();
    pts.forEach(([px,py])=>{ctx.beginPath();ctx.arc(px,py,sel?6:4,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();});
    if(pts.length){
      const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length, cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
      ctx.fillStyle='#fff';ctx.font='bold 13px system-ui';
      ctx.fillText((z.exclude?'[X] ':'')+( z.name||'?'),cx-20,cy);
    }
  });

  if(mode==='drawing'&&drawPts.length>0){
    const pts=[...drawPts,[mpos.x,mpos.y]];
    ctx.beginPath();ctx.moveTo(...pts[0]);pts.slice(1).forEach(p=>ctx.lineTo(...p));
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);
    drawPts.forEach(([px,py])=>{ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();});
  }

  if(mode==='perspective'&&perspH){
    const hd=perspH.map(([x,y])=>toD(x,y));
    ctx.beginPath();ctx.moveTo(...hd[0]);hd.slice(1).forEach(p=>ctx.lineTo(...p));ctx.closePath();
    ctx.strokeStyle='#ff4444';ctx.lineWidth=2;ctx.stroke();
    hd.forEach(([px,py])=>{
      ctx.beginPath();ctx.arc(px,py,HR,0,Math.PI*2);
      ctx.fillStyle='#ff2020';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    });
  }
}

// ── Mouse ────────────────────────────────────────────────────────────────────

cv.addEventListener('mousemove',e=>{
  const r=cv.getBoundingClientRect(); mpos={x:e.clientX-r.left,y:e.clientY-r.top};
  if(mode==='perspective'&&dragH!==null){
    perspH[dragH]=toN(mpos.x,mpos.y); schedPreview();
  }
  render();
});

cv.addEventListener('mousedown',e=>{
  const r=cv.getBoundingClientRect(); const cx=e.clientX-r.left,cy=e.clientY-r.top;
  if(mode==='drawing'){drawPts.push([cx,cy]);render();return;}
  if(mode==='perspective'&&perspH){
    const hd=perspH.map(([x,y])=>toD(x,y));
    for(let i=0;i<hd.length;i++){if(d2(cx,cy,...hd[i])<=HR**2*4){dragH=i;return;}}
    return;
  }
  selectZone(zoneAt(cx,cy));
});

cv.addEventListener('mouseup',()=>dragH=null);

cv.addEventListener('dblclick',e=>{
  if(mode==='drawing'&&drawPts.length>=3){
    zones.push({name:'zona_'+(zones.length+1),polygon:drawPts.map(([x,y])=>toN(x,y))});
    drawPts=[];setMode('idle');selectZone(zones.length-1);refreshList();
  }
});

cv.addEventListener('contextmenu',e=>{
  e.preventDefault();if(mode==='drawing'&&drawPts.length>0){drawPts.pop();render();}
});

document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelMode();});

// ── Hit test ─────────────────────────────────────────────────────────────────

function zoneAt(dx,dy){
  const[nx,ny]=toN(dx,dy);
  for(let i=zones.length-1;i>=0;i--){
    const p=zones[i].polygon;if(!p||p.length<3)continue;
    if(pip(nx,ny,p))return i;
  }
  return null;
}

function pip(x,y,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}

// ── Zone list ────────────────────────────────────────────────────────────────

function refreshList(){
  const ul=document.getElementById('zlist'); ul.innerHTML='';
  zones.forEach((z,i)=>{
    const li=document.createElement('li');
    li.textContent=(z.exclude?'[X] ':'    ')+(z.name||'?');
    if(i===selIdx)li.classList.add('sel');
    li.onclick=()=>selectZone(i);
    ul.appendChild(li);
  });
}

function selectZone(idx){
  selIdx=idx;
  if(idx!==null&&idx<zones.length){
    const z=zones[idx];
    document.getElementById('pname').value=z.name||'';
    document.getElementById('pexcl').checked=!!z.exclude;
    const rot=z.rotation||0;
    document.getElementById('rslider').value=rot;
    document.getElementById('rval').textContent=rot.toFixed(1)+'°';
  }
  refreshList();schedPreview();render();
}

// ── Mode ─────────────────────────────────────────────────────────────────────

function setMode(m){
  mode=m;
  const bar=document.getElementById('modebar');
  if(m==='idle')bar.textContent='Modalità: seleziona zona';
  else if(m==='drawing')bar.textContent='DISEGNO — click vertici, doppio-click chiudi, tasto destro annulla punto';
  else if(m==='perspective')bar.textContent='PROSPETTIVA — trascina i 4 vertici rossi, poi conferma';
  render();
}

function cancelMode(){
  drawPts=[];
  if(mode==='perspective'){perspH=null;document.getElementById('bpersp').textContent='Modifica prospettiva';document.getElementById('bpersp').className='bg';}
  setMode('idle');
}

// ── Controls ─────────────────────────────────────────────────────────────────

document.getElementById('fslider').addEventListener('input',async e=>{
  frameIdx=parseInt(e.target.value);await loadFrame(frameIdx);schedPreview();
});

document.getElementById('badd').onclick=()=>{drawPts=[];setMode('drawing');};

document.getElementById('bdel').onclick=()=>{
  if(selIdx!==null&&selIdx<zones.length){zones.splice(selIdx,1);selIdx=null;perspH=null;setMode('idle');refreshList();render();}
};

document.getElementById('bcanc').onclick=cancelMode;

document.getElementById('pname').addEventListener('change',e=>{
  if(selIdx!==null){zones[selIdx].name=e.target.value;refreshList();render();}
});

document.getElementById('pexcl').addEventListener('change',e=>{
  if(selIdx!==null){if(e.target.checked)zones[selIdx].exclude=true;else delete zones[selIdx].exclude;refreshList();render();}
});

document.getElementById('rslider').addEventListener('input',e=>{
  const v=parseFloat(e.target.value);
  document.getElementById('rval').textContent=v.toFixed(1)+'°';
  if(selIdx!==null){if(Math.abs(v)<0.05)delete zones[selIdx].rotation;else zones[selIdx].rotation=v;}
  schedPreview();
});

document.getElementById('bpersp').onclick=()=>{
  if(selIdx===null||selIdx>=zones.length)return;
  const z=zones[selIdx];if(z.exclude)return;
  if(mode==='perspective'){
    if(perspH)zones[selIdx].perspective_quad=perspH.map(p=>[...p]);
    perspH=null;document.getElementById('bpersp').textContent='Modifica prospettiva';document.getElementById('bpersp').className='bg';
    setMode('idle');schedPreview();
  }else{
    if(!z.polygon||z.polygon.length<3)return;
    if(z.perspective_quad&&z.perspective_quad.length===4)perspH=z.perspective_quad.map(p=>[...p]);
    else{
      const xs=z.polygon.map(p=>p[0]),ys=z.polygon.map(p=>p[1]);
      const mn=Math.min,mx=Math.max;
      perspH=[[mn(...xs),mn(...ys)],[mx(...xs),mn(...ys)],[mx(...xs),mx(...ys)],[mn(...xs),mx(...ys)]];
    }
    document.getElementById('bpersp').textContent='✓ Conferma prospettiva';document.getElementById('bpersp').className='by';
    setMode('perspective');schedPreview();
  }
};

document.getElementById('bpreset').onclick=()=>{
  if(selIdx!==null)delete zones[selIdx].perspective_quad;
  perspH=null;document.getElementById('bpersp').textContent='Modifica prospettiva';document.getElementById('bpersp').className='bg';
  setMode('idle');schedPreview();
};

document.getElementById('bsave').onclick=async()=>{
  const clean=zones.map(z=>{
    const c={name:z.name||'zona'};
    if(z.polygon)c.polygon=z.polygon;
    if(z.rotation&&Math.abs(z.rotation)>0.05)c.rotation=parseFloat(z.rotation.toFixed(2));
    if(z.perspective_quad)c.perspective_quad=z.perspective_quad;
    if(z.exclude)c.exclude=true;
    return c;
  });
  const d=await post('/api/save',{zones:clean});
  setStatus(d.ok?'✓ Salvato in '+location.host:'✗ Errore nel salvataggio');
};

// ── Init ─────────────────────────────────────────────────────────────────────

(async()=>{
  const r=await fetch('/api/info'); info=await r.json();
  zones=info.zones||[];
  document.getElementById('fslider').max=info.total_frames-1;
  await loadFrame(0);
  refreshList();setMode('idle');
})();
</script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    global _STATE

    parser = argparse.ArgumentParser(
        description="Editor grafico zone ROI (browser-based)"
    )
    parser.add_argument("--video",  required=True, help="Path al video campione (.mp4)")
    parser.add_argument("--camera", required=True,
                        help="Path al YAML della telecamera")
    parser.add_argument("--port",   type=int, default=8765,
                        help="Porta HTTP locale (default 8765)")
    args = parser.parse_args()

    for p, label in [(args.video, "video"), (args.camera, "camera YAML")]:
        if not Path(p).exists():
            print(f"ERROR: {label} non trovato: {p}")
            sys.exit(1)

    _STATE = EditorState(args.video, args.camera)

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    url = f"http://127.0.0.1:{args.port}"
    print(f"Zone Editor avviato → {url}")
    print(f"Video:  {args.video}")
    print(f"Camera: {args.camera}")
    print("Premi Ctrl+C per uscire.")
    webbrowser.open(url)

    try:
        t.join()
    except KeyboardInterrupt:
        print("\nArresto.")
        httpd.shutdown()
        _STATE.cap.release()


if __name__ == "__main__":
    main()
