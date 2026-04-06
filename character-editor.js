// ── character-editor.js ──
// Logi character designer. Loaded by index.html as a plain script (no ES modules).
// Exposes: initCharEditor(), openCharEditor(entryId), buildSkeletonCache()
// Depends on: dictionary (global), setDirty (global), showToast (global)

// ── Constants ──
const CE_STROKE = 0;         // global stroke-width for rendered paths
const CE_VIEWBOX = 100;       // all radical paths live in 0 0 100 100 space
const CE_CANVAS_PX = 320;     // rendered canvas square size in px (CSS)
const SVG_NS     = 'http://www.w3.org/2000/svg';
const FILL_ENABLED = true;
const STROKE_ENABLED = false;

// Port origin points in the radical's 100x100 local space
const PORT_ORIGINS = {
  N: { x: 50,  y: 0   },
  S: { x: 50,  y: 100 },
  E: { x: 100, y: 50  },
  W: { x: 0,   y: 50  },
};

// Unit vectors pointing inward from each port
const PORT_INWARD = {
  N: { dx:  0, dy:  1 },
  S: { dx:  0, dy: -1 },
  E: { dx: -1, dy:  0 },
  W: { dx:  1, dy:  0 },
};

// ── Layout templates ──
// Each template is an array of slot definitions: { id, row, col, rowspan, colspan }
// mapped onto a 2x2 grid. Coordinates are in the 0-100 SVG space.
const LAYOUTS = {
  'quad': [
    { id: 'tl', x:  0, y:  0, w: 50, h: 50 },
    { id: 'tr', x: 50, y:  0, w: 50, h: 50 },
    { id: 'bl', x:  0, y: 50, w: 50, h: 50 },
    { id: 'br', x: 50, y: 50, w: 50, h: 50 },
  ],
  'top-wide': [
    { id: 'top', x:  0, y:  0, w: 100, h: 50 },
    { id: 'bl',  x:  0, y: 50, w:  50, h: 50 },
    { id: 'br',  x: 50, y: 50, w:  50, h: 50 },
  ],
  'bottom-wide': [
    { id: 'tl',     x:  0, y:  0, w:  50, h: 50 },
    { id: 'tr',     x: 50, y:  0, w:  50, h: 50 },
    { id: 'bottom', x:  0, y: 50, w: 100, h: 50 },
  ],
  'left-tall': [
    { id: 'left', x:  0, y:  0, w: 50, h: 100 },
    { id: 'tr',   x: 50, y:  0, w: 50, h:  50 },
    { id: 'br',   x: 50, y: 50, w: 50, h:  50 },
  ],
  'right-tall': [
    { id: 'tl',    x:  0, y:  0, w: 50, h:  50 },
    { id: 'bl',    x:  0, y: 50, w: 50, h:  50 },
    { id: 'right', x: 50, y:  0, w: 50, h: 100 },
  ],
  'h-split': [
    { id: 'top',    x:  0, y:  0, w: 100, h: 50 },
    { id: 'bottom', x:  0, y: 50, w: 100, h: 50 },
  ],
  'v-split': [
    { id: 'left',  x:  0, y: 0, w: 50, h: 100 },
    { id: 'right', x: 50, y: 0, w: 50, h: 100 },
  ],
  'full': [
    { id: 'full', x: 0, y: 0, w: 100, h: 100 },
  ],
};

// ── State ──
let ceRadicals = [];           // loaded radical library
let ceLayout = 'quad';         // current layout key
let ceSlots = {};              // { slotId: [LayerObject, ...] }
let ceSelected = null;         // { slotId, layerIdx } or null
let ceActiveRadical = null;    // radical id selected from library (mobile tap-to-place)
let ceTargetEntryId = null;    // dictionary entry we're editing a character for
let ceDragState = null;        // { radicalId, fromSlotId, fromLayerIdx } during drag
let ceInitialised = false;

// ── Init ──
async function initCharEditor() {
  if (typeof Flatten === 'undefined') {
    const errorMsg = "Flatten.js could not be loaded!";
    showToast(errorMsg, 'error');
    console.error(errorMsg);
    return; // Stop initialization
  }

  if (ceInitialised) return;
  ceInitialised = true;

  // Load radicals
  try {
    const resp = await fetch('radicals.json');
    const json = await resp.json();
    ceRadicals = json.radicals || [];
    console.log('Precomputing portOffsets...');
    ceRadicals.forEach((rad, idx) => {
      rad.portOffsets = {
        N: barEndpoint('N', rad.path),
        S: barEndpoint('S', rad.path),
        E: barEndpoint('E', rad.path),
        W: barEndpoint('W', rad.path)
      };
      console.log(`Computed ${idx}/${ceRadicals.length} (${(idx/ceRadicals.length * 100).toFixed(1)}%)`)
    });
    console.log('Done!');
  } catch (e) {
    console.error(e);
    showToast('Could not load radicals', 'error');
    ceRadicals = [];
    debugger;
  }

  buildEditorDOM();
  renderLibrary();
  renderLayoutPicker();
  renderCanvas();
}

// ── Open editor targeting a dictionary entry ──
function openCharEditor(entryId) {
  ceTargetEntryId = entryId;
  const entry = dictionary.entries.find(e => e.id === entryId);

  // Load existing skeleton if present
  if (entry && entry.skeleton) {
    ceLayout = entry.skeleton.layout || 'quad';
    ceSlots = deepClone(entry.skeleton.slots || {});
  } else {
    ceLayout = 'quad';
    ceSlots = {};
  }
  ceSelected = null;
  ceActiveRadical = null;

  // Update entry label in header
  const lbl = document.getElementById('ce-entry-label');
  if (lbl && entry) lbl.textContent = `Editing: ${entry.gloss}`;
  populateEntrySelect();
  renderLayoutPicker();
  renderCanvas();
  updateInspector();
  updateExportPreview();
}

// ── DOM construction ──
// Called once; builds the #charEditorView div that lives inside .main
function buildEditorDOM() {
  const main = document.querySelector('.main');
  const view = document.createElement('div');
  view.id = 'charEditorView';
  view.className = 'char-editor-view';
  view.innerHTML = `
    <div class="ce-sidebar" id="ceSidebar">
      <div class="ce-section-head">Layout</div>
      <div class="ce-layout-picker" id="ceLayoutPicker"></div>
      <div class="ce-section-head" style="margin-top:1rem">
        Radicals
        <input class="ce-search" id="ceLibSearch" placeholder="Search…" autocomplete="off">
      </div>
      <div class="ce-library" id="ceLibrary"></div>
    </div>

    <div class="ce-center">
      <div class="ce-canvas-wrap">
        <div class="ce-canvas" id="ceCanvas">
          <svg id="ceCanvasSvg" viewBox="0 0 100 100"
               xmlns="http://www.w3.org/2000/svg"
               style="width:100%;height:100%"
               ondragover="ceDragOver(event)"
               ondrop="ceDrop(event)">
          </svg>
        </div>
        <div class="ce-canvas-actions">
          <button class="btn-sm" onclick="ceClear()">Clear</button>
          <button class="btn-sm" onclick="ceExportSVG()">Copy SVG</button>
          <button class="btn-sm accent" onclick="ceSaveToEntry()">Save to entry</button>
        </div>
      </div>
      <div class="ce-entry-label" id="ce-entry-label">No entry selected</div>
    </div>

    <div class="ce-inspector" id="ceInspector">
      <div class="ce-section-head">Inspector</div>
      <div id="ceInspectorBody" class="ce-inspector-body">
        <div style="color:var(--ink-4);font-size:0.82rem">Select a slot to inspect layers.</div>
      </div>
      <div class="ce-section-head" style="margin-top:1rem">Preview</div>
      <div class="ce-preview-wrap">
        <svg id="cePreviewSvg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
             style="width:80px;height:80px;border:1px solid var(--rule);border-radius:4px;background:white">
        </svg>
      </div>
      <div class="ce-section-head" style="margin-top:1rem">Save to entry</div>
      <div style="padding:0 0.75rem 0.5rem">
        <select class="form-select" id="ceEntrySelect" style="width:100%;font-size:0.8rem">
          <option value="">— choose entry —</option>
        </select>
        <button class="btn-sm accent" style="margin-top:0.5rem;width:100%" onclick="ceSaveToEntry()">Save skeleton</button>
      </div>
    </div>
  `;
  main.appendChild(view);

  // Mobile bottom drawer for library
  const drawer = document.createElement('div');
  drawer.id = 'ceDrawer';
  drawer.className = 'ce-drawer';
  drawer.innerHTML = `
    <div class="ce-drawer-handle" onclick="ceToggleDrawer()"></div>
    <div class="ce-drawer-content">
      <input class="ce-search" id="ceDrawerSearch" placeholder="Search radicals…" autocomplete="off">
      <div class="ce-library ce-drawer-library" id="ceDrawerLibrary"></div>
    </div>
  `;
  document.body.appendChild(drawer);

  // Wire search
  document.getElementById('ceLibSearch').addEventListener('input', e => renderLibrary(e.target.value));
  document.getElementById('ceDrawerSearch').addEventListener('input', e => renderLibrary(e.target.value, true));

  // Populate entry select
  populateEntrySelect();
}

function populateEntrySelect() {
  const sel = document.getElementById('ceEntrySelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— choose entry —</option>' +
    dictionary.entries.slice()
      .sort((a, b) => a.gloss.localeCompare(b.gloss))
      .map(e =>
        `<option value="${e.id}" ${e.id === ceTargetEntryId ? 'selected' : ''}>${e.gloss} (${e.type})</option>`
      ).join('');
  sel.onchange = () => openCharEditor(sel.value);
}

// ── Library ──
function renderLibrary(query = '', drawer = false) {
  const container = document.getElementById(drawer ? 'ceDrawerLibrary' : 'ceLibrary');
  if (!container) return;

  const q = query.toLowerCase().trim();
  const filtered = q
    ? ceRadicals.filter(r =>
        r.label.toLowerCase().includes(q) ||
        (r.tags || []).some(t => t.includes(q)))
    : ceRadicals;

  container.innerHTML = filtered.map(r => `
    <div class="ce-lib-item ${ceActiveRadical === r.id ? 'active' : ''}"
         title="${r.label}" draggable="true"
         ondragstart="ceLibDragStart(event,'${r.id}')"
         onclick="ceLibTap('${r.id}')">
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="${r.path}" fill="${FILL_ENABLED ? 'currentColor' : 'none'}" stroke="${STROKE_ENABLED ? 'currentColor' : 'none'}"
              stroke-width="${CE_STROKE}"/>
      </svg>
      <span>${r.label}</span>
    </div>
  `).join('');
}

// ── Layout picker ──
function renderLayoutPicker() {
  const container = document.getElementById('ceLayoutPicker');
  if (!container) return;
  container.innerHTML = Object.keys(LAYOUTS).map(key => {
    const rects = LAYOUTS[key].map(s =>
      `<rect x="${s.x+1}" y="${s.y+1}" width="${s.w-2}" height="${s.h-2}" rx="3"/>`
    ).join('');
    return `
      <div class="ce-layout-thumb ${key === ceLayout ? 'active' : ''}"
           title="${key}" onclick="ceSetLayout('${key}')">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${rects}</svg>
      </div>
    `;
  }).join('');
}

function ceSetLayout(key) {
  ceLayout = key;
  // Remove layers from slots that no longer exist in the new layout
  const validIds = LAYOUTS[key].map(s => s.id);
  for (const id of Object.keys(ceSlots))
    if (!validIds.includes(id)) delete ceSlots[id];
  ceSelected = null;
  renderLayoutPicker();
  renderCanvas();
  updateInspector();
}

// ── Path bounding box (computed from path data, no DOM needed) ──
// Collects all explicit coordinate values from an SVG path string and returns
// the axis-aligned bounding box in the path's local 0-100 coordinate space.
// Ignores curve control-point bulge — acceptable approximation for bar endpoints.
function pathBBox(pathStr) {
  const xs = [], ys = [];
  const re = /([MLQCSTAHVmlqcstahv])\s*([\d\s,.\-]+)/g;
  let m;
  while ((m = re.exec(pathStr)) !== null) {
    const cmd  = m[1].toUpperCase();
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === 'H') { xs.push(...args); continue; }
    if (cmd === 'V') { ys.push(...args); continue; }
    for (let i = 0; i + 1 < args.length; i += 2) {
      xs.push(args[i]);
      ys.push(args[i + 1]);
    }
  }
  if (!xs.length || !ys.length)
    return { minX: 0, minY: 0, maxX: CE_VIEWBOX, maxY: CE_VIEWBOX };
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
  };
}

// ── Procedural bar endpoint ──
// Returns the inner endpoint (x2, y2) of a port bar in the radical's 100x100 space.
// Travels inward from the port edge until it reaches the nearest bbox face,
function barEndpoint(dir, pathStr) {
  const GAP = CE_STROKE * -0.5;
  const o   = PORT_ORIGINS[dir];
  const inv = PORT_INWARD[dir];

  const hit = getFlattenIntersection(pathStr, dir);
  let t;
  if (hit) {
    // Flatten.js Point objects have x and y properties
    const dx = hit.x - o.x;
    const dy = hit.y - o.y;
    t = Math.sqrt(dx * dx + dy * dy) - GAP;
  } else {
    console.warn('Using fallback stroke!');
    t = 45; // Default fallback if no stroke is in the path of the port
  }

  // Clamp: Min 5 units long, Max 45% inward
  t = Math.max(5, Math.min(t, 45));

  return { x2: o.x + inv.dx * t, y2: o.y + inv.dy * t };
}

function pathDataToSegments(pathStr) {
  const { Point, Segment } = Flatten;
  const segments = [];
  let currentPt = new Point(0, 0);
  let startPt = new Point(0, 0);

  // Simple regex to grab command and coordinates
  const re = /([ML])\s*(-?\d*\.?\d+)\s*[, ]\s*(-?\d*\.?\d+)/g;
  let m;

  while ((m = re.exec(pathStr)) !== null) {
    const cmd = m[1].toUpperCase();
    const x = parseFloat(m[2]);
    const y = parseFloat(m[3]);
    const nextPt = new Point(x, y);

    if (cmd === 'M') {
      startPt = nextPt;
    } else if (cmd === 'L') {
      segments.push(new Segment(currentPt, nextPt));
    }
    currentPt = nextPt;
  }

  console.log(segments);
  return segments;
}

/**
 * Uses Flatten.js to find the first intersection point 
 * between a port ray and the radical strokes.
 */
function getFlattenIntersection(pathData, dir) {
  if (typeof Flatten === 'undefined') {
    throw new Error("Flatten global is missing.");
    debugger;
  }

  // debugger;
  const { Polygon, Segment, Point } = Flatten;
  const segments = pathDataToSegments(pathData);
  if (segments.length === 0) return null;

  const radicalShape = new Polygon(segments);
  
  const origin = PORT_ORIGINS[dir];
  const inward = PORT_INWARD[dir];

  const p1 = new Point(origin.x, origin.y);
  const p2 = new Point(
    origin.x + inward.dx * 60, 
    origin.y + inward.dy * 60
  );
  const probe = new Segment(p1, p2);

  const intersections = radicalShape.intersect(probe);

  if (intersections.length === 0) {
    console.warn('intersections.length === 0 for shape: ',radicalShape);
    return null;
  }

  // 4. Find the intersection point closest to the port origin
  // (In case the probe passes through multiple strokes)
  let closestPoint = null;
  let minDistance = Infinity;

  intersections.forEach(pt => {
    const dist = p1.distanceTo(pt)[0];
    if (dist < minDistance) {
      minDistance = dist;
      closestPoint = pt;
    }
  });

  return closestPoint; 
}


// ── Layer transform string ──
// All transformations happen in the radical's local 100x100 space.
// The group is then translated and scaled into its slot position.
// vector-effect="non-scaling-stroke" on child elements keeps stroke-width constant.
function layerTransform(slot, layer) {
  const sx = slot.w / CE_VIEWBOX;
  const sy = slot.h / CE_VIEWBOX;

  // Local transforms applied in radical space (rotation, flips)
  const local = [];
  if (layer.rotation) local.push(`rotate(${layer.rotation},50,50)`);
  if (layer.flipH)    local.push(`translate(100,0) scale(-1,1)`);
  if (layer.flipV)    local.push(`translate(0,100) scale(1,-1)`);
  // Offset: translate in local 100x100 space so it's slot-size-independent
  const ox = (layer.offset && layer.offset.x) || 0;
  const oy = (layer.offset && layer.offset.y) || 0;
  if (ox || oy)       local.push(`translate(${ox},${oy})`);

  // Outermost: slot placement. Innermost: local transforms.
  const slotXf = `translate(${slot.x},${slot.y}) scale(${sx},${sy})`;
  return local.length ? `${slotXf} ${local.join(' ')}` : slotXf;
}

// ── Which ports are active for a layer? ──
function activePortsForLayer(layer, slot, radical) {
  const ports = new Set(layer.activeLinks || []);
  // Auto-connect from the radical's default bridge direction
  if (radical.bridge && radical.bridge.auto_connect && radical.bridge.direction) {
    const dir = radical.bridge.direction;
    if (!ports.has(dir)) {
      const neighbour = getNeighbourSlot(slot.id, dir);
      if (neighbour && (ceSlots[neighbour.id] || []).length > 0)
        ports.add(dir);
    }
  }
  return [...ports];
}

function getNeighbourSlot(slotId, direction) {
  const slots = LAYOUTS[ceLayout];
  const current = slots.find(s => s.id === slotId);
  if (!current) return null;
  return slots.find(s => {
    if (direction === 'E') return Math.abs(s.x - (current.x + current.w)) < 1 && s.y === current.y;
    if (direction === 'W') return Math.abs((s.x + s.w) - current.x) < 1 && s.y === current.y;
    if (direction === 'S') return Math.abs(s.y - (current.y + current.h)) < 1 && s.x === current.x;
    if (direction === 'N') return Math.abs((s.y + s.h) - current.y) < 1 && s.x === current.x;
    return false;
  }) || null;
}

// ── Canvas rendering ──
function renderCanvas() {
  const svg = document.getElementById('ceCanvasSvg');
  if (!svg) return;
  svg.innerHTML = '';

  LAYOUTS[ceLayout].forEach(slot => {
    const layers = ceSlots[slot.id] || [];
    const isSelected = ceSelected && ceSelected.slotId === slot.id;

    // Drop-zone rect (in global SVG space)
    const rect = mkSvg('rect', {
      x: slot.x + 0.5, y: slot.y + 0.5,
      width: slot.w - 1, height: slot.h - 1,
      rx: 2,
      fill:               layers.length === 0 ? 'rgba(160,82,45,0.04)' : 'none',
      stroke:             isSelected ? 'var(--accent)' : 'rgba(160,82,45,0.2)',
      'stroke-width':     isSelected ? 1.5 : 0.5,
      'stroke-dasharray': layers.length === 0 ? '3 2' : 'none',
      class:              'ce-slot-rect',
      'data-slot':        slot.id,
    });
    rect.addEventListener('click', () => ceSelectSlot(slot.id));
    rect.addEventListener('dragover', e => {
      e.preventDefault();
      rect.setAttribute('stroke', 'var(--accent)');
      rect.setAttribute('stroke-width', '2');
    });
    rect.addEventListener('dragleave', () => {
      rect.setAttribute('stroke', isSelected ? 'var(--accent)' : 'rgba(160,82,45,0.2)');
      rect.setAttribute('stroke-width', isSelected ? '1.5' : '0.5');
    });
    rect.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); ceDropOnSlot(slot.id);
    });
    svg.appendChild(rect);

    // Layer groups
    layers.forEach((layer, idx) => {
      if (!layer.visible) return;
      const radical = ceRadicals.find(r => r.id === layer.radicalId);
      if (!radical) return;

      const isActiveLayer = isSelected && ceSelected.layerIdx === idx;
      const g = mkSvg('g', { transform: layerTransform(slot, layer) });

      // Radical paths
      radical.path.split(/(?=M)/).filter(s => s.trim()).forEach(ps => {
        g.appendChild(mkSvg('path', {
          d: ps.trim(), 
          fill: FILL_ENABLED ? 'currentColor' : 'none', 
          stroke: STROKE_ENABLED ? 'currentColor' : 'none', 
          'stroke-width': CE_STROKE, 
          // 'stroke-linecap': 'round','stroke-linejoin': 'round', 
          'vector-effect': 'non-scaling-stroke',
          class: isActiveLayer ? 'ce-path-selected' : '',
        }));
      });

      // Port bars
      const ports = activePortsForLayer(layer, slot, radical);
      ports.forEach(dir => {
        const o   = PORT_ORIGINS[dir];
        const end = radical.portOffsets[dir];
        // Use hand-authored bridge path if provided for this direction
        if (radical.bridge && radical.bridge.direction === dir && radical.bridge.path) {
          g.appendChild(mkSvg('path', {
            d: radical.bridge.path, 
            fill: FILL_ENABLED ? 'currentColor' : 'none', 
            stroke: STROKE_ENABLED ? 'currentColor' : 'none', 
            'stroke-width': CE_STROKE, 
            // 'stroke-linecap': 'round',
            'vector-effect': 'non-scaling-stroke',
          }));
        } else {
          g.appendChild(mkSvg('line', {
            x1: o.x, y1: o.y, x2: end.x2, y2: end.y2,
            fill: FILL_ENABLED ? 'currentColor' : 'none', 
            stroke: STROKE_ENABLED ? 'currentColor' : 'none', 
            'stroke-width': CE_STROKE,
            // 'stroke-linecap': 'round', 
            'vector-effect': 'non-scaling-stroke',
            class: isActiveLayer ? 'ce-path-selected' : '',
          }));
        }
      });
      svg.appendChild(g);
      g.addEventListener('click', () => { ceSelectSlot(slot.id); ceSelectLayer(slot.id, idx)});
    });

    // Empty slot '+' hint
    if (layers.length === 0) {
      const t = mkSvg('text', {
        x: slot.x + slot.w / 2, y: slot.y + slot.h / 2,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        fill: 'rgba(160,82,45,0.25)', 'font-size': 8, 'pointer-events': 'none',
      });
      t.textContent = '+';
      svg.appendChild(t);
    }
  });

  updateExportPreview();
}

// ── SVG string for export / skeleton_svg cache ──
function buildSVGString(lineWidthMultiplier = 1) {
  const pathAttrs = `fill="${FILL_ENABLED ? 'currentColor' : 'none'}" stroke="${STROKE_ENABLED ? 'currentColor' : 'none'}" stroke-width="${CE_STROKE * lineWidthMultiplier}" vector-effect="non-scaling-stroke"`;
  const lineAttrs = `stroke="currentColor" stroke-width="${CE_STROKE * lineWidthMultiplier}" vector-effect="non-scaling-stroke"`;
  let inner = '';

  LAYOUTS[ceLayout].forEach(slot => {
    (ceSlots[slot.id] || []).forEach(layer => {
      if (!layer.visible) return;
      const radical = ceRadicals.find(r => r.id === layer.radicalId);
      if (!radical) return;

      const tf = layerTransform(slot, layer);
      let gContent = '';

      radical.path.split(/(?=M)/).filter(s => s.trim()).forEach(ps => {
        gContent += `<path d="${ps.trim()}" ${pathAttrs}/>`;
      });

      const bbox  = pathBBox(radical.path);
      const ports = activePortsForLayer(layer, slot, radical);
      ports.forEach(dir => {
        const o   = PORT_ORIGINS[dir];
        const end = barEndpoint(dir, bbox);
        if (radical.bridge && radical.bridge.direction === dir && radical.bridge.path) {
          gContent += `<path d="${radical.bridge.path}" ${pathAttrs}/>`;
        } else {
          gContent += `<line x1="${o.x}" y1="${o.y}" x2="${end.x2}" y2="${end.y2}" ${lineAttrs}/>`;
        }
      });

      inner += `<g transform="${tf}">${gContent}</g>`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
}

// ── Drag & drop ──
function ceLibDragStart(e, radicalId) {
  ceDragState = { radicalId };
  e.dataTransfer.setData('text/plain', radicalId);
  e.dataTransfer.effectAllowed = 'copy';
}

function ceDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function ceDrop(e) {
  e.preventDefault();
  const radicalId = e.dataTransfer.getData('text/plain') || (ceDragState && ceDragState.radicalId);
  if (!radicalId) return;
  const el   = document.getElementById('ceCanvasSvg');
  const bb   = el.getBoundingClientRect();
  const nx   = (e.clientX - bb.left) / bb.width  * CE_VIEWBOX;
  const ny   = (e.clientY - bb.top)  / bb.height * CE_VIEWBOX;
  const slot = LAYOUTS[ceLayout].find(s =>
    nx >= s.x && nx < s.x + s.w && ny >= s.y && ny < s.y + s.h);
  if (slot) ceAddToSlot(slot.id, radicalId);
  ceDragState = null;
}

function ceDropOnSlot(slotId) {
  if (ceDragState && ceDragState.radicalId) ceAddToSlot(slotId, ceDragState.radicalId);
  ceDragState = null;
}

// ── Tap-to-place ──
function ceLibTap(radicalId) {
  ceActiveRadical = ceActiveRadical === radicalId ? null : radicalId;
  if (ceActiveRadical) showToast('Tap a slot to place', '');
  renderLibrary();
}

function ceSelectSlot(slotId) {
  if (ceActiveRadical) {
    ceAddToSlot(slotId, ceActiveRadical);
    ceActiveRadical = null;
    renderLibrary();
    return;
  }
  const layers = ceSlots[slotId] || [];
  if (ceSelected && ceSelected.slotId === slotId) {
    // Cycle layer selection
    const next = ((ceSelected.layerIdx || 0) + 1) % Math.max(layers.length, 1);
    ceSelected = { slotId, layerIdx: next };
  } else {
    ceSelected = { slotId, layerIdx: layers.length - 1 };
  }
  renderCanvas();
  updateInspector();
}

// ── Layer management ──
function ceAddToSlot(slotId, radicalId) {
  if (!ceSlots[slotId]) ceSlots[slotId] = [];
  ceSlots[slotId].push({
    radicalId,
    visible: true,
    flipH: false,
    flipV: false,
    rotation: 0,
    offset: { x: 0, y: 0 },
    activeLinks: [],
    manualOverrides: {},
  });
  ceSelected = { slotId, layerIdx: ceSlots[slotId].length - 1 };
  renderCanvas();
  updateInspector();
}

function ceRemoveLayer(slotId, layerIdx) {
  ceSlots[slotId].splice(layerIdx, 1);
  if (ceSlots[slotId].length === 0) delete ceSlots[slotId];
  ceSelected = null;
  renderCanvas();
  updateInspector();
}

function ceMoveLayer(slotId, fromIdx, toIdx) {
  const layers = ceSlots[slotId];
  if (!layers) return;
  const [item] = layers.splice(fromIdx, 1);
  layers.splice(toIdx, 0, item);
  ceSelected = { slotId, layerIdx: toIdx };
  renderCanvas();
  updateInspector();
}

// Replace the radical in an existing layer, preserving all other properties.
function ceReplaceLayer(slotId, layerIdx, radicalId) {
  const layer = (ceSlots[slotId] || [])[layerIdx];
  if (!layer) return;
  layer.radicalId = radicalId;
  ceSelected = { slotId, layerIdx };
  renderCanvas();
  updateInspector();
}

// Update offset on the selected layer, clamped to ±50 local units.
function ceSetOffset(axis, value) {
  if (!ceSelected) return;
  const layer = (ceSlots[ceSelected.slotId] || [])[ceSelected.layerIdx];
  if (!layer) return;
  if (!layer.offset) layer.offset = { x: 0, y: 0 };
  layer.offset[axis] = Math.max(-50, Math.min(50, Number(value) || 0));
  renderCanvas();
  // Don't re-render the inspector (would lose input focus); just update the canvas.
}

function ceResetOffset() {
  if (!ceSelected) return;
  const layer = (ceSlots[ceSelected.slotId] || [])[ceSelected.layerIdx];
  if (!layer) return;
  layer.offset = { x: 0, y: 0 };
  renderCanvas();
  updateInspector();
}

// Drop a library radical onto an existing layer row — replaces the radical.
function ceDropOnLayer(slotId, layerIdx) {
  const radicalId = ceDragState && ceDragState.radicalId;
  if (!radicalId) return;
  ceReplaceLayer(slotId, layerIdx, radicalId);
  ceDragState = null;
}

// ── Inspector ──
function updateInspector() {
  const body = document.getElementById('ceInspectorBody');
  if (!body) return;
  if (!ceSelected) {
    body.innerHTML = '<div style="color:var(--ink-4);font-size:0.82rem">Select a slot to inspect layers.</div>';
    return;
  }
  const { slotId, layerIdx } = ceSelected;
  const layers = ceSlots[slotId] || [];
  const layer  = layers[layerIdx];
  const ox = layer ? ((layer.offset && layer.offset.x) || 0) : 0;
  const oy = layer ? ((layer.offset && layer.offset.y) || 0) : 0;

  body.innerHTML = `
    <div class="ce-inspector-slot">
      Slot: <strong>${slotId}</strong>&nbsp;
      Layer: <strong>${layerIdx + 1}/${layers.length}</strong>
    </div>
    <div class="ce-layer-list">
      ${layers.map((l, i) => {
        const r = ceRadicals.find(x => x.id === l.radicalId);
        return `
          <div class="ce-layer-row ${i === layerIdx ? 'active' : ''}"
               onclick="ceSelectLayer('${slotId}',${i})"
               ondragover="event.preventDefault();this.classList.add('ce-layer-drop-target')"
               ondragleave="this.classList.remove('ce-layer-drop-target')"
               ondrop="event.preventDefault();this.classList.remove('ce-layer-drop-target');ceDropOnLayer('${slotId}',${i})">
            <svg viewBox="0 0 100 100" style="width:24px;height:24px;flex-shrink:0;pointer-events:none">
              <path d="${r ? r.path : ''}" fill="none" stroke="currentColor"
                    stroke-width="12" stroke-linecap="round"/>
            </svg>
            <span style="flex:1;font-size:0.78rem;pointer-events:none">${r ? r.label : l.radicalId}</span>
            <button class="ce-icon-btn"
                    onclick="event.stopPropagation();ceToggleVisibility('${slotId}',${i})"
                    title="Toggle">${l.visible ? '👁' : '🚫'}</button>
            <button class="ce-icon-btn"
                    onclick="event.stopPropagation();ceRemoveLayer('${slotId}',${i})"
                    title="Delete">✕</button>
          </div>`;
      }).join('')}
    </div>
    ${layer ? `
    <div class="ce-transform-row">
      <button class="btn-sm" onclick="ceTransform('flipH')"    >⇔</button>
      <button class="btn-sm" onclick="ceTransform('flipV')"    >⇕</button>
      <button class="btn-sm" onclick="ceTransform('rotate270')">↺</button>
    </div>
    <div class="ce-section-head" style="margin-top:0.75rem">Offset</div>
    <div class="ce-offset-row">
      <label class="ce-offset-label">X</label>
      <input class="ce-offset-input" type="number" id="ce-offset-x"
             value="${ox}" min="-50" max="50" step="1"
             oninput="ceSetOffset('x', this.value)">
      <label class="ce-offset-label">Y</label>
      <input class="ce-offset-input" type="number" id="ce-offset-y"
             value="${oy}" min="-50" max="50" step="1"
             oninput="ceSetOffset('y', this.value)">
      <button class="ce-icon-btn" onclick="ceResetOffset()" title="Reset offset"
              style="margin-left:auto;opacity:${(ox||oy)?1:0.3}">↺</button>
    </div>
    <div class="ce-section-head" style="margin-top:0.75rem">Ports</div>
    <div class="ce-port-grid">
      <div></div>
      <button class="ce-port-btn ${(layer.activeLinks||[]).includes('N')?'active':''}"
              onclick="ceTogglePort('N')">▲</button>
      <div></div>
      <button class="ce-port-btn ${(layer.activeLinks||[]).includes('W')?'active':''}"
              onclick="ceTogglePort('W')">◀</button>
      <div class="ce-port-centre"></div>
      <button class="ce-port-btn ${(layer.activeLinks||[]).includes('E')?'active':''}"
              onclick="ceTogglePort('E')">▶</button>
      <div></div>
      <button class="ce-port-btn ${(layer.activeLinks||[]).includes('S')?'active':''}"
              onclick="ceTogglePort('S')">▼</button>
      <div></div>
    </div>` : ''}
  `;
}

function ceSelectLayer(slotId, layerIdx) {
  ceSelected = { slotId, layerIdx };
  renderCanvas();
  updateInspector();
}

function ceToggleVisibility(slotId, layerIdx) {
  const l = (ceSlots[slotId] || [])[layerIdx];
  if (l) { l.visible = !l.visible; renderCanvas(); updateInspector(); }
}

function ceTransform(op) {
  if (!ceSelected) return;
  const l = (ceSlots[ceSelected.slotId] || [])[ceSelected.layerIdx];
  if (!l) return;
  if      (op === 'flipH')     l.flipH    = !l.flipH;
  else if (op === 'flipV')     l.flipV    = !l.flipV;
  else if (op === 'rotate90')  l.rotation = ((l.rotation || 0) +  90) % 360;
  else if (op === 'rotate270') l.rotation = ((l.rotation || 0) + 270) % 360;
  renderCanvas();
  updateInspector();
}

function ceTogglePort(dir) {
  if (!ceSelected) return;
  const l = (ceSlots[ceSelected.slotId] || [])[ceSelected.layerIdx];
  if (!l) return;
  if (!l.activeLinks) l.activeLinks = [];
  const i = l.activeLinks.indexOf(dir);
  if (i >= 0) l.activeLinks.splice(i, 1); else l.activeLinks.push(dir);
  renderCanvas();
  updateInspector();
}

// ── Canvas actions ──
function ceClear() {
  if (!confirm('Clear all layers?')) return;
  ceSlots = {}; ceSelected = null;
  renderCanvas(); updateInspector();
}

function ceExportSVG() {
  navigator.clipboard.writeText(buildSVGString())
    .then(() => showToast('SVG copied to clipboard', 'success'));
}

function updateExportPreview() {
  const prev = document.getElementById('cePreviewSvg');
  if (!prev) return;

  const lineWidthMult = prev.scrollWidth / document.getElementById('ceCanvas').scrollWidth;
  const doc = new DOMParser().parseFromString(buildSVGString(lineWidthMult), 'image/svg+xml');
  const inner = doc.querySelector('svg');
  prev.innerHTML = inner ? inner.innerHTML : '';
}

// ── Save skeleton to dictionary entry ──
function ceSaveToEntry() {
  const sel     = document.getElementById('ceEntrySelect');
  const entryId = (sel && sel.value) || ceTargetEntryId;
  if (!entryId) { showToast('Choose a dictionary entry first', 'error'); return; }
  const entry = dictionary.entries.find(e => e.id === entryId);
  if (!entry)  { showToast('Entry not found', 'error'); return; }

  const skeleton = { layout: ceLayout, slots: deepClone(ceSlots) };

  const duplicate = dictionary.entries.find(e =>
    e.id !== entryId && e.skeleton &&
    JSON.stringify(e.skeleton) === JSON.stringify(skeleton));
  if (duplicate)
    showToast(`Warning: identical skeleton already on "${duplicate.gloss}"`, '');

  // Save skeleton and rendered SVG string
  entry.skeleton = skeleton;
  entry.skeleton_svg = buildSVGString();
  setDirty(true);
  showToast(`Skeleton saved to "${entry.gloss}"`, 'success');
}

// ── Glyph cache ──
function buildSkeletonCache() {
  for (const entry of dictionary.entries) {
    if (!entry.skeleton || entry.skeleton_svg) continue;
    const savedLayout = ceLayout, savedSlots = ceSlots;
    ceLayout = entry.skeleton.layout || 'quad';
    ceSlots  = entry.skeleton.slots  || {};
    entry.skeleton_svg = buildSVGString();
    ceLayout = savedLayout;
    ceSlots  = savedSlots;
  }
}

// ── Mobile drawer ──
function ceToggleDrawer() {
  const d = document.getElementById('ceDrawer');
  if (d) d.classList.toggle('open');
}

// ── Utilities ──
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Create an SVG element with a map of attributes
function mkSvg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ── Global exposure ──
window.initCharEditor      = initCharEditor;
window.openCharEditor      = openCharEditor;
window.buildSkeletonCache  = buildSkeletonCache;
window.populateEntrySelect = populateEntrySelect;
window.ceLibDragStart      = ceLibDragStart;
window.ceDragOver          = ceDragOver;
window.ceDrop              = ceDrop;
window.ceDropOnSlot        = ceDropOnSlot;
window.ceLibTap            = ceLibTap;
window.ceSelectSlot        = ceSelectSlot;
window.ceSelectLayer       = ceSelectLayer;
window.ceToggleVisibility  = ceToggleVisibility;
window.ceTransform         = ceTransform;
window.ceTogglePort        = ceTogglePort;
window.ceClear             = ceClear;
window.ceExportSVG         = ceExportSVG;
window.ceSaveToEntry       = ceSaveToEntry;
window.ceToggleDrawer      = ceToggleDrawer;
window.ceSetLayout         = ceSetLayout;
window.ceSetOffset         = ceSetOffset;
window.ceResetOffset       = ceResetOffset;
window.ceReplaceLayer      = ceReplaceLayer;
window.ceDropOnLayer       = ceDropOnLayer;
window.ceMoveLayer         = ceMoveLayer;