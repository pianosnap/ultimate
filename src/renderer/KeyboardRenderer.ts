import type { Application, Ticker } from 'pixi.js'
import { Container, Graphics, RenderTexture, Sprite, Texture, TilingSprite } from 'pixi.js'
import { isBlackKey, MIDI_MAX, MIDI_MIN } from '../core/midi/types'
import { keyRect } from './keyGeometry'
import { liveNoteColor, type Theme } from './theme'
import type { Viewport } from './viewport'

// The static keyboard base is split into two RenderTextures — a white-keys
// sprite and a black-keys sprite — with the active-key overlay sandwiched
// between them. This lets a pressed white key's color be naturally clipped
// by any black keys sitting on top: the overlay draws on top of the white
// sprite, and the black sprite renders on top of the overlay, covering the
// occluded portions for free via z-order. No masks, no polygon math.
//
// Z-order (bottom → top):
//   1. whiteSprite       — bg + whites + depth + ivory wash + noise
//   2. whiteActiveLayer  — per-frame: tinted overlay for pressed white keys
//   3. blackSprite       — blacks + bevels + rails
//   4. blackActiveLayer  — per-frame: tinted overlay for pressed black keys

// One 96×96 greyscale noise tile is enough — it tiles imperceptibly
// across 88 keys. Cached at module scope so theme rebuilds don't
// re-roll the RNG (would cause visible shimmer across theme cycles).
let ivoryNoiseCanvas: HTMLCanvasElement | null = null
function getIvoryNoiseCanvas(): HTMLCanvasElement {
  if (ivoryNoiseCanvas) return ivoryNoiseCanvas
  const size = 96
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    // Bias brightness high so the grain reads as "ivory", not "static".
    // Alpha is ~8% — subtle but visible on close look.
    const v = 200 + Math.random() * 55
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 20
  }
  ctx.putImageData(img, 0, 0)
  ivoryNoiseCanvas = c
  return c
}

export class KeyboardRenderer {
  readonly container: Container

  // Static baked layers
  private whiteSprite: Sprite | null = null
  private whiteTexture: RenderTexture | null = null
  private blackSprite: Sprite | null = null
  private blackTexture: RenderTexture | null = null

  // Per-frame active overlays — one per key colour (white vs black) so we
  // can insert the black sprite between them for automatic clipping.
  private whiteActiveLayer: Graphics
  private blackActiveLayer: Graphics

  // Persistent practice-mode hint layers. White-key hints sit below the baked
  // black-key sprite so black keys naturally occlude neighboring white halos;
  // black-key hints sit above the black sprite. This mirrors the active-key
  // z-stack and avoids masks.
  private whitePracticeHintLayer: Graphics
  private blackPracticeHintLayer: Graphics
  private practiceSignature = ''
  private practicePulsePhase = 0
  private practiceTickerHandler: ((ticker: Ticker) => void) | null = null
  private practicePending: ReadonlySet<number> | null = null
  private practiceAccepted: ReadonlySet<number> | null = null

  // Snapshot of the last-drawn pitch→color map as a single signature string.
  // If nothing changed we skip the clear + redraw entirely (common during
  // sustained chords and idle frames).
  private lastSignature = ''
  private activeLayerDirty = true
  // Internal LED glow intensity (0.0 to 2.5, default 1.0)
  private ledGlow = 1.0
  // Classic acoustic piano red felt strip
  private feltGraphics: Graphics
  // Key note labels (English notation)
  private showWhiteLabels = false
  private showBlackLabels = false
  private labelsSprite: Sprite | null = null
  private labelsTexture: RenderTexture | null = null
  private currentYOffset = 0
  // Signature of the last baked-texture inputs (size + key positions + theme
  // colors). Used to short-circuit build() when nothing that affects the
  // baked RenderTextures has actually changed — skips a texture destroy/
  // recreate that would otherwise stall the GPU on every theme re-apply.
  private lastBuildSignature = ''

  constructor(
    private app: Application,
    private theme: Theme,
  ) {
    this.container = new Container()
    this.container.label = 'keyboard'

    this.whiteActiveLayer = new Graphics()
    this.whiteActiveLayer.label = 'keyboard-active-white'
    this.blackActiveLayer = new Graphics()
    this.blackActiveLayer.label = 'keyboard-active-black'
    this.whitePracticeHintLayer = new Graphics()
    this.whitePracticeHintLayer.label = 'keyboard-practice-hint-white'
    this.blackPracticeHintLayer = new Graphics()
    this.blackPracticeHintLayer.label = 'keyboard-practice-hint-black'
    this.feltGraphics = new Graphics()
    this.feltGraphics.label = 'keyboard-red-felt'

    this.labelsSprite = new Sprite(Texture.EMPTY)
    this.labelsSprite.label = 'keyboard-note-labels'
    this.labelsSprite.visible = false

    // Order matters: white hints/active must sit above the white sprite but
    // below the black sprite. Black hints/active sit above the black sprite.
    // Note labels sit above active keys so they stay readable during play.
    // Red felt sits at the very top, running along the fallboard.
    this.container.addChild(this.whitePracticeHintLayer)
    this.container.addChild(this.whiteActiveLayer)
    this.container.addChild(this.blackPracticeHintLayer)
    this.container.addChild(this.blackActiveLayer)
    this.container.addChild(this.labelsSprite)
    this.container.addChild(this.feltGraphics)
  }

  setLedGlow(intensity: number): void {
    this.ledGlow = Math.max(0, intensity)
    this.activeLayerDirty = true
    if (this.viewport) this.drawPracticeHints()
  }

  setShowWhiteLabels(show: boolean): void {
    if (this.showWhiteLabels === show) return
    this.showWhiteLabels = show
    this.renderKeyLabels()
  }

  setShowBlackLabels(show: boolean): void {
    if (this.showBlackLabels === show) return
    this.showBlackLabels = show
    this.renderKeyLabels()
  }

  get isShowingWhiteLabels(): boolean {
    return this.showWhiteLabels
  }

  get isShowingBlackLabels(): boolean {
    return this.showBlackLabels
  }

  // Build or rebuild the static keyboard textures.
  // Call on init and whenever the canvas is resized.
  build(viewport: Viewport, yOffset: number): void {
    const { keyboardHeight, canvasWidth, pitchMin, pitchMax } = viewport.config
    const positions = viewport.getAllKeyPositions()
    this.viewport = viewport

    this.currentYOffset = yOffset

    // Skip the destroy+re-bake when every input to the bake is unchanged. All
    // the baked pixels depend on: canvas width, keyboard height, the pitch
    // range (which determines key positions), and the three theme colours
    // that tint the white/black keys and gap. Hitting this cache path turns
    // a theme re-apply or redundant rebuildStaticLayers() into a no-op.
    const sig =
      `${canvasWidth}x${keyboardHeight}|${pitchMin ?? 21}-${pitchMax ?? 108}|` +
      `${this.theme.whiteKey}.${this.theme.blackKey}.${this.theme.keyBorder}|y=${yOffset}`
    if (sig === this.lastBuildSignature && this.whiteSprite && this.blackSprite) {
      this.renderKeyLabels()
      return
    }
    this.lastBuildSignature = sig

    // Destroy previous textures/sprites to avoid memory leaks. destroy()
    // also removes the sprite from its parent container.
    this.whiteTexture?.destroy()
    this.whiteSprite?.destroy()
    this.blackTexture?.destroy()
    this.blackSprite?.destroy()

    // ─── White bake ──────────────────────────────────────────────────
    // bg + white keys + 3D depth cues + ivory wash + ivory grain noise.
    const whiteBake = new Container()

    // Background fill (shows through the seams between keys)
    const bg = new Graphics()
    bg.rect(0, 0, canvasWidth, keyboardHeight).fill({ color: 0x08080e })
    whiteBake.addChild(bg)

    // White keys: body + 3D side bevels + front face lip + lighting depth
    const whiteLayer = new Graphics()

    // Pass 1: Cast drop shadows from raised black keys onto the white keys below
    for (let p = MIDI_MIN; p <= MIDI_MAX; p++) {
      if (!isBlackKey(p)) continue
      const pos = positions.get(p)
      if (!pos) continue
      const { x, y, w, h } = keyRect(p, pos, keyboardHeight)
      // Left cast shadow
      whiteLayer.rect(x - 3, y + 4, 3, h - 2).fill({ color: 0x000000, alpha: 0.28 })
      // Right cast shadow (longer for top-left lighting angle)
      whiteLayer.rect(x + w, y + 4, 4.5, h + 3).fill({ color: 0x000000, alpha: 0.38 })
      // Bottom drop shadow
      whiteLayer.roundRect(x - 1.5, y + h, w + 3.5, 6, 2).fill({ color: 0x000000, alpha: 0.44 })
    }

    // Pass 2: White key 3D bodies
    for (let p = MIDI_MIN; p <= MIDI_MAX; p++) {
      if (isBlackKey(p)) continue
      const pos = positions.get(p)
      if (!pos) continue
      const { x, y, w, h, radius: wRadius } = keyRect(p, pos, keyboardHeight)

      // Solid body with ivory warmth
      whiteLayer.roundRect(x, y, w, h, wRadius).fill({ color: this.theme.whiteKey })
      whiteLayer.roundRect(x, y, w, h, wRadius).fill({ color: 0xfff3df, alpha: 0.08 })

      // Red felt strip shadow at top of key
      whiteLayer.rect(x, y, w, 6).fill({ color: 0x000000, alpha: 0.35 })

      // ─── 3D Convex Body Shading ───
      // Left vertical specular ridge & soft bevel slope (light from top-left)
      whiteLayer.rect(x, y + 6, 1.5, h - 20).fill({ color: 0xffffff, alpha: 0.44 })
      whiteLayer.rect(x + 1.5, y + 6, 2.5, h - 20).fill({ color: 0xffffff, alpha: 0.18 })
      // Right vertical shadow bevel & soft slope
      whiteLayer.rect(x + w - 1.5, y + 6, 1.5, h - 20).fill({ color: 0x000000, alpha: 0.32 })
      whiteLayer.rect(x + w - 4, y + 6, 2.5, h - 20).fill({ color: 0x000000, alpha: 0.15 })

      // ─── 3D Front Face (Key Lip) ───
      // Specular horizontal ridge where the top surface meets the vertical front lip
      whiteLayer.rect(x + 1, y + h - 14, w - 2, 1.5).fill({ color: 0xffffff, alpha: 0.55 })
      // Vertical front face in slight shadow (ambient occlusion under top lip)
      whiteLayer.rect(x + 1, y + h - 12.5, w - 2, 10.5).fill({ color: 0x000000, alpha: 0.18 })
      // Front face left corner highlight
      whiteLayer.rect(x + 1, y + h - 12.5, 1.2, 10.5).fill({ color: 0xffffff, alpha: 0.28 })
      // Front face right corner shadow
      whiteLayer.rect(x + w - 2.2, y + h - 12.5, 1.2, 10.5).fill({ color: 0x000000, alpha: 0.34 })
      // Deep contact shadow at the very bottom edge touching the keybed
      whiteLayer
        .rect(x + wRadius, y + h - 2.5, w - wRadius * 2, 2.5)
        .fill({ color: 0x000000, alpha: 0.52 })
    }
    whiteBake.addChild(whiteLayer)

    // Ivory grain — tiled from a 96×96 noise canvas.
    const noiseTex = Texture.from(getIvoryNoiseCanvas())
    const noise = new TilingSprite({
      texture: noiseTex,
      width: canvasWidth,
      height: keyboardHeight,
    })
    whiteBake.addChild(noise)

    this.whiteTexture = RenderTexture.create({ width: canvasWidth, height: keyboardHeight })
    this.app.renderer.render({ container: whiteBake, target: this.whiteTexture })
    whiteBake.destroy({ children: true })
    noiseTex.destroy(true)

    // ─── Black bake ──────────────────────────────────────────────────
    // Raised 3D black keys + satin ebony sheen + sloped shoulders + front chamfer
    const blackBake = new Container()
    const blackLayer = new Graphics()
    for (let p = MIDI_MIN; p <= MIDI_MAX; p++) {
      if (!isBlackKey(p)) continue
      const pos = positions.get(p)
      if (!pos) continue
      const { x, y, w, h, radius: bRadius } = keyRect(p, pos, keyboardHeight)

      // Solid body
      blackLayer.roundRect(x, y, w, h, bRadius).fill({ color: this.theme.blackKey })

      // Top red felt shadow
      blackLayer.rect(x, y, w, 6).fill({ color: 0x000000, alpha: 0.42 })

      const railY = y + 6
      const railH = h - 21

      // ─── 3D Raised Black Key Shading ───
      // Left specular shoulder (top-left lighting)
      blackLayer.rect(x, railY, 1.5, railH).fill({ color: 0xffffff, alpha: 0.52 })
      blackLayer.rect(x + 1.5, railY, 2, railH).fill({ color: 0xffffff, alpha: 0.22 })
      // Right deep shadow shoulder
      blackLayer.rect(x + w - 2, railY, 2, railH).fill({ color: 0x000000, alpha: 0.65 })
      blackLayer.rect(x + w - 4, railY, 2, railH).fill({ color: 0x000000, alpha: 0.32 })
      // Top satin ebony crown sheen
      blackLayer
        .rect(x + 3.5, railY, Math.max(1, w - 7), railH)
        .fill({ color: 0xffffff, alpha: 0.08 })

      // ─── 3D Front Sloped Face (~60° angle) ───
      // Specular ridge across the top of the slope
      blackLayer.rect(x + 1.5, y + h - 15, w - 3, 1.5).fill({ color: 0xffffff, alpha: 0.62 })
      // Front sloped face highlight
      blackLayer.rect(x + 1, y + h - 13.5, w - 2, 11).fill({ color: 0xffffff, alpha: 0.16 })
      // Front face left specular edge
      blackLayer.rect(x, y + h - 13.5, 1, 11).fill({ color: 0xffffff, alpha: 0.42 })
      // Front face right deep shadow edge
      blackLayer.rect(x + w - 1, y + h - 13.5, 1, 11).fill({ color: 0x000000, alpha: 0.72 })
      // Bottom lip contact edge
      blackLayer
        .rect(x + bRadius, y + h - 2.5, w - bRadius * 2, 2)
        .fill({ color: 0x000000, alpha: 0.75 })
    }
    blackBake.addChild(blackLayer)

    this.blackTexture = RenderTexture.create({ width: canvasWidth, height: keyboardHeight })
    this.app.renderer.render({ container: blackBake, target: this.blackTexture })
    blackBake.destroy({ children: true })

    // ─── Classic Piano Red Felt Strip (Feltro rosso) ─────────────────
    // Sits at the top of the keys right where the fallboard meets the keyboard
    this.feltGraphics.clear()
    const feltH = 7.5
    // Top shadow groove under fallboard
    this.feltGraphics.rect(0, 0, canvasWidth, 1.5).fill({ color: 0x160103, alpha: 0.98 })
    // Rich crimson red felt body
    this.feltGraphics.rect(0, 1.5, canvasWidth, feltH - 1.5).fill({ color: 0xb41628, alpha: 1.0 })
    // Velvet weave texture highlights
    this.feltGraphics.rect(0, 2.5, canvasWidth, 1.5).fill({ color: 0xeb283e, alpha: 0.85 })
    this.feltGraphics.rect(0, 4, canvasWidth, 2).fill({ color: 0xd11c30, alpha: 0.7 })
    this.feltGraphics.rect(0, 6, canvasWidth, 1.5).fill({ color: 0x7e0d1c, alpha: 0.6 })
    // Bottom edge definition line
    this.feltGraphics.rect(0, feltH, canvasWidth, 1).fill({ color: 0x46050e, alpha: 0.9 })
    // Soft shadow casting over keys
    this.feltGraphics.rect(0, feltH + 1, canvasWidth, 2.5).fill({ color: 0x000000, alpha: 0.48 })
    this.feltGraphics.rect(0, feltH + 3.5, canvasWidth, 2).fill({ color: 0x000000, alpha: 0.22 })
    this.feltGraphics.y = yOffset

    // ─── Assemble the z-stack ────────────────────────────────────────
    // Reinsert sprites at correct indices:
    // whiteSprite, whitePracticeHintLayer, whiteActiveLayer,
    // blackSprite, blackPracticeHintLayer, blackActiveLayer, labelsSprite, feltGraphics
    this.whiteSprite = new Sprite(this.whiteTexture)
    this.whiteSprite.y = yOffset
    this.container.addChildAt(this.whiteSprite, 0)

    this.blackSprite = new Sprite(this.blackTexture)
    this.blackSprite.y = yOffset
    // Insert blackSprite between the white overlays and black overlays.
    this.container.addChildAt(this.blackSprite, 3)

    this.whitePracticeHintLayer.y = yOffset
    this.whiteActiveLayer.y = yOffset
    this.blackPracticeHintLayer.y = yOffset
    this.blackActiveLayer.y = yOffset
    if (this.labelsSprite) this.labelsSprite.y = yOffset
    // Force a redraw of the hint layer on the next setPracticeHints call
    this.practiceSignature = ''

    this.renderKeyLabels()
  }

  // Draw note letters (English notation: C, D, E, F, G, A, B on white keys,
  // C♯, D♯, F♯, G♯, A♯ on black keys) on top of the keyboard.
  private renderKeyLabels(): void {
    if (!this.viewport || !this.labelsSprite) return
    const { keyboardHeight, canvasWidth } = this.viewport.config
    if (!this.showWhiteLabels && !this.showBlackLabels) {
      this.labelsSprite.visible = false
      return
    }

    const positions = this.viewport.getAllKeyPositions()
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(canvasWidth * dpr)
    canvas.height = Math.round(keyboardHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)

    const WHITE_NOTE_NAMES: Record<number, string> = {
      0: 'C',
      2: 'D',
      4: 'E',
      5: 'F',
      7: 'G',
      9: 'A',
      11: 'B',
    }
    const BLACK_NOTE_NAMES: Record<number, string> = {
      1: 'C♯',
      3: 'D♯',
      6: 'F♯',
      8: 'G♯',
      10: 'A♯',
    }

    // Render White Key Labels
    if (this.showWhiteLabels) {
      for (let p = MIDI_MIN; p <= MIDI_MAX; p++) {
        if (isBlackKey(p)) continue
        const pos = positions.get(p)
        if (!pos) continue
        const { x, y, w, h } = keyRect(p, pos, keyboardHeight)
        const name = WHITE_NOTE_NAMES[p % 12]
        if (!name) continue

        const fontSize = Math.max(9, Math.min(13, Math.round(w * 0.44)))
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        const cx = x + w / 2
        const cy = y + h - 16

        // Subtle ambient highlight underneath the letter
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.fillText(name, cx, cy + 0.8)

        // Dark charcoal ink
        ctx.fillStyle = '#22232f'
        ctx.fillText(name, cx, cy)
      }
    }

    // Render Black Key Labels
    if (this.showBlackLabels) {
      for (let p = MIDI_MIN; p <= MIDI_MAX; p++) {
        if (!isBlackKey(p)) continue
        const pos = positions.get(p)
        if (!pos) continue
        const { x, y, w, h } = keyRect(p, pos, keyboardHeight)
        const name = BLACK_NOTE_NAMES[p % 12]
        if (!name) continue

        const fontSize = Math.max(8, Math.min(11, Math.round(w * 0.46)))
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        const cx = x + w / 2
        const cy = y + h - 11

        // Black outline for crisp contrast
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)'
        ctx.lineWidth = 2.2
        ctx.strokeText(name, cx, cy)

        // Crisp white text
        ctx.fillStyle = '#ffffff'
        ctx.fillText(name, cx, cy)
      }
    }

    if (this.labelsTexture) {
      this.labelsTexture.destroy(true)
    }
    this.labelsTexture = Texture.from(canvas) as unknown as RenderTexture
    this.labelsSprite.texture = this.labelsTexture
    this.labelsSprite.width = canvasWidth
    this.labelsSprite.height = keyboardHeight
    this.labelsSprite.y = this.currentYOffset
    this.labelsSprite.visible = true
  }

  // Called every frame — draws only the keys that are currently pressed.
  // Uses internal LED illumination (core brightness + lightguide, not external blur).
  drawActiveKeys(activeByPitch: Map<number, number>, viewport: Viewport): void {
    const sig = `${this.signatureFor(activeByPitch)}|led=${this.ledGlow}`
    if (!this.activeLayerDirty && sig === this.lastSignature) return
    this.activeLayerDirty = false
    this.lastSignature = sig
    this.whiteActiveLayer.clear()
    this.blackActiveLayer.clear()

    const { keyboardHeight } = viewport.config
    const positions = viewport.getAllKeyPositions()
    const fallback = liveNoteColor(this.theme)
    const led = this.ledGlow

    for (const [pitch, color] of activeByPitch) {
      const pos = positions.get(pitch)
      if (!pos) continue
      const tint = color || fallback
      const isBlack = isBlackKey(pitch)
      const layer = isBlack ? this.blackActiveLayer : this.whiteActiveLayer
      const { x, y, w, h, radius } = keyRect(pitch, pos, keyboardHeight)

      // ── Internal LED Illumination ──
      // 1. Subtle translucent edge scatter (tight 1px, not blurry 10px outer halo)
      if (led > 0.1) {
        layer.roundRect(x - 1, y - 1, w + 2, h + 2, radius + 1)
        layer.fill({ color: tint, alpha: 0.18 * Math.min(led, 2.0) })
      }

      // 2. Base illuminated acrylic key body
      layer.roundRect(x, y, w, h, radius)
      layer.fill({
        color: tint,
        alpha: Math.min(1.0, (isBlack ? 0.9 : 0.78) + 0.18 * Math.min(led, 2.0)),
      })

      // 3. Inner LED Lightguide Core (illuminated from the inside)
      if (led > 0.05) {
        const coreW = Math.max(3, Math.round(w * 0.58))
        const coreX = x + Math.round((w - coreW) / 2)
        const coreY = y + 5
        const coreH = Math.max(4, h - (isBlack ? 9 : 14))

        // Inner glowing core
        layer.roundRect(coreX, coreY, coreW, coreH, 2)
        layer.fill({ color: 0xffffff, alpha: 0.3 * Math.min(led, 2.0) })
        layer.roundRect(coreX, coreY, coreW, coreH, 2)
        layer.fill({ color: tint, alpha: 0.45 * Math.min(led, 2.0) })

        // 4. Center high-intensity LED diode filament
        const beamW = Math.max(1, Math.min(2, Math.round(w * 0.18)))
        const beamX = x + Math.round((w - beamW) / 2)
        layer.rect(beamX, coreY + 3, beamW, Math.max(2, coreH - 6))
        layer.fill({ color: 0xffffff, alpha: 0.65 * Math.min(led, 2.0) })

        // 5. Specular LED inner rim reflection
        layer
          .rect(x + 2, y + 2, w - 4, 1.5)
          .fill({ color: 0xffffff, alpha: 0.55 * Math.min(led, 2.0) })
        layer
          .rect(x + 2, y + h - (isBlack ? 5 : 13), w - 4, 1.5)
          .fill({ color: 0xffffff, alpha: 0.4 * Math.min(led, 2.0) })
      }
    }
  }

  updateTheme(theme: Theme): void {
    this.theme = theme
    // Colors baked into the active-key fill changed — force a redraw.
    this.activeLayerDirty = true
    // Practice hint colours follow the active theme accent.
    this.practiceSignature = ''
  }

  // Public hook for the parent renderer to swap in the current practice-mode
  // hint. Pass `null` to clear. The pulse animation runs on a private ticker so
  // the hint breathes even on frames where the main render loop is idle (file
  // playback paused, no live notes pending).
  setPracticeHints(
    pending: ReadonlySet<number> | null,
    accepted: ReadonlySet<number> | null,
  ): void {
    this.practicePending = pending
    this.practiceAccepted = accepted
    const sig = this.hintSignature(pending, accepted)
    if (sig !== this.practiceSignature) {
      this.practiceSignature = sig
      this.drawPracticeHints()
    }

    const wantTicker = !!pending && pending.size > 0
    if (wantTicker && !this.practiceTickerHandler) {
      this.practiceTickerHandler = (ticker) => {
        // ticker.deltaTime is Pixi units (~1 per 16.6ms). Scale to a slow
        // pulse — about one full breath every 1.4 seconds.
        this.practicePulsePhase += ticker.deltaTime * 0.075
        this.drawPracticeHints()
      }
      this.app.ticker.add(this.practiceTickerHandler)
    } else if (!wantTicker && this.practiceTickerHandler) {
      this.app.ticker.remove(this.practiceTickerHandler)
      this.practiceTickerHandler = null
      this.practicePulsePhase = 0
      this.drawPracticeHints()
    }
  }

  private drawPracticeHints(): void {
    this.whitePracticeHintLayer.clear()
    this.blackPracticeHintLayer.clear()
    const pending = this.practicePending
    const accepted = this.practiceAccepted
    if ((!pending || pending.size === 0) && (!accepted || accepted.size === 0)) return
    const viewport = this.viewport
    if (!viewport) return
    const yOffset = this.whiteSprite?.y ?? 0
    const kbHeight = viewport.config.keyboardHeight
    if (kbHeight === 0) return

    // Pulse: 0..1 sine, normalised so even when the user has played part of
    // the chord the remaining keys keep a strong baseline glow.
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.practicePulsePhase))

    const positions = viewport.getAllKeyPositions()

    this.whitePracticeHintLayer.y = yOffset
    this.blackPracticeHintLayer.y = yOffset
    const tint = this.theme.accent
    const acceptedTint = 0x9ee7b8

    if (accepted) {
      for (const pitch of accepted) {
        const pos = positions.get(pitch)
        if (!pos) continue
        const layer = isBlackKey(pitch) ? this.blackPracticeHintLayer : this.whitePracticeHintLayer
        this.drawPracticeKey(layer, pitch, pos, kbHeight, acceptedTint, {
          bodyAlpha: isBlackKey(pitch) ? 0.36 : 0.25,
          stripAlpha: 0.58,
          haloScale: 0.55,
        })
      }
    }

    if (!pending) return
    for (const pitch of pending) {
      const pos = positions.get(pitch)
      if (!pos) continue
      const isBlack = isBlackKey(pitch)
      const layer = isBlack ? this.blackPracticeHintLayer : this.whitePracticeHintLayer
      this.drawPracticeKey(layer, pitch, pos, kbHeight, tint, {
        bodyAlpha: (isBlack ? 0.32 : 0.22) * pulse,
        stripAlpha: 0.55 * pulse,
        haloScale: pulse,
      })
    }
  }

  private drawPracticeKey(
    layer: Graphics,
    pitch: number,
    pos: { x: number; width: number },
    keyboardHeight: number,
    tint: number,
    opts: { bodyAlpha: number; stripAlpha: number; haloScale: number },
  ): void {
    const { x, y, w, h, radius } = keyRect(pitch, pos, keyboardHeight)

    const halos: readonly [number, number][] = [
      [12, 0.05 * opts.haloScale],
      [7, 0.1 * opts.haloScale],
      [3, 0.18 * opts.haloScale],
    ]
    for (const [expand, alpha] of halos) {
      layer.roundRect(x - expand, y - expand, w + expand * 2, h + expand * 2, radius + expand)
      layer.fill({ color: tint, alpha })
    }

    layer.roundRect(x, y, w, h, radius)
    layer.fill({ color: tint, alpha: opts.bodyAlpha })

    layer.rect(x + radius, y, w - radius * 2, 2)
    layer.fill({ color: tint, alpha: opts.stripAlpha })
  }

  private hintSignature(
    pending: ReadonlySet<number> | null,
    accepted: ReadonlySet<number> | null,
  ): string {
    const p = pending ? Array.from(pending).sort().join('.') : ''
    const a = accepted ? Array.from(accepted).sort().join('.') : ''
    return `${p}|${a}`
  }

  // Viewport of the current bake; practice hints read key layout from it.
  private viewport: Viewport | null = null

  // Cheap change-detection: concatenate sorted pitch:color pairs. The map is
  // small (≤ ~10 active pitches at once) so this is essentially free and
  // catches both pitch-change and color-change in one check.
  private signatureFor(activeByPitch: Map<number, number>): string {
    if (activeByPitch.size === 0) return ''
    const parts: string[] = []
    for (const [pitch, color] of activeByPitch) parts.push(`${pitch}:${color}`)
    parts.sort()
    return parts.join(',')
  }
}
