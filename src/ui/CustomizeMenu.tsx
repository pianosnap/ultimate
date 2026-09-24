import { createSignal, For, Show } from 'solid-js'
import { render } from 'solid-js/web'
import type { MidiTrack } from '../core/midi/types'
import { LOCALES, type LocaleCode, locale, t } from '../i18n'
import type { ParticleStyle, ParticleStyleInfo } from '../renderer/particleStyles'
import { accentCSS, getTrackColor, hexToCSS, type Theme } from '../renderer/theme'
import { trackEvent } from '../telemetry'
import { icons } from './icons'
import { FEEDBACK_URL, isNarrowViewport } from './utils'

// Aesthetics popover — collapses theme, particles, background, keys width,
// and chord overlay into one trigger.

export interface CustomizeMenuCallbacks {
  onSelectTheme: (index: number) => void
  onSelectParticle: (index: number) => void
  onToggleChord: () => void
  onToggleNoteLabels: () => void
  onSelectLocale: (code: LocaleCode) => void
  onSetLedGlow?: (intensity: number) => void
  onSetCustomBgColor?: (color: string | null) => void
  onSetCustomBgImage?: (dataUrl: string | null) => void
  onToggleWhiteKeyLabels?: () => void
  onToggleBlackKeyLabels?: () => void
  onSetKeyRangePreset?: (preset: string) => void
  onSetVisibleKeysCount?: (count: number) => void
  onTrackColorChange?: (trackId: string, color: number) => void
}

interface TriggerProps {
  label: () => string
  accent: () => string
  isOpen: () => boolean
  onToggle: () => void
  registerEl: (el: HTMLButtonElement) => void
}

function TriggerView(props: TriggerProps) {
  return (
    <button
      ref={(el) => props.registerEl(el)}
      class="ts-pill ts-pill--customize"
      classList={{ 'ts-pill--open': props.isOpen() }}
      id="ts-customize"
      type="button"
      aria-label={t('customize.aria')}
      aria-haspopup="dialog"
      aria-expanded={props.isOpen()}
      aria-controls="ts-appearance-panel"
      data-tip={t('customize.aria')}
      onClick={() => props.onToggle()}
    >
      <span
        class="ts-customize-icon"
        id="ts-customize-icon"
        aria-hidden="true"
        style={{ color: props.accent() }}
        innerHTML={icons.palette(16)}
      />
      <span class="ts-customize-label" id="ts-customize-label">
        {props.label()}
      </span>
      <svg
        class="ts-customize-chev"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

interface MenuProps {
  themes: readonly Theme[]
  particles: readonly ParticleStyleInfo[]
  themeIndex: () => number
  particleIndex: () => number
  chordOn: () => boolean
  noteLabelsOn: () => boolean
  ledGlow: () => number
  customBgColor: () => string | null
  customBgImage: () => string | null
  whiteKeyLabelsOn: () => boolean
  blackKeyLabelsOn: () => boolean
  keyRangePreset: () => string
  visibleKeysCount: () => number
  tracks: () => readonly MidiTrack[]
  isOpen: () => boolean
  isSheet: () => boolean
  onSelectTheme: (i: number) => void
  onSelectParticle: (i: number) => void
  onToggleChord: () => void
  onToggleNoteLabels: () => void
  onSelectLocale: (code: LocaleCode) => void
  onSetLedGlow?: (val: number) => void
  onSetCustomBgColor?: (color: string | null) => void
  onSetCustomBgImage?: (dataUrl: string | null) => void
  onToggleWhiteKeyLabels?: () => void
  onToggleBlackKeyLabels?: () => void
  onSetKeyRangePreset?: (preset: string) => void
  onSetVisibleKeysCount?: (count: number) => void
  onTrackColorChange?: (trackId: string, color: number) => void
  onClose: () => void
  registerEl: (el: HTMLElement) => void
}

const TOTAL_BG_PALETTE = [
  // 1. Toni Notturni & Scuri
  { hex: '#000000', name: 'Nero Assoluto' },
  { hex: '#050510', name: 'Mezzanotte' },
  { hex: '#09090f', name: 'Notte Fondente' },
  { hex: '#0c0e14', name: 'Grafite' },
  { hex: '#060f1e', name: 'Blu Notte' },
  { hex: '#03171f', name: 'Abisso' },
  { hex: '#041d14', name: 'Smeraldo Scuro' },
  { hex: '#190a24', name: 'Viola Notturno' },
  { hex: '#1c050f', name: 'Bordeaux Scuro' },
  // 2. Toni Ardesia & Desaturati
  { hex: '#18181b', name: 'Zinco Scuro' },
  { hex: '#1e293b', name: 'Ardesia' },
  { hex: '#172554', name: 'Cobalto' },
  { hex: '#1e1b4b', name: 'Indaco Scuro' },
  { hex: '#2e1065', name: 'Ametista Profonda' },
  { hex: '#3b0724', name: 'Prugna Scuro' },
  { hex: '#022c22', name: 'Verde Pino' },
  { hex: '#083344', name: 'Petrolio Notturno' },
  { hex: '#1c1917', name: 'Pietra Calda' },
  // 3. Toni Ricchi & Vibranti
  { hex: '#dc2626', name: 'Rosso Carminio' },
  { hex: '#ea580c', name: 'Arancio Tramonto' },
  { hex: '#d97706', name: 'Ambra Calda' },
  { hex: '#16a34a', name: 'Verde Bosco' },
  { hex: '#0891b2', name: 'Ciano Intenso' },
  { hex: '#2563eb', name: 'Blu Reale' },
  { hex: '#4f46e5', name: 'Indaco Elettrico' },
  { hex: '#7c3aed', name: 'Viola Vivace' },
  { hex: '#db2777', name: 'Magenta Brillante' },
  // 4. Toni Pastello & Chiaroscuri
  { hex: '#334155', name: 'Ardesia Media' },
  { hex: '#475569', name: 'Grigio Tempesta' },
  { hex: '#64748b', name: 'Peltro' },
  { hex: '#94a3b8', name: 'Nebbia' },
  { hex: '#cbd5e1', name: 'Perla' },
  { hex: '#e2e8f0', name: 'Platino Chiaro' },
  { hex: '#f8fafc', name: 'Ghiaccio Candido' },
  { hex: '#fef3c7', name: 'Avorio Caldo' },
  { hex: '#ffffff', name: 'Bianco Assoluto' },
]

function MenuView(props: MenuProps) {
  return (
    <div
      ref={(el) => props.registerEl(el)}
      id="ts-appearance-panel"
      role="dialog"
      aria-labelledby="ts-appearance-title"
      aria-hidden={!props.isOpen()}
      inert={!props.isOpen()}
      class="ts-popover ts-customize-menu"
      classList={{
        'ts-popover--open': props.isOpen(),
        'popover--sheet': props.isSheet(),
      }}
    >
      <div class="panel-header">
        <span class="panel-label" id="ts-appearance-title">
          {t('customize.title')}
        </span>
        <button
          class="panel-close-btn"
          type="button"
          aria-label={t('midiPicker.close')}
          onClick={() => props.onClose()}
          innerHTML={icons.close(14)}
        />
      </div>

      <div class="ts-customize-body">
        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">{t('customize.theme')}</span>
            <span class="customize-section-value">{props.themes[props.themeIndex()]?.name}</span>
          </div>
          <div class="customize-theme-grid">
            <For each={props.themes}>
              {(theme, index) => {
                const isNew = theme.id === 'opal' || theme.id === 'liquid-glass'
                return (
                  <button
                    class="customize-theme-tile"
                    classList={{
                      'customize-theme-tile--on': props.themeIndex() === index(),
                      'customize-theme-tile--material': !!theme.noteMaterial,
                      'customize-theme-tile--new': isNew,
                    }}
                    style={{ '--theme-accent': accentCSS(theme) }}
                    data-material={theme.noteMaterial}
                    type="button"
                    title={theme.name}
                    aria-label={`${theme.name} theme`}
                    aria-describedby={isNew ? `new-theme-${theme.id}` : undefined}
                    aria-pressed={props.themeIndex() === index()}
                    onClick={() => props.onSelectTheme(index())}
                  >
                    <span
                      class="customize-theme-tile-dot"
                      aria-hidden="true"
                      style={{ background: theme.preview ?? accentCSS(theme) }}
                    />
                    <span class="customize-theme-tile-label">{theme.name}</span>
                    {isNew && (
                      <span class="customize-theme-new" id={`new-theme-${theme.id}`}>
                        {t('customize.new')}
                      </span>
                    )}
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">{t('customize.particles')}</span>
            <span class="customize-section-value">
              {props.particles[props.particleIndex()]?.name}
            </span>
          </div>
          <div class="customize-particle-row">
            <For each={props.particles}>
              {(p, i) => (
                <button
                  class="customize-particle-chip"
                  classList={{ 'customize-particle-chip--on': props.particleIndex() === i() }}
                  type="button"
                  title={p.name}
                  aria-label={`${p.name} particles`}
                  aria-pressed={props.particleIndex() === i()}
                  onClick={() => props.onSelectParticle(i())}
                >
                  <span
                    class="customize-particle-chip-glyph"
                    data-style={p.id}
                    aria-hidden="true"
                    innerHTML={PARTICLE_GLYPHS[p.id] ?? PARTICLE_GLYPHS['sparks'] ?? ''}
                  />
                  <span class="customize-particle-chip-label">{p.name}</span>
                  <span
                    class="customize-particle-check"
                    aria-hidden="true"
                    innerHTML={icons.check(11)}
                  />
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">
              <span style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px' }}>
                <span innerHTML={icons.sparkles(14)} />
                {t('customize.ledGlow') || 'Luminosità Glow'}
              </span>
            </span>
            <span class="customize-section-value">{Math.round((props.ledGlow() ?? 1) * 100)}%</span>
          </div>
          <div class="customize-slider-wrap">
            <input
              type="range"
              min="0"
              max="2.0"
              step="0.05"
              class="mini-slider led-glow-slider"
              value={props.ledGlow() ?? 1}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value)
                props.onSetLedGlow?.(val)
              }}
            />
            <div class="customize-slider-hint">
              <span>0% (Disattivato)</span>
              <span>200% (Massimo)</span>
            </div>
          </div>
        </div>

        {/* ─── Sfondo Personalizzato (Paletta Totale Colori & Immagine) ─── */}
        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">Sfondo (Paletta Colori & Immagine)</span>
            <span class="customize-section-value">
              {props.customBgImage() ? 'Immagine' : props.customBgColor() || 'Predefinito'}
            </span>
          </div>
          <div class="customize-color-row" style={{ 'margin-bottom': '8px' }}>
            {/* Color picker */}
            <div class="customize-color-picker-wrap" title="Scegli qualsiasi colore con selettore (RGB / Contagocce)">
              <div
                class="customize-color-swatch-box"
                style={{
                  background: props.customBgColor() || '#000000',
                  width: '32px',
                  height: '32px',
                }}
              />
              <input
                type="color"
                class="customize-color-input-hidden"
                value={props.customBgColor() || '#000000'}
                onInput={(e) => {
                  props.onSetCustomBgColor?.(e.currentTarget.value)
                }}
                onChange={(e) => {
                  props.onSetCustomBgColor?.(e.currentTarget.value)
                }}
              />
            </div>

            <span style={{ 'font-size': '11px', color: 'var(--text-muted, #94a3b8)' }}>
              {props.customBgColor() || 'Colore tema'}
            </span>

            {/* Reset button */}
            <div style={{ 'margin-left': 'auto' }}>
              <button
                type="button"
                class="customize-btn-sm"
                onClick={() => {
                  props.onSetCustomBgColor?.(null)
                  props.onSetCustomBgImage?.(null)
                }}
              >
                Ripristina
              </button>
            </div>
          </div>

          {/* Paletta Totale dei Colori Possibili */}
          <div class="customize-bg-total-palette" title="Tavolozza completa colori per sfondo">
            <For each={TOTAL_BG_PALETTE}>
              {(c) => {
                const isActive = () => (props.customBgColor() || '').toLowerCase() === c.hex.toLowerCase()
                return (
                  <button
                    type="button"
                    class="customize-bg-swatch"
                    classList={{ 'customize-bg-swatch--active': isActive() }}
                    style={{ background: c.hex }}
                    title={`${c.name} (${c.hex})`}
                    onClick={() => props.onSetCustomBgColor?.(c.hex)}
                  />
                )
              }}
            </For>
          </div>

          {/* Background Image Upload */}
          <div class="customize-bg-img-row">
            <Show
              when={props.customBgImage()}
              fallback={
                <label class="customize-btn-sm" style={{ cursor: 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>Carica immagine sfondo</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = (event) => {
                        const url = event.target?.result as string
                        if (url) props.onSetCustomBgImage?.(url)
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                </label>
              }
            >
              <img class="customize-bg-thumb" src={props.customBgImage()!} alt="Sfondo personalizzato" />
              <button
                type="button"
                class="customize-btn-sm customize-btn-sm--danger"
                onClick={() => props.onSetCustomBgImage?.(null)}
              >
                Rimuovi immagine
              </button>
            </Show>
          </div>
        </div>

        {/* ─── Larghezza Tasti & Barre ─── */}
        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">Larghezza Tasti & Barre</span>
            <span class="customize-section-value">{props.visibleKeysCount()} tasti visibili</span>
          </div>
          <div class="customize-preset-grid">
            <button
              type="button"
              class="customize-preset-chip"
              classList={{ 'customize-preset-chip--on': props.keyRangePreset() === '88' }}
              onClick={() => props.onSetKeyRangePreset?.('88')}
            >
              88 Tasti
            </button>
            <button
              type="button"
              class="customize-preset-chip"
              classList={{ 'customize-preset-chip--on': props.keyRangePreset() === '76' }}
              onClick={() => props.onSetKeyRangePreset?.('76')}
            >
              76 Tasti
            </button>
            <button
              type="button"
              class="customize-preset-chip"
              classList={{ 'customize-preset-chip--on': props.keyRangePreset() === '61' }}
              onClick={() => props.onSetKeyRangePreset?.('61')}
            >
              61 Tasti
            </button>
            <button
              type="button"
              class="customize-preset-chip"
              classList={{ 'customize-preset-chip--on': props.keyRangePreset() === '49' }}
              onClick={() => props.onSetKeyRangePreset?.('49')}
            >
              49 Tasti
            </button>
            <button
              type="button"
              class="customize-preset-chip"
              classList={{ 'customize-preset-chip--on': props.keyRangePreset() === 'fit' }}
              onClick={() => props.onSetKeyRangePreset?.('fit')}
            >
              Adatta
            </button>
          </div>
          <div class="customize-slider-wrap">
            <input
              type="range"
              min="37"
              max="88"
              step="1"
              class="mini-slider"
              value={props.visibleKeysCount()}
              onInput={(e) => {
                const count = parseInt(e.currentTarget.value, 10)
                props.onSetVisibleKeysCount?.(count)
              }}
            />
            <div class="customize-slider-hint">
              <span>Più larghi (Zoom +)</span>
              <span>Tastiera intera (88)</span>
            </div>
          </div>
        </div>

        {/* ─── Note sui Tasti del Pianoforte ─── */}
        <div class="customize-section customize-section--toggle">
          <button
            class="customize-toggle"
            classList={{ 'customize-toggle--on': props.whiteKeyLabelsOn() }}
            type="button"
            aria-pressed={props.whiteKeyLabelsOn() ? 'true' : 'false'}
            onClick={() => props.onToggleWhiteKeyLabels?.()}
          >
            <span class="customize-toggle-body">
              <span class="customize-toggle-name">Nomi note tasti bianchi</span>
              <span class="customize-toggle-sub">Notazione inglese (A, B, C, D, E, F, G)</span>
            </span>
            <span class="customize-toggle-switch" aria-hidden="true">
              <span class="customize-toggle-knob"></span>
            </span>
          </button>
          <button
            class="customize-toggle"
            classList={{ 'customize-toggle--on': props.blackKeyLabelsOn() }}
            type="button"
            aria-pressed={props.blackKeyLabelsOn() ? 'true' : 'false'}
            onClick={() => props.onToggleBlackKeyLabels?.()}
          >
            <span class="customize-toggle-body">
              <span class="customize-toggle-name">Nomi note tasti neri</span>
              <span class="customize-toggle-sub">Notazione inglese (C♯, D♯, F♯, G♯, A♯)</span>
            </span>
            <span class="customize-toggle-switch" aria-hidden="true">
              <span class="customize-toggle-knob"></span>
            </span>
          </button>
        </div>

        {/* ─── Colori Tracce & Barre Personalizzati ─── */}
        <Show when={props.tracks() && props.tracks().length > 0}>
          <div class="customize-section">
            <div class="customize-section-head">
              <span class="customize-section-label">Colori Tracce & Barre</span>
              <span class="customize-section-value">{props.tracks().length} tracce</span>
            </div>
            <div class="customize-track-list">
              <For each={props.tracks()}>
                {(track, idx) => {
                  const defaultColorHex = () =>
                    hexToCSS(getTrackColor(track, props.themes[props.themeIndex()] || props.themes[0]!))
                  const effectiveColorHex = () =>
                    track.customColor !== undefined ? hexToCSS(track.customColor) : defaultColorHex()

                  const handleColorChange = (hex: string) => {
                    const intVal = parseInt(hex.replace('#', ''), 16)
                    track.customColor = intVal
                    props.onTrackColorChange?.(track.id, intVal)
                  }

                  const TRACK_SWATCHES = [
                    '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#ffffff'
                  ]

                  return (
                    <div class="customize-track-item">
                      <div class="customize-track-header">
                        <div class="customize-track-title" title={track.name || `Traccia ${idx() + 1}`}>
                          {track.name || `Traccia ${idx() + 1}`}
                          <span class="customize-track-count">({track.notes.length} note)</span>
                        </div>
                        <div class="customize-color-picker-wrap" title="Scegli qualsiasi colore con selettore">
                          <div
                            class="customize-color-swatch-box"
                            style={{
                              width: '26px',
                              height: '26px',
                              'border-radius': '6px',
                              background: effectiveColorHex(),
                            }}
                          />
                          <input
                            type="color"
                            class="customize-color-input-hidden"
                            value={effectiveColorHex()}
                            onInput={(e) => handleColorChange(e.currentTarget.value)}
                            onChange={(e) => handleColorChange(e.currentTarget.value)}
                          />
                        </div>
                      </div>
                      <div class="customize-track-palette-row">
                        <For each={TRACK_SWATCHES}>
                          {(swatchHex) => (
                            <button
                              type="button"
                              class="customize-color-dot"
                              style={{
                                background: swatchHex,
                                width: '20px',
                                height: '20px',
                                'outline': effectiveColorHex().toLowerCase() === swatchHex.toLowerCase() ? '2px solid #ffffff' : 'none'
                              }}
                              title={swatchHex}
                              onClick={() => handleColorChange(swatchHex)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        <div class="customize-section">
          <div class="customize-section-head">
            <span class="customize-section-label">{t('customize.language')}</span>
          </div>
          <div class="customize-locale-row">
            <For each={LOCALES}>
              {(l) => (
                <button
                  class="customize-locale-chip"
                  classList={{ 'customize-locale-chip--on': l.code === locale.value }}
                  type="button"
                  data-locale={l.code}
                  aria-label={l.nativeName}
                  aria-pressed={l.code === locale.value}
                  onClick={() => props.onSelectLocale(l.code)}
                >
                  <span class="customize-locale-chip-label">{l.nativeName}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="customize-section customize-section--toggle">
          <button
            class="customize-toggle"
            classList={{ 'customize-toggle--on': props.chordOn() }}
            type="button"
            aria-pressed={props.chordOn() ? 'true' : 'false'}
            onClick={() => props.onToggleChord()}
          >
            <span class="customize-toggle-body">
              <span class="customize-toggle-name">{t('customize.chord')}</span>
              <span class="customize-toggle-sub">{t('customize.chord.sub')}</span>
            </span>
            <span class="customize-toggle-switch" aria-hidden="true">
              <span class="customize-toggle-knob"></span>
            </span>
          </button>
          <button
            class="customize-toggle"
            classList={{ 'customize-toggle--on': props.noteLabelsOn() }}
            type="button"
            aria-pressed={props.noteLabelsOn() ? 'true' : 'false'}
            onClick={() => props.onToggleNoteLabels()}
          >
            <span class="customize-toggle-body">
              <span class="customize-toggle-name">{t('customize.noteLabels')}</span>
              <span class="customize-toggle-sub">{t('customize.noteLabels.sub')}</span>
            </span>
            <span class="customize-toggle-switch" aria-hidden="true">
              <span class="customize-toggle-knob"></span>
            </span>
          </button>
        </div>

        <div class="customize-section customize-section--footer">
          <a
            class="customize-feedback-card"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('feedback_clicked', { source: 'customize_menu' })}
          >
            <span class="customize-feedback-icon" aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9.6 9.6 0 0 1-4-.9L3 21l1.9-5.5a8.38 8.38 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
              </svg>
            </span>
            <span class="customize-feedback-label">{t('feedback.menu')}</span>
            <svg
              class="customize-feedback-arrow"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M7 17L17 7" />
              <path d="M8 7h9v9" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}

export class CustomizeMenu {
  private triggerElement!: HTMLButtonElement

  // Component refreshes replace the DOM node while this controller survives.
  // Always anchor and handle outside clicks against the current button.
  get trigger(): HTMLButtonElement {
    return this.triggerElement
  }
  private menu!: HTMLElement
  private isOpen = false
  private disposeTrigger: (() => void) | null = null
  private disposeMenu: (() => void) | null = null
  private menuWrapper: HTMLDivElement | null = null
  private triggerWrapper: HTMLDivElement | null = null
  private anchorFrame = 0

  private readonly setThemeIdx: (v: number) => void
  private readonly themeIdxFn: () => number
  private readonly setParticleIdx: (v: number) => void
  private readonly particleIdxFn: () => number
  private readonly setChordOn: (v: boolean) => void
  private readonly chordOnFn: () => boolean
  private readonly setNoteLabelsOn: (v: boolean) => void
  private readonly setIsOpen: (v: boolean) => void
  private readonly setIsSheet: (v: boolean) => void
  private readonly setLabel: (v: string) => void
  private readonly setAccent: (v: string) => void

  private onDocPointer = (e: PointerEvent): void => {
    const target = e.target as Node
    if (this.menu.contains(target)) return
    if (this.trigger.contains(target)) return
    this.close()
  }
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault()
      this.close(true)
    }
  }
  private onResize = (): void => {
    if (!this.isOpen) return
    if (this.menu.classList.contains('popover--sheet') || isNarrowViewport()) {
      this.close()
      return
    }
    this.positionUnder()
  }
  // A theme label or the top strip's responsive/entrance transition can move
  // the trigger after the opening click. Follow its actual screen rectangle
  // while open so the panel never covers its own trigger during that motion.
  private followAnchor = (): void => {
    if (!this.isOpen) return
    if (!this.menu.classList.contains('popover--sheet')) this.positionUnder()
    this.anchorFrame = requestAnimationFrame(this.followAnchor)
  }

  constructor(
    triggerHost: HTMLElement,
    popoverHost: HTMLElement,
    private themes: readonly Theme[],
    particles: readonly ParticleStyleInfo[],
    callbacks: CustomizeMenuCallbacks,
  ) {
    const [themeIdx, setThemeIdx] = createSignal(0)
    const [particleIdx, setParticleIdx] = createSignal(0)
    const [chordOn, setChordOn] = createSignal(false)
    const [noteLabelsOn, setNoteLabelsOn] = createSignal(false)
    const [ledGlow, setLedGlowSig] = createSignal(1.0)
    const [customBgColor, setCustomBgColorSig] = createSignal<string | null>(null)
    const [customBgImage, setCustomBgImageSig] = createSignal<string | null>(null)
    const [whiteKeyLabelsOn, setWhiteKeyLabelsSig] = createSignal(false)
    const [blackKeyLabelsOn, setBlackKeyLabelsSig] = createSignal(false)
    const [keyRangePreset, setKeyRangePresetSig] = createSignal('88')
    const [visibleKeysCount, setVisibleKeysCountSig] = createSignal(88)
    const [tracks, setTracksSig] = createSignal<readonly MidiTrack[]>([])
    const [isOpen, setIsOpen] = createSignal(false)
    const [isSheet, setIsSheet] = createSignal(false)
    const [label, setLabel] = createSignal(t('customize.theme'))
    const [accent, setAccent] = createSignal('var(--accent)')

    this.themeIdxFn = themeIdx
    this.setThemeIdx = setThemeIdx
    this.particleIdxFn = particleIdx
    this.setParticleIdx = setParticleIdx
    this.chordOnFn = chordOn
    this.setChordOn = setChordOn
    this.setNoteLabelsOn = setNoteLabelsOn
    this.setLedGlowSig = setLedGlowSig
    this.setCustomBgColorSig = setCustomBgColorSig
    this.setCustomBgImageSig = setCustomBgImageSig
    this.setWhiteKeyLabelsSig = setWhiteKeyLabelsSig
    this.setBlackKeyLabelsSig = setBlackKeyLabelsSig
    this.setKeyRangePresetSig = setKeyRangePresetSig
    this.setVisibleKeysCountSig = setVisibleKeysCountSig
    this.setTracksSig = setTracksSig
    this.setIsOpen = setIsOpen
    this.setIsSheet = setIsSheet
    this.setLabel = setLabel
    this.setAccent = setAccent

    // Trigger: render into its own wrapper so the host gets exactly our pill
    // and nothing else. We capture the button ref so existing callers can
    // continue treating `.trigger` as a real DOM node.
    const triggerWrapper = document.createElement('div')
    triggerWrapper.style.display = 'contents'
    triggerHost.appendChild(triggerWrapper)
    this.triggerWrapper = triggerWrapper
    this.disposeTrigger = render(
      () => (
        <TriggerView
          label={label}
          accent={accent}
          isOpen={isOpen}
          onToggle={() => this.toggle()}
          registerEl={(el) => {
            this.triggerElement = el
          }}
        />
      ),
      triggerWrapper,
    )

    const menuWrapper = document.createElement('div')
    popoverHost.appendChild(menuWrapper)
    this.menuWrapper = menuWrapper
    this.disposeMenu = render(
      () => (
        <MenuView
          themes={themes}
          particles={particles}
          themeIndex={themeIdx}
          particleIndex={particleIdx}
          chordOn={chordOn}
          noteLabelsOn={noteLabelsOn}
          ledGlow={ledGlow}
          customBgColor={customBgColor}
          customBgImage={customBgImage}
          whiteKeyLabelsOn={whiteKeyLabelsOn}
          blackKeyLabelsOn={blackKeyLabelsOn}
          keyRangePreset={keyRangePreset}
          visibleKeysCount={visibleKeysCount}
          tracks={tracks}
          isOpen={isOpen}
          isSheet={isSheet}
          onSelectTheme={(i) => callbacks.onSelectTheme(i)}
          onSelectParticle={(i) => callbacks.onSelectParticle(i)}
          onToggleChord={() => callbacks.onToggleChord()}
          onToggleNoteLabels={() => callbacks.onToggleNoteLabels()}
          onSelectLocale={(code) => callbacks.onSelectLocale(code)}
          onSetLedGlow={(val) => {
            setLedGlowSig(val)
            callbacks.onSetLedGlow?.(val)
          }}
          onSetCustomBgColor={(color) => {
            setCustomBgColorSig(color)
            callbacks.onSetCustomBgColor?.(color)
          }}
          onSetCustomBgImage={(url) => {
            setCustomBgImageSig(url)
            callbacks.onSetCustomBgImage?.(url)
          }}
          onToggleWhiteKeyLabels={() => {
            setWhiteKeyLabelsSig((v) => !v)
            callbacks.onToggleWhiteKeyLabels?.()
          }}
          onToggleBlackKeyLabels={() => {
            setBlackKeyLabelsSig((v) => !v)
            callbacks.onToggleBlackKeyLabels?.()
          }}
          onSetKeyRangePreset={(preset) => {
            setKeyRangePresetSig(preset)
            callbacks.onSetKeyRangePreset?.(preset)
          }}
          onSetVisibleKeysCount={(count) => {
            setVisibleKeysCountSig(count)
            callbacks.onSetVisibleKeysCount?.(count)
          }}
          onTrackColorChange={(trackId, color) => {
            callbacks.onTrackColorChange?.(trackId, color)
          }}
          onClose={() => this.close(true)}
          registerEl={(el) => {
            this.menu = el
          }}
        />
      ),
      menuWrapper,
    )
  }

  // ── Public state setters (App pushes the active selection in) ──────────
  private readonly setLedGlowSig: (v: number) => void
  private readonly setCustomBgColorSig: (v: string | null) => void
  private readonly setCustomBgImageSig: (v: string | null) => void
  private readonly setWhiteKeyLabelsSig: (v: boolean | ((p: boolean) => boolean)) => void
  private readonly setBlackKeyLabelsSig: (v: boolean | ((p: boolean) => boolean)) => void
  private readonly setKeyRangePresetSig: (v: string) => void
  private readonly setVisibleKeysCountSig: (v: number) => void
  private readonly setTracksSig: (v: readonly MidiTrack[]) => void

  setLedGlow(intensity: number): void {
    this.setLedGlowSig(intensity)
  }

  setCustomBgColor(color: string | null): void {
    this.setCustomBgColorSig(color)
  }

  setCustomBgImage(url: string | null): void {
    this.setCustomBgImageSig(url)
  }

  setWhiteKeyLabels(on: boolean): void {
    this.setWhiteKeyLabelsSig(on)
  }

  setBlackKeyLabels(on: boolean): void {
    this.setBlackKeyLabelsSig(on)
  }

  setKeyRangePreset(preset: string): void {
    this.setKeyRangePresetSig(preset)
  }

  setVisibleKeysCount(count: number): void {
    this.setVisibleKeysCountSig(count)
  }

  setTracks(tracks: readonly MidiTrack[]): void {
    this.setTracksSig([...tracks])
  }

  setTheme(index: number): void {
    this.setThemeIdx(index)
    const theme = this.themes[index]
    if (!theme) return
    // Tint the palette glyph with the active theme accent — keeps the live
    // "current theme" signal the old colour swatch carried.
    this.setAccent(accentCSS(theme))
    this.setLabel(theme.name)
  }

  setParticle(index: number): void {
    this.setParticleIdx(index)
  }

  setChord(on: boolean): void {
    this.setChordOn(on)
  }

  setNoteLabels(on: boolean): void {
    this.setNoteLabelsOn(on)
  }

  // ── Open / close ──────────────────────────────────────────────────────
  private toggle(): void {
    this.isOpen ? this.close() : this.open()
  }

  private open(): void {
    if (this.isOpen) return
    this.isOpen = true
    document.body.classList.add('appearance-open')
    this.setIsOpen(true)
    if (isNarrowViewport()) {
      this.setIsSheet(true)
      this.menu.style.top = ''
      this.menu.style.right = ''
      this.menu.style.left = ''
    } else {
      this.setIsSheet(false)
      this.positionUnder()
    }
    // The triggering pointerdown has already finished before this click. Add
    // listeners now, avoiding a deferred callback that could survive close/dispose.
    document.addEventListener('pointerdown', this.onDocPointer)
    document.addEventListener('keydown', this.onKey)
    window.addEventListener('resize', this.onResize)
    this.anchorFrame = requestAnimationFrame(this.followAnchor)
    this.menu.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
  }

  private close(returnFocus = false): void {
    if (!this.isOpen) return
    this.isOpen = false
    document.body.classList.remove('appearance-open')
    cancelAnimationFrame(this.anchorFrame)
    this.anchorFrame = 0
    this.setIsOpen(false)
    this.setIsSheet(false)
    document.removeEventListener('pointerdown', this.onDocPointer)
    document.removeEventListener('keydown', this.onKey)
    window.removeEventListener('resize', this.onResize)
    if (returnFocus) this.trigger.focus({ preventScroll: true })
  }

  private positionUnder(): void {
    const rect = this.trigger.getBoundingClientRect()
    const menuW = this.menu.offsetWidth || 340
    const right = Math.min(
      Math.max(12, window.innerWidth - rect.right),
      Math.max(12, window.innerWidth - menuW - 12),
    )
    const top = rect.bottom + 8
    const rightValue = `${Math.round(right)}px`
    const topValue = `${Math.ceil(top)}px`
    if (this.menu.style.right !== rightValue) this.menu.style.right = rightValue
    if (this.menu.style.top !== topValue) this.menu.style.top = topValue
    const availableHeight = `${Math.max(0, Math.floor(window.innerHeight - top - 12))}px`
    if (this.menu.style.getPropertyValue('--customize-available-height') !== availableHeight) {
      this.menu.style.setProperty('--customize-available-height', availableHeight)
    }
  }

  getCurrentTheme(): number {
    return this.themeIdxFn()
  }
  getCurrentParticle(): number {
    return this.particleIdxFn()
  }
  isChordOn(): boolean {
    return this.chordOnFn()
  }

  dispose(): void {
    this.close()
    this.disposeTrigger?.()
    this.disposeMenu?.()
    this.disposeTrigger = null
    this.disposeMenu = null
    this.triggerWrapper?.remove()
    this.triggerWrapper = null
    this.menuWrapper?.remove()
    this.menuWrapper = null
  }
}

// Kept for call sites that still import the ParticleStyle type by name.
export type { ParticleStyle }

// Lightweight inline SVGs that hint at each particle style's behaviour.
// All use currentColor so they pick up theme accent on hover / when active.
const PARTICLE_GLYPHS: Record<string, string> = {
  mist: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M3 8c5-5 9 3 14-1s6-2 4 0M2 13c6-5 10 4 17-1M5 18c5-3 8 2 13-1"/><path d="m4 4 .1 0m17 15 .1 0" opacity=".5"/></svg>`,
  silk: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="m4 17 2-5m5 7 2-6m4-2 2-5"/><path d="m8 8 1-3m9 15 1-3m-6-7 1-3" opacity=".45"/></svg>`,
  gold: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="m5 4 10 3 4 10-12 3-4-9zM5 4l7 9 7 4M12 13 7 20"/><path d="m19 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor"/></svg>`,
  pearl: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1"><path d="m9 9 4 2-1 5-5-2zm9-5 3 2-2 3-2-2z"/><path d="m4 5 1 1m0 12 1 1m11-3 1 1m-7-14 1 1" stroke-linecap="round" opacity=".55"/></svg>`,
  liquid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="m5 8 1 1m4-5 1 1m6 3 1 1m-6 4 1 1m-9 5 1 1m5 2 1-1m7-4 2-2"/><path d="m6 14 1-1m9 7 1 1m5-11 1 1" opacity=".4"/></svg>`,
  glass: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m12 2 2 8 7 2-7 2-2 8-2-8-7-2 7-2z"/><path d="m19 3 .7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7z" opacity=".5"/></svg>`,
  sparks: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/>
    <path d="M5.6 5.6l2.8 2.8"/><path d="M15.6 15.6l2.8 2.8"/>
    <path d="M5.6 18.4l2.8-2.8"/><path d="M15.6 8.4l2.8-2.8"/>
  </svg>`,
  embers: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="17" r="1.6"/>
    <circle cx="13" cy="13" r="2" opacity="0.85"/>
    <circle cx="17" cy="8" r="1.3" opacity="0.7"/>
    <circle cx="10" cy="9" r="1" opacity="0.55"/>
    <circle cx="6" cy="11" r="0.8" opacity="0.45"/>
  </svg>`,
  bloom: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
    <circle cx="12" cy="12" r="6" opacity="0.6"/>
    <circle cx="12" cy="12" r="9.5" opacity="0.3"/>
  </svg>`,
  sparkle: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 4l1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4z"/>
    <path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" opacity="0.7"/>
  </svg>`,
  none: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" opacity="0.5"/>
    <line x1="6" y1="18" x2="18" y2="6" opacity="0.7"/>
  </svg>`,
}
